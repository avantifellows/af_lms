// A stand-in for the DB Service during e2e runs, so no spec ever reaches a
// real one, and server code that writes through it can run end to end. It
// implements only what the Blended Learning JEE form card writes, against the
// e2e database, the way the DB Service does:
//
//   POST   /api/student-exam-record       upsert on (student_id, application_number)
//   PATCH  /api/student-exam-record/:id   update only the keys sent
//   POST   /api/lms-student-document      insert
//   DELETE /api/lms-student-document/:id  soft delete
//
// It also stands in for AWS KMS at /kms (EXAM_PASSWORD_KMS_ENDPOINT), so the
// exam-portal password can be set and revealed without real credentials:
// Encrypt and Decrypt only, with a fake "ciphertext" that is the plaintext
// and its key and encryption context in base64 JSON. Decrypt refuses one made
// under another key or context, as KMS does. Test data only: never real KMS.
//
// Like the real service it answers with the whole record, application
// password included, so specs can prove the app never passes it on. Every
// request is kept for specs to read at GET /__requests. Anything else is 404.

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env.test"), quiet: true });

const PORT = Number(process.env.E2E_DB_SERVICE_PORT || 3902);
const TOKEN = process.env.E2E_DB_SERVICE_TOKEN || "e2e-db-service-token";
const pool = new pg.Pool({
  host: "localhost",
  port: 5432,
  user: process.env.TEST_DB_USER || "postgres",
  password: process.env.TEST_DB_PASSWORD || "postgres",
  database: "af_lms_test",
  ssl: false,
  max: 2,
});

const EXAM_RECORD_FIELDS = [
  "student_id",
  "exam_id",
  "application_number",
  "application_password",
  "application_password_ciphertext",
  "exam_year",
  "sessions_applied",
];
const EXAM_RECORD_COLUMNS =
  "id, student_id, exam_id, application_number, application_password, application_password_ciphertext, exam_year, sessions_applied";
const requests = [];

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

// The keys the DB Service's changeset would cast, in a fixed order.
function castFields(body) {
  return EXAM_RECORD_FIELDS.filter((field) => Object.hasOwn(body, field));
}

async function updateExamRecord(id, body) {
  const fields = castFields(body);
  const sets = fields.map((field, index) => `${field} = $${index + 2}`);
  const result = await pool.query(
    `UPDATE student_exam_record SET ${[...sets, "updated_at = now()"].join(", ")}
     WHERE id = $1 RETURNING ${EXAM_RECORD_COLUMNS}`,
    [id, ...fields.map((field) => body[field])]
  );
  return result.rows[0] ?? null;
}

async function createExamRecord(body) {
  const existing = await pool.query(
    `SELECT id FROM student_exam_record WHERE student_id = $1 AND application_number = $2`,
    [body.student_id, body.application_number]
  );
  if (existing.rows[0]) return { status: 200, record: await updateExamRecord(existing.rows[0].id, body) };
  const fields = castFields(body);
  const result = await pool.query(
    `INSERT INTO student_exam_record (${[...fields, "inserted_at", "updated_at"].join(", ")})
     VALUES (${fields.map((_, index) => `$${index + 1}`).join(", ")}, now(), now())
     RETURNING ${EXAM_RECORD_COLUMNS}`,
    fields.map((field) => body[field])
  );
  return { status: 201, record: result.rows[0] };
}

async function insertDocument(body) {
  const result = await pool.query(
    `INSERT INTO lms_student_documents (student_id, document_type, pages, metadata, uploaded_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     RETURNING id, student_id, document_type, pages, metadata, uploaded_by, deleted_at, inserted_at, updated_at`,
    [
      body.student_id,
      body.document_type,
      JSON.stringify(body.pages ?? []),
      JSON.stringify(body.metadata ?? {}),
      body.uploaded_by,
    ]
  );
  return result.rows[0];
}

// [method, path pattern, handler(params, body) → [status, body]]
const ROUTES = [
  ["POST", /^\/api\/student-exam-record$/, async (_params, body) => {
    const created = await createExamRecord(body);
    return [created.status, created.record];
  }],
  ["PATCH", /^\/api\/student-exam-record\/(\d+)$/, async ([id], body) => {
    const updated = await updateExamRecord(Number(id), body);
    return updated ? [200, updated] : [404, { errors: { detail: "Not Found" } }];
  }],
  ["POST", /^\/api\/lms-student-document$/, async (_params, body) => [201, await insertDocument(body)]],
  ["DELETE", /^\/api\/lms-student-document\/(\d+)$/, async ([id]) => {
    await pool.query(`UPDATE lms_student_documents SET deleted_at = now() WHERE id = $1`, [Number(id)]);
    return [204, undefined];
  }],
];

// --- Fake KMS (JSON 1.1 protocol: the operation is in X-Amz-Target) --------

function sendKms(res, status, body) {
  res.writeHead(status, { "content-type": "application/x-amz-json-1.1" });
  res.end(JSON.stringify(body));
}

function sameContext(a = {}, b = {}) {
  return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
}

function fakeKms(target, body) {
  if (target === "TrentService.Encrypt") {
    const sealed = { k: body.KeyId, c: body.EncryptionContext ?? {}, p: body.Plaintext };
    return [200, { KeyId: body.KeyId, CiphertextBlob: Buffer.from(JSON.stringify(sealed)).toString("base64") }];
  }
  if (target === "TrentService.Decrypt") {
    let sealed = null;
    try {
      sealed = JSON.parse(Buffer.from(body.CiphertextBlob, "base64").toString("utf8"));
    } catch {
      sealed = null;
    }
    if (!sealed || sealed.k !== body.KeyId || !sameContext(sealed.c, body.EncryptionContext)) {
      return [400, { __type: "InvalidCiphertextException", message: "fake KMS: wrong key or context" }];
    }
    return [200, { KeyId: sealed.k, Plaintext: sealed.p }];
  }
  return [400, { __type: "UnsupportedOperationException", message: `fake KMS: ${target}` }];
}

async function routeKms(req, res) {
  const body = await readBody(req);
  const target = String(req.headers["x-amz-target"] ?? "");
  // Only the operation is kept: never the plaintext or the ciphertext.
  requests.push({ method: req.method, path: "/kms", body: { target } });
  return sendKms(res, ...fakeKms(target, body));
}

function inspect(req, res, pathname) {
  if (pathname === "/__health") return send(res, 200, { ok: true });
  if (req.method === "DELETE") requests.length = 0;
  return send(res, 200, requests);
}

// e2e-only: exercised by Playwright, so unit coverage never sees it.
// fallow-ignore-next-line complexity
async function route(req, res) {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
  if (pathname === "/__health" || pathname === "/__requests") return inspect(req, res, pathname);
  if (pathname === "/kms" || pathname.startsWith("/kms/")) return routeKms(req, res);
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "Unauthorized" });

  const body = req.method === "POST" || req.method === "PATCH" ? await readBody(req) : null;
  requests.push({ method: req.method, path: pathname, body });
  for (const [method, pattern, handle] of ROUTES) {
    const match = req.method === method ? pattern.exec(pathname) : null;
    if (match) return send(res, ...(await handle(match.slice(1), body)));
  }
  return send(res, 404, { errors: { detail: "Not Found" } });
}

http
  .createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error("[db-service stub]", error instanceof Error ? error.message : error);
      send(res, 500, { errors: { detail: "Internal Server Error" } });
    });
  })
  .listen(PORT, () => console.log(`[db-service stub] listening on ${PORT}`));
