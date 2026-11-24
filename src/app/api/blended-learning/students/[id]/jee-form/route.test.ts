import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { getServerSession } from "next-auth";
import { query, withTransaction } from "@/lib/db";
import { POST } from "./route";
import { __resetKmsClientForTesting } from "@/lib/exam-password-crypto";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
// S3, KMS and the DB Service are the write's process boundaries.
const s3 = mockClient(S3Client);
const kms = mockClient(KMSClient);

const MENTOR_A = "bl-mentor@example.org";
const ADMIN = "bl-admin@example.org";
const ADMIN_READ_ONLY = "bl-viewer@example.org";
const LMS_ADMIN = "lms-admin@example.org";
const MENTOR_READ_ONLY = "bl-mentor-read-only@example.org";
const TEACHER = "teacher@example.org";
// A team-lead Mentor (9004) who supervises Mentor 9002 (Student 601).
const SUPERVISOR = "bl-team-lead@example.org";

const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [MENTOR_READ_ONLY]: { role: "blended_mentor", read_only: true, user_id: 9003 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [LMS_ADMIN]: { role: "admin", read_only: false, user_id: 13 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
  [SUPERVISOR]: { role: "blended_mentor", read_only: false, user_id: 9004 },
};
// Active current-year Supervisions: supervisor → supervised Mentors.
const SUPERVISIONS: Record<number, number[]> = { 9004: [9002] };
// Active current-year Mappings: student → Mentor user id. Student 503 is unmapped.
const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002 };
const JEE_EXAM_ID = 1;
// What the DB Service answers with: the whole record, legacy password
// included. The route must never read or pass it on.
const STORED_PASSWORD = "do-not-leak-7731";
// The exam-portal password a Mentor types, and the fake KMS ciphertext of it.
const TYPED_PASSWORD = "fake-portal-pass-1";
const CIPHERTEXT = Buffer.from("kms-ciphertext-for-501").toString("base64");
// Students whose only current batch is JNV NVS.
const NVS_ONLY = new Set([502]);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

type ExamRecord = {
  id: number;
  exam_id: number;
  exam_name: string;
  exam_year: number | null;
  application_number: string;
  has_password?: boolean;
};
type Update = {
  id: number;
  status: string;
  application_number: string | null;
  confirmation_document_id: number | null;
  reasons: string[] | null;
  details: string | null;
};

let examRecords: ExamRecord[];
let updates: Update[];
let sql: string[];
// Statements on the save's transaction client, in order, and how each
// transaction ended.
let txSql: string[];
let txWrites: { sql: string; params: unknown[] }[];
let txOutcomes: ("committed" | "rolled back")[];
// Students whose Mapping ends between the scope pre-check and the lock.
let endedBeforeLock: Set<number>;
// An error the update's INSERT throws (a constraint, a lost connection).
let insertError: Error | null;
let fetchCalls: { url: string; method: string; body: string | undefined }[];
let fetchStatus: Record<string, number>;
// The ciphertext the (fake) DB Service holds on the Student's JEE record, and
// whether it stores one it is sent (an old DB Service drops the key).
let storedCiphertext: string | null;
let dbServiceStoresCiphertext: boolean;
// The legacy plaintext the (fake) record holds, and whether the DB Service
// clears it when sent `application_password: null`.
let legacyPlaintext: string | null;
// The number the (fake) DB Service last wrote to the JEE record, if any.
let writtenNumber: string | null;
let dbServiceClearsLegacy: boolean;

function matchesPermission(sqlText: string, params?: unknown[]) {
  const email = String(params?.[0]).toLowerCase();
  const row = PERMISSIONS[email];
  return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
}

// The read side of the database, keyed the way the SQL reads it.
async function fakeQuery(text: string, params?: unknown[]) {
  sql.push(text);
  // The permission read (the Supervisions read also checks user_permission).
  if (text.includes("FROM user_permission") && !text.includes("FROM blended_learning_mentor_supervisions")) {
    return matchesPermission(text, params);
  }
  if (text.includes("FROM blended_learning_mentor_supervisions")) {
    return (SUPERVISIONS[Number(params?.[0])] ?? []).map((id) => ({ mentor_user_id: id }));
  }
  if (text.includes("FROM blended_learning_mentor_mentee_mappings")) {
    const mentor = MAPPINGS[Number(params?.[0])];
    return mentor ? [{ mentor_user_id: mentor }] : [];
  }
  if (text.includes("FROM exam WHERE name")) return params?.[0] === "JEE Mains" ? [{ id: JEE_EXAM_ID }] : [];
  if (text.includes("FROM student s")) return [{ nvs: NVS_ONLY.has(Number(params?.[0])), other: false }];
  if (text.includes("bool_or(ser.application_password_ciphertext IS NOT NULL)")) {
    const [studentId] = params?.[0] as number[];
    const record = examRecords.find((row) => row.exam_id === JEE_EXAM_ID && row.exam_year === 2027);
    const number = writtenNumber ?? record?.application_number ?? null;
    if (!record && writtenNumber === null && !storedCiphertext) return [];
    return [{ student_id: studentId, application_number: number, ciphertext_saved: storedCiphertext !== null }];
  }
  if (text.includes("application_password_ciphertext = $4")) {
    const legacyCleared = !text.includes("ser.application_password IS NULL") || legacyPlaintext === null;
    return storedCiphertext === params?.[3] && legacyCleared ? [{ id: 77 }] : [];
  }
  if (text.includes("FROM student_exam_record")) return examRecords;
  if (text.includes("FROM blended_learning_jee_form_updates u")) {
    const [studentId] = params?.[0] as number[];
    return [...updates].reverse().map((update) => ({
      student_id: studentId,
      ...update,
      has_confirmation: update.confirmation_document_id !== null,
      recorded_on: "2026-11-10",
      flag_raised: update.status === "not_filled",
    }));
  }
  if (text.includes("FROM blended_learning_action_items item")) {
    const [studentId] = params?.[0] as number[];
    // Done once a save has ticked it.
    const ticked = writesTo("UPDATE blended_learning_action_items").length > 0;
    return [{ student_id: studentId, id: 81, text: "JEE Form Filling (Reminder)", status: ticked ? "done" : "open" }];
  }
  return [];
}

