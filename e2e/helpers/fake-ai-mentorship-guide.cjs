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
// In this slice it touches no database: it neither claims nor completes a
// request.
//
// Steering and inspection, for specs (see fake-ai-mentorship-guide.ts):
// - POST /__fake/steer {"enqueue": "accept" | "asleep" | "reject", "status"?}
//   sets how every following enqueue call is answered, until the next steer
//   or reset.
// - GET /__fake/calls lists the wake and enqueue calls received since reset.
// - POST /__fake/reset clears the calls and goes back to "accept".
// - GET /__fake/health answers 200 once the fake is listening.
//
// It logs no text. Port, secret and environment come from
// fake-ai-mentorship-guide.json, which the specs and the Playwright config
// read too; FAKE_AI_MENTORSHIP_GUIDE_PORT overrides the port.
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http");
const config = require("./fake-ai-mentorship-guide.json");

const HOST = "127.0.0.1";
const PORT = Number(process.env.FAKE_AI_MENTORSHIP_GUIDE_PORT || config.port);
const ENQUEUE_PATH = /^\/api\/internal\/insight-requests\/([^/]+)\/enqueue$/;
const REJECT_STATUSES = new Set([401, 404, 422]);
const MAX_BODY_BYTES = 64 * 1024;

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

function parseSteering(raw) {
  let steer;
  try {
    steer = JSON.parse(raw);
  } catch {
    return null;
  }
  if (steer?.enqueue === "accept" || steer?.enqueue === "asleep") return { enqueue: steer.enqueue };
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
    return send(res, answer.status, answer.body);
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
  process.on(signal, () => server.close(() => process.exit(0)));
}
