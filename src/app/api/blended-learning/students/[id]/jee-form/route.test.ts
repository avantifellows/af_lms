import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { getServerSession } from "next-auth";
import { query, withTransaction } from "@/lib/db";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
// S3 and the DB Service are the write's process boundaries.
const s3 = mockClient(S3Client);

const MENTOR_A = "bl-mentor@example.org";
const ADMIN = "bl-admin@example.org";
const ADMIN_READ_ONLY = "bl-viewer@example.org";
const MENTOR_READ_ONLY = "bl-mentor-read-only@example.org";
const TEACHER = "teacher@example.org";

const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [MENTOR_READ_ONLY]: { role: "blended_mentor", read_only: true, user_id: 9003 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
// Active current-year Mappings: student → Mentor user id. Student 503 is unmapped.
const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002 };
const JEE_EXAM_ID = 1;
// What the DB Service answers with: the whole record, password included. The
// route must never read or pass it on.
const STORED_PASSWORD = "do-not-leak-7731";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

type ExamRecord = { id: number; exam_id: number; exam_name: string; exam_year: number | null; application_number: string };
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
let txWrites: { sql: string; params: unknown[] }[];
let fetchCalls: { url: string; method: string; body: string | undefined }[];
let fetchStatus: Record<string, number>;

function matchesPermission(sqlText: string, params?: unknown[]) {
  const email = String(params?.[0]).toLowerCase();
  const row = PERMISSIONS[email];
  return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
}

// The read side of the database, keyed the way the SQL reads it.
async function fakeQuery(text: string, params?: unknown[]) {
  sql.push(text);
  if (text.includes("FROM user_permission")) return matchesPermission(text, params);
  if (text.includes("FROM blended_learning_mentor_mentee_mappings")) {
    const mentor = MAPPINGS[Number(params?.[0])];
    return mentor ? [{ mentor_user_id: mentor }] : [];
  }
  if (text.includes("FROM exam WHERE name")) return params?.[0] === "JEE Mains" ? [{ id: JEE_EXAM_ID }] : [];
  if (text.includes("FROM student_exam_record")) return examRecords;
  if (text.includes("FROM blended_learning_jee_form_updates u")) {
    return [...updates].reverse().map((update) => ({
      ...update,
      has_confirmation: update.confirmation_document_id !== null,
      recorded_on: "2026-11-10",
      flag_raised: update.status === "not_filled",
    }));
  }
  if (text.includes("FROM blended_learning_action_items item")) {
    return [{ id: 81, text: "JEE Form Filling (Reminder)", status: updates.some((u) => u.status === "filled") ? "done" : "open" }];
  }
  return [];
}