// The transaction client: the per-Student lock, the Mapping lock, the latest
// update, the exam record reads, and the writes.
function fakeClient() {
  return {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      txSql.push(text);
      if (text.includes("FROM student_exam_record")) return { rows: await fakeQuery(text, params) };
      sql.push(text);
      if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (text.includes("FROM blended_learning_mentor_mentee_mappings")) {
        const studentId = Number(params[0]);
        const mentor = endedBeforeLock.has(studentId) ? undefined : MAPPINGS[studentId];
        return { rows: mentor ? [{ mentor_user_id: mentor, program_id: 80, academic_year: "2026-2027" }] : [] };
      }
      if (text.includes("FROM blended_learning_jee_form_updates")) return { rows: updates.slice(-1) };
      txWrites.push({ sql: text, params });
      if (text.includes("INSERT INTO blended_learning_jee_form_updates")) {
        if (insertError) throw insertError;
        const update: Update = {
          id: 900 + updates.length,
          status: params[3] as string,
          application_number: params[4] as string | null,
          confirmation_document_id: params[5] as number | null,
          reasons: params[6] as string[] | null,
          details: params[7] as string | null,
        };
        updates.push(update);
        return { rows: [{ id: update.id }] };
      }
      return { rows: [] };
    }),
  };
}

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

// Multipart built by hand: jsdom's FormData mangles binary parts.
function jeeRequest(
  studentId: string,
  fields: [string, string][],
  file?: { name: string; type: string; bytes: Uint8Array }
): Request {
  const boundary = "----jee-form-test";
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = fields.map(([name, value]) =>
    enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  );
  if (file) {
    chunks.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="confirmation"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`
      ),
      file.bytes,
      enc.encode("\r\n")
    );
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return new Request(`http://localhost/api/blended-learning/students/${studentId}/jee-form`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: body as unknown as BodyInit,
  });
}

async function record(studentId: string, fields: [string, string][], file?: { name: string; type: string; bytes: Uint8Array }) {
  const res = await POST(jeeRequest(studentId, fields, file), routeParams({ id: studentId }));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

// Filled without a password: what a form sends when it keeps a saved one.
const FILLED_KEEP: [string, string][] = [
  ["status", "filled"],
  ["applicationNumber", " 270310000001 "],
];
const FILLED: [string, string][] = [...FILLED_KEEP, ["password", ` ${TYPED_PASSWORD} `]];
const NOT_FILLED: [string, string][] = [
  ["status", "not_filled"],
  ["reasons", "not_aware"],
  ["reasons", "certificate_not_available"],
  ["details", "  Will check with the school.  "],
];
const PDF = { name: "confirmation.pdf", type: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) };

function writesTo(table: string) {
  return txWrites.filter((write) => write.sql.includes(table));
}

