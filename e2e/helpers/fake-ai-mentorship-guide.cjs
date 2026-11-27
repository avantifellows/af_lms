// The fake generator: a stand-in for AI Mentorship Guide in e2e runs and local
// QA of AI Test Insights (#550). Not shipped in the app; the app reaches it
// only through its AI_TEST_INSIGHTS_* settings, like the real one.
//
// One Node process bound to 127.0.0.1 (Playwright starts it beside the app
// server; `npm run fake:ai-mentorship-guide` starts it for local QA, and
// `npm run fake:ai-mentorship-guide:auto` in auto mode). It serves the
// generator's three outside contracts:
// - POST /wake/start: the wake call (the wake URL is `{origin}/wake`). Always
//   202; it needs no secret.
// - POST /api/internal/insight-requests/{request_key}/enqueue: the enqueue
//   call (the enqueue URL is `{origin}/api/internal/insight-requests`).
//   503 while asleep; 401 without `Authorization: Bearer <enqueueSecret>`;
//   422 unless the body is exactly {"environment": "<environment>"}; then the
//   steered answer: 202 {request_key, environment, state: "queued"}, or a
//   rejection with 401, 404 or 422.
// - GET /{bucket}/{key}: object reads, path-style, as S3 answers the LMS's
//   artifact reader (and, for the PDF, a presigned URL). It serves the text
//   and the PDF it "uploaded": a key some Item File row of its environment
//   holds, under `{prefix}/{environment}/items/{item id}/`, read with the
//   fake's read-only access key id (SigV4 header or presigned query). The
//   bytes are the fixed Test Insight in fake-ai-test-insight.json: `markdown`
//   for a `report` file, `pdf` for a `report_pdf` file. Anything else is a
//   404 NoSuchKey or a 403 AccessDenied, as S3 answers.
//
// Its database side writes what AI Mentorship Guide writes on a request row
// (#563). After answering 202 it claims the request when told to run it: one
// conditional update from `queued` to `running` with `started_at`. Then, as
// steered, it holds the request as running, ends it `no_data` or `failed`
// with an outcome code, or completes it (#564) as AI Mentorship Guide does: in
// one transaction it creates a Session, an Item for the request's Student and
// two Item File rows (`report` at `output/final-report.md` and `report_pdf` at
// `output/report.pdf`, keys under `{prefix}/{environment}/items/{item id}/`),
// and ends the request `completed` with that Item. Every end is guarded by
// `state IN ('queued', 'running')`; every write uses UTC times (`now() AT TIME
// ZONE 'UTC'`) and sets `updated_at`.
//
// Modes:
// - Steered (the default, for specs): every accepted request is left
//   `queued` until a spec steers otherwise.
// - Auto (`--auto`, for local QA): every accepted request is claimed at once
//   and completed `autoCompleteAfterMs` later, and on start the fake picks up
//   the `queued` rows already in the database the same way. A reset goes
//   back to the mode's default.
//
// Steering and inspection, for specs (see fake-ai-mentorship-guide.ts):
// - POST /__fake/steer {"enqueue": "accept", "run"?: "hold" | "complete" |
//   "no_data" | "failed", "outcomeCode"?} or {"enqueue": "asleep"} or
//   {"enqueue": "reject", "status"} sets how every following enqueue call is answered,
//   and what happens to an accepted request, until the next steer or reset.
//   Accepted without "run", a request is left `queued`, as a generator that
//   has not started it yet.
// - POST /__fake/end {"requestKey", "state": "no_data" | "failed",
//   "outcomeCode"} or {"requestKey", "state": "completed"} ends a request it
//   holds as running. 204, or 409 when no `queued` or `running` row has that
//   key.
// - GET /__fake/calls lists the wake and enqueue calls received since reset.
// - POST /__fake/reset clears the calls and goes back to "accept".
// - GET /__fake/health answers 200 once the fake is listening.
//
// The database comes from DATABASE_HOST (default localhost), DATABASE_PORT,
// DATABASE_USER, DATABASE_PASSWORD and DATABASE_NAME (required). The fake
// refuses to start for any host other than localhost, and for the real-data
// database `dbservice_test_ati550_real`, which nothing may write to: QA runs
// on a clone of it.
//
// It logs no text and no S3 key. Port, secret, environment and object store
// settings come from fake-ai-mentorship-guide.json, which the specs and the
// Playwright config read too; FAKE_AI_MENTORSHIP_GUIDE_PORT overrides the
// port.
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http");
const { Pool } = require("pg");
const config = require("./fake-ai-mentorship-guide.json");
const testInsight = require("./fake-ai-test-insight.json");

