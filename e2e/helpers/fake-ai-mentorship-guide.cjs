// The fake generator: a stand-in for AI Mentorship Guide in e2e runs and local
// QA of AI Test Insights (#550). Not shipped in the app; the app reaches it
// only through its AI_TEST_INSIGHTS_* settings, like the real one.
//
// One Node process bound to 127.0.0.1 (Playwright starts it beside the app
// server; `npm run fake:ai-mentorship-guide` starts it for local QA). It
// serves two of the generator's outside contracts:
// - POST /wake/start: the wake call (the wake URL is `{origin}/wake`). Always
//   202; it needs no secret.
// - POST /api/internal/insight-requests/{request_key}/enqueue: the enqueue
//   call (the enqueue URL is `{origin}/api/internal/insight-requests`).
//   503 while asleep; 401 without `Authorization: Bearer <enqueueSecret>`;
//   422 unless the body is exactly {"environment": "<environment>"}; then the
//   steered answer: 202 {request_key, environment, state: "queued"}, or a
//   rejection with 401, 404 or 422.
//
// Its database side writes what AI Mentorship Guide writes on a request row
// (#563). After answering 202 it claims the request when told to run it: one
// conditional update from `queued` to `running` with `started_at`. Then, as
// steered, it holds the request as running, or ends it `no_data` or `failed`
// with an outcome code. Every end is guarded by `state IN ('queued',
// 'running')`; every update writes UTC times (`now() AT TIME ZONE 'UTC'`) and
// sets `updated_at`. (The `completed` state comes with its object store.)
//
// Steering and inspection, for specs (see fake-ai-mentorship-guide.ts):
// - POST /__fake/steer {"enqueue": "accept", "run"?: "hold" | "no_data" |
//   "failed", "outcomeCode"?} or {"enqueue": "asleep"} or {"enqueue":
//   "reject", "status"} sets how every following enqueue call is answered,
//   and what happens to an accepted request, until the next steer or reset.
//   Accepted without "run", a request is left `queued`, as a generator that
//   has not started it yet.
// - POST /__fake/end {"requestKey", "state": "no_data" | "failed",
//   "outcomeCode"} ends a request it holds as running. 204, or 409 when no
//   `queued` or `running` row has that key.
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
// It logs no text. Port, secret and environment come from
// fake-ai-mentorship-guide.json, which the specs and the Playwright config
// read too; FAKE_AI_MENTORSHIP_GUIDE_PORT overrides the port.
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http");
const { Pool } = require("pg");
const config = require("./fake-ai-mentorship-guide.json");

const HOST = "127.0.0.1";
const PORT = Number(process.env.FAKE_AI_MENTORSHIP_GUIDE_PORT || config.port);
const ENQUEUE_PATH = /^\/api\/internal\/insight-requests\/([^/]+)\/enqueue$/;
const REJECT_STATUSES = new Set([401, 404, 422]);
const MAX_BODY_BYTES = 64 * 1024;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const REAL_DATA_DATABASE = "dbservice_test_ati550_real";
const END_STATES = new Set(["no_data", "failed"]);
const RUN_BEHAVIOURS = new Set(["hold", "no_data", "failed"]);
const OUTCOME_CODE = /^[a-z0-9_]{1,64}$/;
const UTC_NOW = "(now() AT TIME ZONE 'UTC')";

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

let behaviour = { enqueue: "accept" };
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
    if (steer.run === "hold") return { enqueue: "accept", run: "hold" };
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

/** Runs an accepted request as steered, after the 202 has been sent. Logs the key and an error name only. */
async function run(requestKey, steered) {
  try {
    if (!(await claim(requestKey))) return;
    if (steered.run !== "hold") await endWithoutResult(requestKey, steered.run, steered.outcomeCode);
  } catch (error) {
    console.error(`Fake AI Mentorship Guide run failed: request=${requestKey} error=${error?.name ?? "unknown"}`);
  }
}

function parseEnd(raw) {
  const end = parseJson(raw);
  if (typeof end?.requestKey !== "string" || !END_STATES.has(end.state) || !OUTCOME_CODE.test(end.outcomeCode ?? "")) {
    return null;
  }
  return end;
}

async function handle(req, res) {
  const path = new URL(req.url, `http://${HOST}`).pathname;

  if (req.method === "GET" && path === "/__fake/health") return send(res, 200, { ok: true });
  if (req.method === "GET" && path === "/__fake/calls") return send(res, 200, calls);
  if (req.method === "POST" && path === "/__fake/reset") {
    behaviour = { enqueue: "accept" };
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
    const ended = await endWithoutResult(end.requestKey, end.state, end.outcomeCode);
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

  return send(res, 404, { error: "not found" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) send(res, 400, { error: "bad request" });
    else res.end();
  });
});

server.listen(PORT, HOST);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => pool.end().finally(() => process.exit(0))));
}