beforeEach(() => {
  vi.clearAllMocks();
  examRecords = [];
  updates = [];
  sql = [];
  txSql = [];
  txWrites = [];
  txOutcomes = [];
  endedBeforeLock = new Set();
  insertError = null;
  fetchCalls = [];
  fetchStatus = {};
  storedCiphertext = null;
  dbServiceStoresCiphertext = true;
  legacyPlaintext = null;
  dbServiceClearsLegacy = true;
  writtenNumber = null;
  mockQuery.mockImplementation(fakeQuery as typeof query);
  // As withTransaction does: COMMIT after the callback, ROLLBACK when it throws.
  mockWithTransaction.mockImplementation(async (fn) => {
    try {
      const result = await fn(fakeClient() as never);
      txOutcomes.push("committed");
      return result;
    } catch (error) {
      txOutcomes.push("rolled back");
      throw error;
    }
  });
  s3.reset();
  s3.on(PutObjectCommand).resolves({});
  kms.reset();
  __resetKmsClientForTesting();
  kms.on(EncryptCommand).resolves({ CiphertextBlob: Buffer.from(CIPHERTEXT, "base64") });
  vi.stubEnv("EXAM_PASSWORD_KMS_KEY_ID", "arn:aws:kms:ap-south-1:111122223333:key/test");
  vi.stubEnv("S3_DOCS_BUCKET", "test-bucket");
  vi.stubEnv("S3_DOCS_PREFIX", "lms-documents");
  vi.stubEnv("DB_SERVICE_URL", "http://db-service.test/api");
  vi.stubEnv("DB_SERVICE_TOKEN", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      fetchCalls.push({ url, method, body: init.body as string | undefined });
      const status = fetchStatus[`${method} ${new URL(url).pathname}`] ?? (method === "POST" ? 201 : 200);
      const sent = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      if (status < 300 && dbServiceStoresCiphertext && typeof sent.application_password_ciphertext === "string") {
        storedCiphertext = sent.application_password_ciphertext;
      }
      if (status < 300 && dbServiceClearsLegacy && sent.application_password === null) legacyPlaintext = null;
      if (status < 300 && url.includes("student-exam-record") && typeof sent.application_number === "string") {
        writtenNumber = sent.application_number;
      }
      const record = {
        id: 77,
        student_id: 501,
        exam_id: JEE_EXAM_ID,
        application_number: "270310000001",
        application_password: STORED_PASSWORD,
        exam_year: 2027,
      };
      const document = { id: 4401, student_id: 501, document_type: "jee_main_confirmation", pages: [] };
      return new Response(JSON.stringify(url.includes("lms-student-document") ? document : record), { status });
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/blended-learning/students/[id]/jee-form: who may record", () => {
  it("refuses a signed-out caller, other roles and read-only accounts, before reading the body", async () => {
    signedInAs(null);
    expect((await record("501", FILLED)).status).toBe(401);
    for (const email of [TEACHER, ADMIN_READ_ONLY, MENTOR_READ_ONLY]) {
      signedInAs(email);
      expect((await record("501", FILLED)).status).toBe(403);
    }
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });

  it("answers 404 for another Mentor's Student, an unmapped one or a malformed id, writing nothing", async () => {
    signedInAs(MENTOR_A);
    for (const id of ["601", "503", "abc"]) expect((await record(id, FILLED)).status).toBe(404);
    expect(fetchCalls).toEqual([]);
    expect(txWrites).toEqual([]);
  });

  it("answers 404 to a team lead for a supervised Mentor's Mentee: view only, writing nothing", async () => {
    signedInAs(SUPERVISOR);
    for (const fields of [FILLED, NOT_FILLED]) expect((await record("601", fields)).status).toBe(404);
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(txWrites).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  it("refuses (403) Blended Learning Admins and LMS admins: only the Mentor records the form", async () => {
    for (const email of [ADMIN, LMS_ADMIN]) {
      signedInAs(email);
      for (const id of ["501", "601"]) {
        for (const fields of [FILLED, FILLED_KEEP, NOT_FILLED]) {
          const res = await record(id, fields);
          expect(res.status).toBe(403);
          expect(res.body).toEqual({ error: "Forbidden" });
        }
      }
    }
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(txWrites).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });
});

describe("POST /api/blended-learning/students/[id]/jee-form: filled", () => {
  it("creates the JEE Mains 2027 record with the number and the password's ciphertext, records the update and ticks the reminder", async () => {
    signedInAs(MENTOR_A);
    const res = await record("501", FILLED);

    expect(res.status).toBe(201);
    expect(fetchCalls).toEqual([
      {
        url: "http://db-service.test/api/student-exam-record",
        method: "POST",
        body: JSON.stringify({
          student_id: 501,
          exam_id: JEE_EXAM_ID,
          exam_year: 2027,
          application_number: "270310000001",
          application_password: null,
          application_password_ciphertext: CIPHERTEXT,
        }),
      },
    ]);
    // Encrypted with KMS, bound to the Student, trimmed as the Exams tab trims it.
    const [encrypt] = kms.commandCalls(EncryptCommand).map((call) => call.args[0].input);
    expect(new TextDecoder().decode(encrypt.Plaintext)).toBe(TYPED_PASSWORD);
    expect(encrypt.EncryptionContext).toEqual({ purpose: "student_exam_record.application_password", student_id: "501" });
    const [insert] = writesTo("INSERT INTO blended_learning_jee_form_updates");
    expect(insert.params.slice(0, 8)).toEqual([501, JEE_EXAM_ID, 2027, "filled", "270310000001", null, null, null]);
    const [tick] = writesTo("UPDATE blended_learning_action_items");
    expect(tick.sql).toMatch(/SET status = 'done', completed_by_jee_form_update_id = \$3/);
    expect(tick.sql).toContain("item.status = 'open'");
    // The reminder is found by its key, bound as $2, whatever its text now is.
    expect(tick.sql).toContain("AND common.key = $2");
    expect(tick.sql).not.toContain("common.text");
    expect(tick.params).toEqual([501, "jee_form_reminder", 900, MENTOR_A]);
    expect(writesTo("blended_learning_mentor_flags")).toEqual([]);
    expect(res.body.form.current).toMatchObject({ status: "filled", applicationNumber: "270310000001", hasConfirmation: false });
    expect(res.body.form.passwordSaved).toBe(true);
    expect(res.body.form.reminderItems).toEqual([{ id: 81, text: "JEE Form Filling (Reminder)", status: "done" }]);
  });

  it("updates the Student's existing JEE Mains 2027 record instead of adding one", async () => {
    examRecords = [{ id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "111" }];
    signedInAs(MENTOR_A);

    expect((await record("501", FILLED)).status).toBe(201);
    expect(fetchCalls).toEqual([
      {
        url: "http://db-service.test/api/student-exam-record/77",
        method: "PATCH",
        body: JSON.stringify({
          application_number: "270310000001",
          application_password: null,
          application_password_ciphertext: CIPHERTEXT,
        }),
      },
    ]);
  });

  it("gives the year to a yearless JEE Mains record holding the same number (as the Exams tab saves them)", async () => {
    examRecords = [{ id: 55, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: null, application_number: "270310000001" }];
    signedInAs(MENTOR_A);

    expect((await record("501", FILLED)).status).toBe(201);
    expect(fetchCalls.map((call) => [call.method, call.url, call.body])).toEqual([
      [
        "PATCH",
        "http://db-service.test/api/student-exam-record/55",
        JSON.stringify({
          application_number: "270310000001",
          exam_year: 2027,
          application_password: null,
          application_password_ciphertext: CIPHERTEXT,
        }),
      ],
    ]);
  });

  it("sends nothing to the DB Service when the stored 2027 record already has the number and a password", async () => {
    examRecords = [
      { id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "270310000001", has_password: true },
    ];
    storedCiphertext = "c2F2ZWQ=";
    signedInAs(MENTOR_A);

    const res = await record("501", FILLED_KEEP);
    expect(res.status).toBe(201);
    expect(fetchCalls).toEqual([]);
    expect(kms.commandCalls(EncryptCommand)).toEqual([]);
    expect(res.body.form.passwordSaved).toBe(true);
  });

  it("saves the same Filled form again as no change (200), but still ticks an open reminder by the latest update", async () => {
    signedInAs(MENTOR_A);
    expect((await record("501", FILLED)).status).toBe(201);
    // The reminder was pushed after Filled was recorded, so it is open again.
    txWrites = [];
    fetchCalls = [];
    examRecords = [
      { id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "270310000001", has_password: true },
    ];

    const again = await record("501", FILLED_KEEP);
    expect(again.status).toBe(200);
    // The record already holds the number and a password: nothing is sent.
    expect(fetchCalls).toEqual([]);
    expect(kms.commandCalls(EncryptCommand)).toHaveLength(1);
    expect(writesTo("INSERT INTO blended_learning_jee_form_updates")).toEqual([]);
    const [tick] = writesTo("UPDATE blended_learning_action_items");
    expect(tick.sql).toContain("item.status = 'open'");
    // Done by the latest update (900), which is Filled.
    expect(tick.params).toEqual([501, "jee_form_reminder", 900, MENTOR_A]);
    expect(again.body.form.current).toMatchObject({ id: 900, status: "filled" });
    expect(again.body.form.reminderItems).toEqual([{ id: 81, text: "JEE Form Filling (Reminder)", status: "done" }]);
  });

  describe("after the number was edited in the Exams tab", () => {
    const EDITED = "270310000099";
    const FILLED_EDITED: [string, string][] = [["status", "filled"], ["applicationNumber", EDITED]];

    // Recorded Filled with a PDF; then the Exams tab changed the record's number.
    async function filledThenEdited() {
      signedInAs(MENTOR_A);
      expect((await record("501", FILLED, PDF)).status).toBe(201);
      examRecords = [{ id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: EDITED, has_password: true }];
      writtenNumber = null;
      txWrites = [];
      fetchCalls = [];
    }

    it("re-saving the number the tab shows (the record's) is no change (200) and still ticks by the latest update", async () => {
      await filledThenEdited();

      const again = await record("501", FILLED_EDITED);
      expect(again.status).toBe(200);
      expect(fetchCalls).toEqual([]);
      expect(writesTo("INSERT INTO blended_learning_jee_form_updates")).toEqual([]);
      expect(writesTo("UPDATE blended_learning_action_items").map((write) => write.params[2])).toEqual([900]);
      // The tab shows the record's number; the update keeps what it recorded.
      expect(again.body.form.current).toMatchObject({ id: 900, status: "filled", applicationNumber: EDITED });
      expect(updates.map((update) => update.application_number)).toEqual(["270310000001"]);
    });

    it("a new password with the number shown records a new update (201) that keeps the confirmation, and ticks", async () => {
      await filledThenEdited();

      const again = await record("501", [...FILLED_EDITED, ["password", TYPED_PASSWORD]]);
      expect(again.status).toBe(201);
      const [insert] = writesTo("INSERT INTO blended_learning_jee_form_updates");
      expect(insert.params.slice(3, 6)).toEqual(["filled", EDITED, 4401]);
      expect(writesTo("UPDATE blended_learning_action_items").map((write) => write.params[2])).toEqual([901]);
    });

    it("saving the old number again is a change: the record is patched back and a new update recorded (201)", async () => {
      await filledThenEdited();

      const again = await record("501", FILLED_KEEP);
      expect(again.status).toBe(201);
      expect(fetchCalls.map((call) => [call.method, call.url, call.body])).toEqual([
        ["PATCH", "http://db-service.test/api/student-exam-record/77", JSON.stringify({ application_number: "270310000001" })],
      ]);
      const [insert] = writesTo("INSERT INTO blended_learning_jee_form_updates");
      // Not the number shown, so the confirmation isn't carried over.
      expect(insert.params.slice(3, 6)).toEqual(["filled", "270310000001", null]);
      expect(again.body.form.current).toMatchObject({ id: 901, applicationNumber: "270310000001" });
    });
  });

  it("counts a typed password as a change: the same number with a password records a new update (201) and ticks", async () => {
    signedInAs(MENTOR_A);
    expect((await record("501", FILLED, PDF)).status).toBe(201);
    examRecords = [
      { id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "270310000001", has_password: true },
    ];

    const again = await record("501", FILLED);
    expect(again.status).toBe(201);
    const inserts = writesTo("INSERT INTO blended_learning_jee_form_updates");
    expect(inserts).toHaveLength(2);
    // The same number, keeping the confirmation already uploaded.
    expect(inserts[1].params.slice(3, 6)).toEqual(["filled", "270310000001", 4401]);
    expect(writesTo("UPDATE blended_learning_action_items").map((write) => write.params[2])).toEqual([900, 901]);
    expect(again.text).not.toContain(TYPED_PASSWORD);
    expect(again.body.form.current).toMatchObject({ id: 901, status: "filled" });
  });

  it("refuses (409) a number the Student holds on another exam, writing nothing", async () => {
    examRecords = [{ id: 60, exam_id: 7, exam_name: "JEE Advanced", exam_year: 2027, application_number: "270310000001" }];
    signedInAs(MENTOR_A);
    const res = await record("501", FILLED);

    expect(res.status).toBe(409);
    expect(res.body.fieldErrors).toEqual({
      applicationNumber: "This application number is already saved for JEE Advanced 2027.",
    });
    expect(fetchCalls).toEqual([]);
    expect(kms.commandCalls(EncryptCommand)).toEqual([]);
    expect(txWrites).toEqual([]);
    expect(txOutcomes).toEqual(["rolled back"]);
  });

  it("stores a confirmation PDF as an lms_student_documents row and links it to the update", async () => {
    signedInAs(MENTOR_A);
    const res = await record("501", FILLED, PDF);

    expect(res.status).toBe(201);
    const [put] = s3.commandCalls(PutObjectCommand).map((call) => call.args[0].input);
    expect(put.Key).toMatch(new RegExp(`^lms-documents/students/501/jee_main_confirmation/${UUID}/page-1\\.pdf$`));
    expect(put.ContentType).toBe("application/pdf");
    const documentCall = fetchCalls.find((call) => call.url.endsWith("/lms-student-document"))!;
    expect(JSON.parse(documentCall.body!)).toEqual({
      student_id: 501,
      document_type: "jee_main_confirmation",
      pages: [{ s3_key: put.Key, page_number: 1, mime_type: "application/pdf", byte_size: 5 }],
      metadata: { exam: "JEE Mains", exam_year: 2027, source: "blended_learning" },
      uploaded_by: MENTOR_A,
    });
    const [insert] = writesTo("INSERT INTO blended_learning_jee_form_updates");
    expect(insert.params[5]).toBe(4401);
    expect(res.body.form.current.hasConfirmation).toBe(true);
  });

  it("refuses a confirmation that isn't a PDF, or one sent with Not filled", async () => {
    signedInAs(MENTOR_A);
    const notPdf = await record("501", FILLED, { name: "photo.jpg", type: "image/jpeg", bytes: new Uint8Array([1]) });
    expect(notPdf.status).toBe(422);
    expect(notPdf.body.fieldErrors).toEqual({ confirmation: "Choose a PDF file." });

    const notFilled = await record("501", NOT_FILLED, PDF);
    expect(notFilled.status).toBe(422);
    expect(notFilled.body.fieldErrors).toEqual({ confirmation: "Only a filled form takes a confirmation page." });
    expect(fetchCalls).toEqual([]);
  });

  it("records nothing (502) when the DB Service refuses, and withdraws the uploaded confirmation", async () => {
    fetchStatus["POST /api/student-exam-record"] = 500;
    signedInAs(MENTOR_A);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await record("501", FILLED, PDF);

    expect(res.status).toBe(502);
    expect(fetchCalls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /api/lms-student-document",
      "POST /api/student-exam-record",
      "DELETE /api/lms-student-document/4401",
    ]);
    // Inside the save's transaction: rolled back with no update, flag or tick.
    expect(txWrites).toEqual([]);
    expect(txOutcomes).toEqual(["rolled back"]);
    expect(error.mock.calls).toEqual([["JEE form external write failed:", "DbServiceExamRecordStatusError"]]);
    error.mockRestore();
  });

  it("needs a password while the record has none, writing nothing", async () => {
    examRecords = [{ id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "111" }];
    signedInAs(MENTOR_A);
    for (const fields of [FILLED_KEEP, [...FILLED_KEEP, ["password", "   "]] as [string, string][]]) {
      const res = await record("501", fields);
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ password: "Enter the exam portal password." });
    }
    expect(fetchCalls).toEqual([]);
    expect(kms.commandCalls(EncryptCommand)).toEqual([]);
    expect(txWrites).toEqual([]);
    expect(txOutcomes).toEqual(["rolled back", "rolled back"]);
  });

  it("replaces a saved password on its own when the number is unchanged", async () => {
    examRecords = [
      { id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "270310000001", has_password: true },
    ];
    storedCiphertext = "b2xk";
    signedInAs(MENTOR_A);

    expect((await record("501", FILLED)).status).toBe(201);
    expect(fetchCalls.map((call) => [call.method, call.url, call.body])).toEqual([
      [
        "PATCH",
        "http://db-service.test/api/student-exam-record/77",
        JSON.stringify({ application_password: null, application_password_ciphertext: CIPHERTEXT }),
      ],
    ]);
  });

  it("clears a legacy plaintext with the new ciphertext, and confirms it is gone", async () => {
    examRecords = [
      { id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "270310000001" },
    ];
    legacyPlaintext = STORED_PASSWORD;
    signedInAs(MENTOR_A);

    const res = await record("501", FILLED);
    expect(res.status).toBe(201);
    expect(JSON.parse(fetchCalls[0].body!)).toEqual({ application_password: null, application_password_ciphertext: CIPHERTEXT });
    expect(legacyPlaintext).toBeNull();
    // The read-back tests the legacy column IS NULL; it never selects it.
    const readBack = txSql.find((text) => text.includes("application_password_ciphertext = $4"))!;
    expect(readBack).toContain("AND ser.application_password IS NULL");
    expect(readBack).toMatch(/^\s*SELECT ser\.id\s+FROM/);
  });

  it("records nothing (502) when the DB Service leaves the legacy plaintext in place", async () => {
    examRecords = [
      { id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "270310000001" },
    ];
    legacyPlaintext = STORED_PASSWORD;
    dbServiceClearsLegacy = false;
    signedInAs(MENTOR_A);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await record("501", FILLED);
    expect(res.status).toBe(502);
    expect(res.text).not.toContain(STORED_PASSWORD);
    expect(txWrites).toEqual([]);
    expect(txOutcomes).toEqual(["rolled back"]);
    expect(error.mock.calls).toEqual([["JEE form external write failed:", "CiphertextNotStored"]]);
    error.mockRestore();
  });

  it("changes only the number when no password is typed, leaving both password columns as they are (the Exams tab's keep)", async () => {
    examRecords = [
      { id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "111", has_password: true },
    ];
    storedCiphertext = "c2F2ZWQ=";
    signedInAs(MENTOR_A);

    expect((await record("501", FILLED_KEEP)).status).toBe(201);
    expect(fetchCalls.map((call) => [call.method, call.url, call.body])).toEqual([
      ["PATCH", "http://db-service.test/api/student-exam-record/77", JSON.stringify({ application_number: "270310000001" })],
    ]);
    expect(kms.commandCalls(EncryptCommand)).toEqual([]);
  });

  it("never encrypts for an admin, a read-only Mentor, another Mentor's Student or a JNV NVS-only Student", async () => {
    for (const email of [ADMIN, LMS_ADMIN, MENTOR_READ_ONLY]) {
      signedInAs(email);
      expect((await record("501", FILLED)).status).toBe(403);
    }
    signedInAs(MENTOR_A);
    expect((await record("601", FILLED)).status).toBe(404);

    MAPPINGS[502] = 9001;
    try {
      const nvs = await record("502", FILLED);
      expect(nvs.status).toBe(403);
      expect(nvs.body.error).toBe("Exam registrations are not collected for JNV NVS Students");
    } finally {
      delete MAPPINGS[502];
    }
    expect(kms.commandCalls(EncryptCommand)).toEqual([]);
    expect(fetchCalls).toEqual([]);
    // Only the NVS-only save got as far as the transaction, and wrote nothing.
    expect(txWrites).toEqual([]);
    expect(txOutcomes).toEqual(["rolled back"]);
  });

  // Accepted on review of #507 (Blended Learning has no NVS Students): Filled
  // needs a password, which is refused for an NVS-only Student.
  it("can't record a JNV NVS-only Student without a saved password as Filled, but records Not filled", async () => {
    MAPPINGS[502] = 9001;
    try {
      signedInAs(MENTOR_A);
      const blank = await record("502", FILLED_KEEP);
      expect(blank.status).toBe(422);
      expect(blank.body.fieldErrors).toEqual({ password: "Enter the exam portal password." });

      const typed = await record("502", FILLED);
      expect(typed.status).toBe(403);
      expect(typed.body.error).toBe("Exam registrations are not collected for JNV NVS Students");
      expect(kms.commandCalls(EncryptCommand)).toEqual([]);
      expect(fetchCalls).toEqual([]);
      expect(txWrites).toEqual([]);

      const notFilled = await record("502", NOT_FILLED);
      expect(notFilled.status).toBe(201);
      expect(writesTo("INSERT INTO blended_learning_jee_form_updates")).toHaveLength(1);
      expect(updates.map((update) => update.status)).toEqual(["not_filled"]);
    } finally {
      delete MAPPINGS[502];
    }
  });

  it("records nothing (502) when KMS fails, logging only the error's name", async () => {
    kms.on(EncryptCommand).rejects(Object.assign(new Error("arn:aws:kms:fake-key-arn denied for fake-iam-user"), { name: "AccessDeniedException" }));
    signedInAs(MENTOR_A);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await record("501", FILLED, PDF);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Couldn't save the password. Try again.");
    expect(fetchCalls).toEqual([]);
    expect(s3.commandCalls(PutObjectCommand)).toEqual([]);
    expect(txWrites).toEqual([]);
    expect(txOutcomes).toEqual(["rolled back"]);
    expect(error.mock.calls).toEqual([["JEE form password encryption failed:", "AccessDeniedException"]]);
    error.mockRestore();
  });

  it("records nothing (502) when the DB Service drops the ciphertext, and withdraws the confirmation", async () => {
    dbServiceStoresCiphertext = false;
    signedInAs(MENTOR_A);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await record("501", FILLED, PDF);

    expect(res.status).toBe(502);
    expect(fetchCalls.at(-1)).toMatchObject({ method: "DELETE", url: "http://db-service.test/api/lms-student-document/4401" });
    expect(txWrites).toEqual([]);
    expect(txOutcomes).toEqual(["rolled back"]);
    expect(error.mock.calls).toEqual([["JEE form external write failed:", "CiphertextNotStored"]]);
    error.mockRestore();
  });

  it("needs an application number", async () => {
    signedInAs(MENTOR_A);
    const res = await record("501", [["status", "filled"], ["applicationNumber", "  "]]);
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ applicationNumber: "Enter the application number." });
  });
});