const HOST = "127.0.0.1";
const PORT = Number(process.env.FAKE_AI_MENTORSHIP_GUIDE_PORT || config.port);
const ENQUEUE_PATH = /^\/api\/internal\/insight-requests\/([^/]+)\/enqueue$/;
const REJECT_STATUSES = new Set([401, 404, 422]);
const MAX_BODY_BYTES = 64 * 1024;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const REAL_DATA_DATABASE = "dbservice_test_ati550_real";
const END_STATES = new Set(["no_data", "failed"]);
const RUN_BEHAVIOURS = new Set(["hold", "complete", "no_data", "failed"]);
const OUTCOME_CODE = /^[a-z0-9_]{1,64}$/;
const UTC_NOW = "(now() AT TIME ZONE 'UTC')";
const AUTO = process.argv.includes("--auto");
const DEFAULT_BEHAVIOUR = AUTO
  ? { enqueue: "accept", run: "complete", delayMs: config.autoCompleteAfterMs }
  : { enqueue: "accept" };
// What the fake "uploads" for a completed request: its Item File rows, and
// the bytes it serves for them.
const STORE = config.store;
const UPLOADS = [
  {
    fileKind: "report",
    logicalPath: "output/final-report.md",
    mimeType: "text/markdown",
    bytes: Buffer.from(testInsight.markdown, "utf8"),
  },
  {
    fileKind: "report_pdf",
    logicalPath: "output/report.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from(testInsight.pdf, "latin1"),
  },
];
const UPLOADS_BY_KIND = new Map(UPLOADS.map((upload) => [upload.fileKind, upload]));
const escapeRegExp = (text) => text.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
const ITEM_FOLDER = new RegExp("^" + escapeRegExp(`${STORE.prefix}/${config.environment}/items/`) + "(\\d+)/");
// Sessions the fake creates carry this, so e2e cleanup can find them.
const SESSION_MARKER = JSON.stringify({ fake_ai_mentorship_guide: true });

/** The database settings, or the reason the fake refuses them. */
function databaseSettings(env) {
  const host = (env.DATABASE_HOST || "localhost").trim();
  const database = (env.DATABASE_NAME || "").trim();
  if (!LOCAL_HOSTS.has(host)) return { refused: `database host ${host} is not localhost` };
  if (!database) return { refused: "DATABASE_NAME is not set" };
  if (database === REAL_DATA_DATABASE) return { refused: `database ${REAL_DATA_DATABASE} holds real data; use a clone` };
  return {
    host,
    port: Number(env.DATABASE_PORT || 5432),
    user: env.DATABASE_USER || "postgres",
    password: env.DATABASE_PASSWORD || "postgres",
    database,
  };
}

const database = databaseSettings(process.env);
if (database.refused) {
  console.error(`Fake AI Mentorship Guide refuses to start: ${database.refused}`);
  process.exit(1);
}
const pool = new Pool({ ...database, max: 2 });
// An idle connection the database closed (as e2e teardown does) is not a crash.
pool.on("error", () => {});