// The transaction client: the Mapping lock, the latest update, and the writes.
function fakeClient() {
  return {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      sql.push(text);
      if (text.includes("FROM blended_learning_mentor_mentee_mappings")) {
        const mentor = MAPPINGS[Number(params[0])];
        return { rows: mentor ? [{ mentor_user_id: mentor, program_id: 80, academic_year: "2026-2027" }] : [] };
      }
      if (text.includes("FROM blended_learning_jee_form_updates")) return { rows: updates.slice(-1) };
      txWrites.push({ sql: text, params });
      if (text.includes("INSERT INTO blended_learning_jee_form_updates")) {
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

const FILLED: [string, string][] = [
  ["status", "filled"],
  ["applicationNumber", " 270310000001 "],
];
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
  txWrites = [];
  fetchCalls = [];
  fetchStatus = {};
  mockQuery.mockImplementation(fakeQuery as typeof query);
  mockWithTransaction.mockImplementation(async (fn) => fn(fakeClient() as never));
  s3.reset();
  s3.on(PutObjectCommand).resolves({});
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

  it("lets a Blended Learning Admin record for any mapped Student, kept against the mapped Mentor", async () => {
    signedInAs(ADMIN);
    const res = await record("601", NOT_FILLED);

    expect(res.status).toBe(201);
    const [insert] = writesTo("INSERT INTO blended_learning_jee_form_updates");
    expect(insert.params.slice(8)).toEqual([9002, 80, "2026-2027", ADMIN]);
  });
});

describe("POST /api/blended-learning/students/[id]/jee-form: filled", () => {
  it("creates the JEE Mains 2027 record with the application number only, records the update and ticks the reminder", async () => {
    signedInAs(MENTOR_A);
    const res = await record("501", FILLED);

    expect(res.status).toBe(201);
    expect(fetchCalls).toEqual([
      {
        url: "http://db-service.test/api/student-exam-record",
        method: "POST",
        body: JSON.stringify({ student_id: 501, exam_id: JEE_EXAM_ID, exam_year: 2027, application_number: "270310000001" }),
      },
    ]);
    const [insert] = writesTo("INSERT INTO blended_learning_jee_form_updates");
    expect(insert.params.slice(0, 8)).toEqual([501, JEE_EXAM_ID, 2027, "filled", "270310000001", null, null, null]);
    const [tick] = writesTo("UPDATE blended_learning_action_items");
    expect(tick.sql).toMatch(/SET status = 'done', completed_by_jee_form_update_id = \$3/);
    expect(tick.sql).toContain("item.status = 'open'");
    expect(tick.params).toEqual([501, "JEE Form Filling (Reminder)", 900, MENTOR_A]);
    expect(writesTo("blended_learning_mentor_flags")).toEqual([]);
    expect(res.body.form.current).toMatchObject({ status: "filled", applicationNumber: "270310000001", hasConfirmation: false });
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
        body: JSON.stringify({ application_number: "270310000001" }),
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
        JSON.stringify({ application_number: "270310000001", exam_year: 2027 }),
      ],
    ]);
  });

  it("sends nothing to the DB Service when the stored 2027 record already has the number", async () => {
    examRecords = [{ id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "270310000001" }];
    signedInAs(MENTOR_A);

    expect((await record("501", FILLED)).status).toBe(201);
    expect(fetchCalls).toEqual([]);
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
    expect(mockWithTransaction).not.toHaveBeenCalled();
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
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(error.mock.calls).toEqual([["JEE form external write failed:", "DbServiceExamRecordStatusError"]]);
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
    expect(sql.some((text) => text.includes("student_exam_record"))).toBe(false);
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

  it("rethrows anything else, withdrawing a stored confirmation", async () => {
    signedInAs(MENTOR_A);
    mockWithTransaction.mockRejectedValueOnce(new Error("connection lost"));
    await expect(POST(jeeRequest("501", FILLED, PDF), routeParams({ id: "501" }))).rejects.toThrow("connection lost");
    expect(fetchCalls.at(-1)).toMatchObject({ method: "DELETE", url: "http://db-service.test/api/lms-student-document/4401" });
  });
});

describe("the application password is never touched", () => {
  it("never selects, writes, sends or returns application_password", async () => {
    examRecords = [{ id: 77, exam_id: JEE_EXAM_ID, exam_name: "JEE Mains", exam_year: 2027, application_number: "111" }];
    signedInAs(MENTOR_A);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const responses = [await record("501", FILLED, PDF), await record("501", NOT_FILLED)];
    examRecords = [];
    responses.push(await record("501", [["status", "filled"], ["applicationNumber", "999"]]));

    for (const text of sql) {
      expect(text).not.toMatch(/password/i);
      expect(text).not.toMatch(/SELECT\s+\*/i);
    }
    expect(fetchCalls.length).toBeGreaterThan(0);
    for (const call of fetchCalls) expect(call.body ?? "").not.toMatch(/password/i);
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.text).not.toMatch(/password/i);
      expect(res.text).not.toContain(STORED_PASSWORD);
    }
    expect(JSON.stringify(error.mock.calls)).not.toContain(STORED_PASSWORD);
    error.mockRestore();
  });
});