describe("POST /api/blended-learning/students/[id]/jee-form: not filled", () => {
  it("records the reasons and details and raises one flag for the program team, touching no exam record", async () => {
    signedInAs(MENTOR_A);
    const res = await record("501", NOT_FILLED);

    expect(res.status).toBe(201);
    expect(fetchCalls).toEqual([]);
    expect(kms.commandCalls(EncryptCommand)).toEqual([]);
    // Only the read of whether a password is saved, for the form it returns.
    expect(sql.filter((text) => text.includes("student_exam_record")).every((text) => text.includes("bool_or("))).toBe(true);
    const [insert] = writesTo("INSERT INTO blended_learning_jee_form_updates");
    // Reasons in the list's order, whatever order they were ticked in.
    expect(insert.params.slice(3, 8)).toEqual([
      "not_filled",
      null,
      null,
      ["certificate_not_available", "not_aware"],
      "Will check with the school.",
    ]);
    const [flag] = writesTo("INSERT INTO blended_learning_mentor_flags");
    expect(flag.sql).toContain("'jee_form'");
    expect(flag.params).toEqual([
      501,
      900,
      "JEE Main 2027 form not filled: Certificate is not available; Not aware about the exam\nDetails: Will check with the school.",
      MENTOR_A,
    ]);
    expect(writesTo("UPDATE blended_learning_action_items")).toEqual([]);
    expect(res.body.form.current).toMatchObject({ status: "not_filled", flagRaised: true });
  });

  it("needs a reason, and details when Other is chosen", async () => {
    signedInAs(MENTOR_A);
    const none = await record("501", [["status", "not_filled"]]);
    expect(none.status).toBe(422);
    expect(none.body.fieldErrors).toEqual({ reasons: "Choose at least one reason." });

    const other = await record("501", [["status", "not_filled"], ["reasons", "other"], ["details", " "]]);
    expect(other.status).toBe(422);
    expect(other.body.fieldErrors).toEqual({ details: "Describe the other reason." });

    const unknown = await record("501", [["status", "not_filled"], ["reasons", "busy"]]);
    expect(unknown.status).toBe(422);
    expect(unknown.body.fieldErrors).toEqual({ reasons: "Choose reasons from the list." });
    expect(txWrites).toEqual([]);
  });

  it("saves the same status again as no change (200), adding no history or flag", async () => {
    signedInAs(MENTOR_A);
    expect((await record("501", NOT_FILLED)).status).toBe(201);
    const again = await record("501", NOT_FILLED);

    expect(again.status).toBe(200);
    expect(writesTo("INSERT INTO blended_learning_jee_form_updates")).toHaveLength(1);
    expect(writesTo("INSERT INTO blended_learning_mentor_flags")).toHaveLength(1);
    // Not filled never ticks the reminder, saved again or not.
    expect(writesTo("UPDATE blended_learning_action_items")).toEqual([]);
    expect(again.body.form.reminderItems).toEqual([{ id: 81, text: "JEE Form Filling (Reminder)", status: "open" }]);
  });

  it("can change a not-filled status to filled later, keeping the earlier one as history", async () => {
    signedInAs(MENTOR_A);
    await record("501", NOT_FILLED);
    const res = await record("501", FILLED);

    expect(res.status).toBe(201);
    expect(res.body.form.current.status).toBe("filled");
    expect(res.body.form.earlier.map((update: { status: string }) => update.status)).toEqual(["not_filled"]);
  });
});