let behaviour = DEFAULT_BEHAVIOUR;
let calls = [];

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** The body the real generator accepts: exactly {"environment": "<its environment>"}. */
function isValidEnqueueBody(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "environment" && body.environment === config.environment;
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseSteering(raw) {
  const steer = parseJson(raw);
  if (steer?.enqueue === "accept") {
    if (steer.run === undefined) return { enqueue: "accept" };
    if (!RUN_BEHAVIOURS.has(steer.run)) return null;
    if (steer.run === "hold" || steer.run === "complete") return { enqueue: "accept", run: steer.run };
    if (!OUTCOME_CODE.test(steer.outcomeCode ?? "")) return null;
    return { enqueue: "accept", run: steer.run, outcomeCode: steer.outcomeCode };
  }
  if (steer?.enqueue === "asleep") return { enqueue: "asleep" };
  if (steer?.enqueue === "reject" && REJECT_STATUSES.has(steer.status)) return { enqueue: "reject", status: steer.status };
  return null;
}

function answerEnqueue(requestKey, authorization, raw) {
  if (behaviour.enqueue === "asleep") return { status: 503, body: { error: "unavailable" } };
  if (authorization !== `Bearer ${config.enqueueSecret}`) return { status: 401, body: { error: "unauthorized" } };
  if (!isValidEnqueueBody(raw)) return { status: 422, body: { error: "invalid body" } };
  if (behaviour.enqueue === "reject") return { status: behaviour.status, body: { error: "rejected" } };
  return { status: 202, body: { request_key: requestKey, environment: config.environment, state: "queued" } };
}

/** Claims a `queued` request, as the generator does when it starts it. Returns whether a row changed. */
async function claim(requestKey) {
  const result = await pool.query(
    `UPDATE ai_test_insight_requests
     SET state = 'running', started_at = ${UTC_NOW}, updated_at = ${UTC_NOW}
     WHERE request_key = $1 AND state = 'queued'`,
    [requestKey],
  );
  return result.rowCount === 1;
}

/** Ends a request without a result. Returns whether a row changed. */
async function endWithoutResult(requestKey, state, outcomeCode) {
  const result = await pool.query(
    `UPDATE ai_test_insight_requests
     SET state = $2, outcome_code = $3, started_at = COALESCE(started_at, ${UTC_NOW}),
         finished_at = ${UTC_NOW}, updated_at = ${UTC_NOW}
     WHERE request_key = $1 AND state IN ('queued', 'running')`,
    [requestKey, state, outcomeCode],
  );
  return result.rowCount === 1;
}

/**
 * Completes a request as AI Mentorship Guide does, in one transaction: a
 * Session, an Item for the request's Student, the two Item File rows of what
 * it "uploaded", and the request `completed` with that Item. Returns whether
 * the request was still `queued` or `running`; if not, nothing is written.
 */
async function complete(requestKey) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, student_id, program_id, selected_test_ids
       FROM ai_test_insight_requests
       WHERE request_key = $1 AND state IN ('queued', 'running')
       FOR UPDATE`,
      [requestKey],
    );
    const request = found.rows[0];
    if (!request) {
      await client.query("ROLLBACK");
      return false;
    }
    const session = await client.query(
      `INSERT INTO acad_mentorship_inference_sessions
         (program_id, status, config_snapshot_json, started_at, completed_at, created_at, updated_at)
       VALUES ($1, 'completed', $2, ${UTC_NOW}, ${UTC_NOW}, ${UTC_NOW}, ${UTC_NOW})
       RETURNING id`,
      [request.program_id, SESSION_MARKER],
    );
    const selected = request.selected_test_ids;
    const item = await client.query(
      `INSERT INTO acad_mentorship_inference_items
         (session_id, student_id, status, latest_test_id, selected_test_ids,
          started_at, completed_at, created_at, updated_at)
       VALUES ($1, $2, 'completed', $3, $4::jsonb, ${UTC_NOW}, ${UTC_NOW}, ${UTC_NOW}, ${UTC_NOW})
       RETURNING id`,
      [session.rows[0].id, request.student_id, selected[0], JSON.stringify(selected)],
    );
    const itemId = String(item.rows[0].id);
    for (const upload of UPLOADS) {
      await client.query(
        `INSERT INTO acad_mentorship_inference_item_files
           (item_id, logical_path, file_kind, s3_key, mime_type, byte_size, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, $6, ${UTC_NOW})`,
        [
          itemId,
          upload.logicalPath,
          upload.fileKind,
          `${STORE.prefix}/${config.environment}/items/${itemId}/${upload.logicalPath}`,
          upload.mimeType,
          upload.bytes.length,
        ],
      );
    }
    const ended = await client.query(
      `UPDATE ai_test_insight_requests
       SET state = 'completed', inference_item_id = $2, started_at = COALESCE(started_at, ${UTC_NOW}),
           finished_at = ${UTC_NOW}, updated_at = ${UTC_NOW}
       WHERE request_key = $1 AND state IN ('queued', 'running')`,
      [requestKey, itemId],
    );
    if (ended.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs an accepted request as steered, after the 202 has been sent. Logs the key and an error name only. */
async function run(requestKey, steered) {
  try {
    if (!(await claim(requestKey))) return;
    if (steered.run === "hold") return;
    if (steered.run === "complete") {
      if (steered.delayMs) await delay(steered.delayMs);
      await complete(requestKey);
      return;
    }
    await endWithoutResult(requestKey, steered.run, steered.outcomeCode);
  } catch (error) {
    console.error(`Fake AI Mentorship Guide run failed: request=${requestKey} error=${error?.name ?? "unknown"}`);
  }
}

function parseEnd(raw) {
  const end = parseJson(raw);
  if (typeof end?.requestKey !== "string") return null;
  if (end.state === "completed") return { requestKey: end.requestKey, state: "completed" };
  if (!END_STATES.has(end.state) || !OUTCOME_CODE.test(end.outcomeCode ?? "")) return null;
  return end;
}

/** S3's error answer. */
function sendS3Error(res, status, code) {
  res.writeHead(status, { "Content-Type": "application/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
}

/** Whether a read carries the fake's read-only access key id, as a SigV4 header or a presigned query. */
function signedWithReadKey(req, url) {
  const credential =
    url.searchParams.get("X-Amz-Credential") ??
    /Credential=([^,\s]+)/.exec(req.headers.authorization ?? "")?.[1] ??
    "";
  return credential.split("/")[0] === STORE.accessKeyId;
}

/** Serves an object it "uploaded": a key an Item File row of its environment holds, in that Item's folder. */
async function serveObject(req, res, url) {
  if (!signedWithReadKey(req, url)) return sendS3Error(res, 403, "AccessDenied");
  const key = decodeURIComponent(url.pathname.slice(`/${STORE.bucket}/`.length));
  const folder = ITEM_FOLDER.exec(key);
  const found = folder
    ? await pool.query(
        `SELECT file_kind FROM acad_mentorship_inference_item_files WHERE s3_key = $1 AND item_id = $2`,
        [key, folder[1]],
      )
    : { rows: [] };
  const upload = UPLOADS_BY_KIND.get(found.rows[0]?.file_kind);
  if (!upload) return sendS3Error(res, 404, "NoSuchKey");
  res.writeHead(200, { "Content-Type": upload.mimeType, "Content-Length": String(upload.bytes.length) });
  res.end(req.method === "HEAD" ? undefined : upload.bytes);
}

/** Auto mode: picks up the `queued` rows already in the database, as the generator does when it starts. */
async function pickUpQueued() {
  const queued = await pool.query(`SELECT request_key FROM ai_test_insight_requests WHERE state = 'queued' ORDER BY id`);
  for (const row of queued.rows) void run(row.request_key, DEFAULT_BEHAVIOUR);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/__fake/health") return send(res, 200, { ok: true });
  if (req.method === "GET" && path === "/__fake/calls") return send(res, 200, calls);
  if (req.method === "POST" && path === "/__fake/reset") {
    behaviour = DEFAULT_BEHAVIOUR;
    calls = [];
    return send(res, 204);
  }
  if (req.method === "POST" && path === "/__fake/steer") {
    const next = parseSteering(await readBody(req));
    if (!next) return send(res, 400, { error: "unknown steering" });
    behaviour = next;
    return send(res, 204);
  }

  if (req.method === "POST" && path === "/__fake/end") {
    const end = parseEnd(await readBody(req));
    if (!end) return send(res, 400, { error: "unknown end" });
    const ended =
      end.state === "completed"
        ? (await claim(end.requestKey), await complete(end.requestKey))
        : await endWithoutResult(end.requestKey, end.state, end.outcomeCode);
    return send(res, ended ? 204 : 409, ended ? undefined : { error: "no queued or running request" });
  }

  if (req.method === "POST" && path === "/wake/start") {
    const body = await readBody(req);
    calls.push({ kind: "wake", requestKey: null, authorization: req.headers.authorization ?? null, body, status: 202 });
    return send(res, 202, { state: "starting" });
  }

  const enqueue = req.method === "POST" ? ENQUEUE_PATH.exec(path) : null;
  if (enqueue) {
    const requestKey = decodeURIComponent(enqueue[1]);
    const authorization = req.headers.authorization ?? null;
    const body = await readBody(req);
    const answer = answerEnqueue(requestKey, authorization, body);
    calls.push({ kind: "enqueue", requestKey, authorization, body, status: answer.status });
    send(res, answer.status, answer.body);
    // As the real generator does, it starts the request after answering.
    const steered = behaviour;
    if (answer.status === 202 && steered.run) setImmediate(() => run(requestKey, steered));
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && path.startsWith(`/${STORE.bucket}/`)) {
    return serveObject(req, res, url);
  }

  return send(res, 404, { error: "not found" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) send(res, 400, { error: "bad request" });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  if (AUTO) {
    pickUpQueued().catch((error) =>
      console.error(`Fake AI Mentorship Guide could not pick up queued requests: error=${error?.name ?? "unknown"}`),
    );
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => pool.end().finally(() => process.exit(0))));
}