describe("POST /api/blended-learning/students/[id]/jee-form: a save that loses a race", () => {
  it("answers 404 when the Mapping ended while the form was open, and 409 on a constraint", async () => {
    signedInAs(MENTOR_A);
    mockWithTransaction.mockImplementationOnce(async (fn) =>
      fn({ query: vi.fn(async () => ({ rows: [] })) } as never)
    );
    expect((await record("501", NOT_FILLED)).status).toBe(404);

    mockWithTransaction.mockRejectedValueOnce(Object.assign(new Error("check"), { code: "23514" }));
    const conflicted = await record("501", NOT_FILLED);
    expect(conflicted.status).toBe(409);
    expect(conflicted.body.error).toBe("This conflicts with what is saved. Reload and try again.");
  });

  it("takes the per-Student lock first, then the Mapping lock, before any read or write", async () => {
    signedInAs(MENTOR_A);
    expect((await record("501", FILLED, PDF)).status).toBe(201);

    expect(txSql[0]).toBe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))");
    expect(txSql[1]).toContain("FROM blended_learning_mentor_mentee_mappings");
    expect(txSql[1]).toContain("FOR SHARE");
    expect(txSql[2]).toContain("FROM blended_learning_jee_form_updates");
    // The external writes ran inside the transaction, before the update was appended.
    expect(txSql.findIndex((text) => text.includes("INSERT INTO blended_learning_jee_form_updates"))).toBeGreaterThan(
      txSql.findIndex((text) => text.includes("application_password_ciphertext = $4"))
    );
    expect(txOutcomes).toEqual(["committed"]);
  });

  it("keys the per-Student lock by the JEE form and the Student", async () => {
    signedInAs(MENTOR_A);
    const clients: { query: ReturnType<typeof vi.fn> }[] = [];
    mockWithTransaction.mockImplementationOnce(async (fn) => {
      const client = fakeClient();
      clients.push(client);
      return fn(client as never);
    });
    expect((await record("501", NOT_FILLED)).status).toBe(201);
    expect(clients[0].query.mock.calls[0]).toEqual([
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["blended_learning_jee_form:501"],
    ]);
  });

  it("answers 404 when the Mapping ends before the lock, with no KMS, S3 or DB Service write", async () => {
    signedInAs(MENTOR_A);
    endedBeforeLock.add(501);
    for (const [fields, file] of [[FILLED, PDF], [NOT_FILLED, undefined]] as const) {
      const res = await record("501", [...fields], file);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    }

    expect(kms.commandCalls(EncryptCommand)).toEqual([]);
    expect(s3.commandCalls(PutObjectCommand)).toEqual([]);
    expect(fetchCalls).toEqual([]);
    // Not even the exam record was read.
    expect(txSql.some((text) => text.includes("student_exam_record"))).toBe(false);
    expect(txWrites).toEqual([]);
    expect(txOutcomes).toEqual(["rolled back", "rolled back"]);
  });

  it("maps a constraint on the update's insert after the external writes to 409, withdrawing the confirmation", async () => {
    signedInAs(MENTOR_A);
    insertError = Object.assign(new Error("duplicate"), { code: "23505" });
    const res = await record("501", FILLED, PDF);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This conflicts with what is saved. Reload and try again.");
    // The exam record was written (the gap left as is), the PDF withdrawn.
    expect(fetchCalls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /api/lms-student-document",
      "POST /api/student-exam-record",
      "DELETE /api/lms-student-document/4401",
    ]);
    expect(writesTo("UPDATE blended_learning_action_items")).toEqual([]);
    expect(updates).toEqual([]);
    expect(txOutcomes).toEqual(["rolled back"]);
  });

  it("rethrows anything else after the external writes, withdrawing a stored confirmation", async () => {
    signedInAs(MENTOR_A);
    insertError = new Error("connection lost");
    await expect(POST(jeeRequest("501", FILLED, PDF), routeParams({ id: "501" }))).rejects.toThrow("connection lost");
    expect(fetchCalls.at(-1)).toMatchObject({ method: "DELETE", url: "http://db-service.test/api/lms-student-document/4401" });
    expect(txOutcomes).toEqual(["rolled back"]);
  });

  it("rethrows a failure to open the transaction, having written nothing", async () => {
    signedInAs(MENTOR_A);
    mockWithTransaction.mockRejectedValueOnce(new Error("connection lost"));
    await expect(POST(jeeRequest("501", FILLED, PDF), routeParams({ id: "501" }))).rejects.toThrow("connection lost");
    expect(fetchCalls).toEqual([]);
    expect(kms.commandCalls(EncryptCommand)).toEqual([]);
  });
});

describe("the password is write-only and never plaintext", () => {
  it("never reads the legacy column, only ever clears it, and never returns, logs or sends the password", async () => {
    examRecords = [{ id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "111" }];
    signedInAs(MENTOR_A);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const responses = [await record("501", FILLED, PDF), await record("501", NOT_FILLED)];
    examRecords = [];
    responses.push(await record("501", [["status", "filled"], ["applicationNumber", "999"], ["password", TYPED_PASSWORD]]));

    for (const text of [...sql, ...txSql]) {
      // The legacy plaintext column is only ever tested IS NULL (the
      // read-back), never selected or otherwise named.
      expect(text.replaceAll("ser.application_password IS NULL", "")).not.toMatch(/application_password(?!_ciphertext)/);
      expect(text).not.toMatch(/SELECT\s+\*/i);
    }
    expect(fetchCalls.length).toBeGreaterThan(0);
    for (const call of fetchCalls) {
      const sent = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
      // Sent only as null, and only alongside a new ciphertext.
      if ("application_password" in sent) expect(sent.application_password).toBeNull();
      expect("application_password" in sent).toBe(typeof sent.application_password_ciphertext === "string");
      expect(call.body ?? "").not.toContain(TYPED_PASSWORD);
    }
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.text).not.toContain(TYPED_PASSWORD);
      expect(res.text).not.toContain(STORED_PASSWORD);
      expect(res.text).not.toContain(CIPHERTEXT);
      expect(Object.keys(res.body.form).sort()).toEqual(["current", "earlier", "passwordSaved", "reminderItems"]);
    }
    const logged = JSON.stringify(error.mock.calls);
    for (const secret of [STORED_PASSWORD, TYPED_PASSWORD, CIPHERTEXT]) expect(logged).not.toContain(secret);
    error.mockRestore();
  });
});
