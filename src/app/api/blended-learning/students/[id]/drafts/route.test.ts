import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { jsonRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { getServerSession } from "next-auth";
import { query, withTransaction } from "@/lib/db";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
// S3 holds the uploaded recording; HeadObject confirms it and its size.
const s3 = mockClient(S3Client);
// etl-next's enqueue endpoint is the wake call's process boundary.
const mockFetch = vi.fn();

const MENTOR_A = "faizan@avantifellows.org";
const ADMIN = "juned@avantifellows.org";
const ADMIN_READ_ONLY = "shalinijha@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

// Fixture tables, keyed the way the SQL reads them.
const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
// Active Mappings by Student. Student 503 has none.
const MAPPINGS: Record<number, { mentor_user_id: number; program_id: number; academic_year: string }> = {
  501: { mentor_user_id: 9001, program_id: 80, academic_year: "2026-2027" },
  502: { mentor_user_id: 9001, program_id: 81, academic_year: "2026-2027" },
  601: { mentor_user_id: 9002, program_id: 91, academic_year: "2026-2027" },
};
// Student 502 already has an open (ready) draft: the open-draft unique index
// rejects a second one.
const STUDENTS_WITH_OPEN_DRAFT = new Set([502]);

const KEY_501 = "lms-documents/blended-learning/recordings/501/3f2b8c1e-7d4a-4c9b-8e21-5a6f0d9c1b2e.mp3";
const KEY_601 = "lms-documents/blended-learning/recordings/601/9a1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e.m4a";
const KEY_502 = "lms-documents/blended-learning/recordings/502/11111111-2222-4333-8444-555555555555.wav";
// Objects in S3 and their stored sizes.
const OBJECTS: Record<string, number> = { [KEY_501]: 4_200_000, [KEY_601]: 900_000, [KEY_502]: 1000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Row = Record<string, unknown>;
// Committed rows by table. A transaction's writes land here only when its
// callback resolves; a throw rolls them back.
let tables: { drafts: Row[]; requests: Row[] };
let transactions: number;
let nextDraftId: number;

function columnsOf(sql: string): string[] {
  const match = sql.match(/INSERT INTO \w+\s*\(([^)]+)\)/);
  return match ? match[1].split(",").map((column) => column.trim()) : [];
}

function givenTables() {
  tables = { drafts: [], requests: [] };
  transactions = 0;
  nextDraftId = 41;
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_permission")) {
      const email = String(params?.[0]).toLowerCase();
      const row = PERMISSIONS[email];
      return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
    }
    if (sql.includes("FROM blended_learning_mentor_mentee_mappings")) {
      const mapping = MAPPINGS[Number(params?.[0])];
      return mapping ? [mapping] : [];
    }
    return [];
  });
  mockWithTransaction.mockImplementation(async (fn) => {
    transactions += 1;
    const pending = { drafts: tables.drafts.map((row) => ({ ...row })), requests: tables.requests.map((row) => ({ ...row })) };
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("FROM blended_learning_mentor_mentee_mappings")) {
          const mapping = MAPPINGS[Number(params[0])];
          return { rows: mapping ? [mapping] : [] };
        }
        if (sql.includes("INSERT INTO blended_learning_conversation_drafts")) {
          const row: Row = Object.fromEntries(columnsOf(sql).map((column, index) => [column, params[index]]));
          if (STUDENTS_WITH_OPEN_DRAFT.has(Number(row.student_id))) {
            throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
          }
          row.id = nextDraftId++;
          pending.drafts.push(row);
          return { rows: [{ id: String(row.id) }] };
        }
        if (sql.includes("INSERT INTO blended_learning_transcription_requests")) {
          const row: Row = Object.fromEntries(columnsOf(sql).map((column, index) => [column, params[index]]));
          pending.requests.push({ etl_run_id: null, error_code: null, ...row });
          return { rows: [] };
        }
        // SET state = $2, etl_run_id = $3, error_code = $4, error_message = $5
        // WHERE request_key = $1 AND state = 'queued' AND etl_run_id IS NULL
        if (sql.includes("UPDATE blended_learning_transcription_requests")) {
          const [requestKey, state, etlRunId, errorCode, errorMessage] = params;
          const rows = pending.requests.filter(
            (row) => row.request_key === requestKey && row.state === "queued" && row.etl_run_id === null
          );
          for (const row of rows) Object.assign(row, { state, etl_run_id: etlRunId, error_code: errorCode, error_message: errorMessage });
          return { rows: rows.map((row) => ({ draft_id: String(row.draft_id) })) };
        }
        // SET state = $2 WHERE id = $1 AND state = 'transcribing'
        if (sql.includes("UPDATE blended_learning_conversation_drafts")) {
          const [draftId, state] = params;
          const rows = pending.drafts.filter((row) => row.id === Number(draftId) && row.state === "transcribing");
          for (const row of rows) row.state = state;
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL in transaction: ${sql}`);
      }),
    };
    const result = await fn(client as never);
    tables = pending;
    return result;
  });
}

function configureEtl() {
  vi.stubEnv("BLENDED_LEARNING_ETL_URL", "https://etl.test/");
  vi.stubEnv("BLENDED_LEARNING_ETL_TOKEN", "etl-machine-token");
  vi.stubEnv("APP_ENV", "staging");
}

const UPLOADED = { s3Key: KEY_501, contentType: "audio/mpeg", byteSize: 4_200_000 };

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function createDraft(studentId: string, body: unknown) {
  const res = await POST(
    jsonRequest(`http://localhost/api/blended-learning/students/${studentId}/drafts`, { method: "POST", body }),
    routeParams({ id: studentId })
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Today is 22 Oct 2026 in IST.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T06:00:00Z"));
  givenTables();
  s3.reset();
  s3.on(HeadObjectCommand).callsFake(async (input: { Key: string }) => {
    if (input.Key in OBJECTS) return { ContentLength: OBJECTS[input.Key] };
    throw Object.assign(new Error("NotFound"), { name: "NotFound" });
  });
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("S3_DOCS_BUCKET", "test-bucket");
  vi.stubEnv("S3_DOCS_PREFIX", "lms-documents");
  // ETL is unconfigured unless a test configures it.
  vi.stubEnv("BLENDED_LEARNING_ETL_URL", "");
  vi.stubEnv("BLENDED_LEARNING_ETL_TOKEN", "");
  vi.stubEnv("APP_ENV", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/blended-learning/students/[id]/drafts", () => {
  it("creates a transcribing draft and a queued Transcription Request in one transaction; unconfigured ETL is skipped", async () => {
    signedInAs(MENTOR_A);
    const res = await createDraft("501", {
      s3Key: KEY_501,
      contentType: "audio/mpeg",
      byteSize: 4_200_000,
      occurredOn: "2026-10-21",
      mode: "call",
      spokeWith: "both",
      durationMinutes: 35,
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ draftId: 41, delivery: "skipped" });
    expect(transactions).toBe(1);
    expect(tables.drafts).toEqual([
      expect.objectContaining({
        id: 41,
        student_id: 501,
        program_id: 80,
        academic_year: "2026-2027",
        mentor_user_id: 9001,
        created_by_user_id: 9001,
        created_by_email: MENTOR_A,
        state: "transcribing",
        occurred_on: "2026-10-21",
        mode: "call",
        spoke_with: "both",
        duration_minutes: 35,
        call_recording_s3_key: KEY_501,
        recording_content_type: "audio/mpeg",
        recording_byte_size: 4_200_000,
      }),
    ]);
    expect(tables.requests).toEqual([
      expect.objectContaining({
        request_key: expect.stringMatching(UUID),
        draft_id: 41,
        student_id: 501,
        requested_by_user_id: 9001,
        requested_by_email: MENTOR_A,
        state: "queued",
        etl_run_id: null,
      }),
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("lets a Blended Learning Admin create the draft for the mapped Mentor, with no session details", async () => {
    signedInAs(ADMIN);
    const res = await createDraft("601", { s3Key: KEY_601, contentType: "audio/mp4", byteSize: 900_000 });

    expect(res.status).toBe(201);
    expect(tables.drafts).toEqual([
      expect.objectContaining({
        student_id: 601,
        program_id: 91,
        mentor_user_id: 9002,
        created_by_user_id: 11,
        created_by_email: ADMIN,
        state: "transcribing",
        occurred_on: null,
        mode: null,
        spoke_with: null,
        duration_minutes: null,
        recording_content_type: "audio/mp4",
        recording_byte_size: 900_000,
      }),
    ]);
    expect(tables.requests).toEqual([expect.objectContaining({ draft_id: 41, requested_by_email: ADMIN, state: "queued" })]);
  });

  it.each([
    ["another Student's recording", KEY_601],
    ["a photo key", "lms-documents/blended-learning/photos/501/3f2b8c1e-7d4a-4c9b-8e21-5a6f0d9c1b2e.jpg"],
    ["a key with a path after the prefix", "lms-documents/blended-learning/recordings/501/../601/9a1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e.m4a"],
    ["a key that isn't a UUID", "lms-documents/blended-learning/recordings/501/call.mp3"],
    ["a key with the wrong extension", "lms-documents/blended-learning/recordings/501/3f2b8c1e-7d4a-4c9b-8e21-5a6f0d9c1b2e.ogg"],
    ["a key under another prefix", "other-prefix/blended-learning/recordings/501/3f2b8c1e-7d4a-4c9b-8e21-5a6f0d9c1b2e.mp3"],
    ["no key", undefined],
  ])("rejects %s (422) and creates nothing", async (_case, s3Key) => {
    signedInAs(MENTOR_A);
    const res = await createDraft("501", { s3Key, contentType: "audio/mpeg", byteSize: 4_200_000 });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ s3Key: expect.any(String) });
    expect(transactions).toBe(0);
    expect(s3.commandCalls(HeadObjectCommand)).toHaveLength(0);
  });

  it.each([
    ["no object at the key", "lms-documents/blended-learning/recordings/501/00000000-0000-4000-8000-000000000000.mp3", 1000],
    ["an object of a different size", KEY_501, 4_199_999],
  ])("rejects %s (422) and creates nothing", async (_case, s3Key, byteSize) => {
    signedInAs(MENTOR_A);
    const res = await createDraft("501", { s3Key, contentType: "audio/mpeg", byteSize });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "The recording didn't finish uploading. Upload it again.",
      fieldErrors: { s3Key: "The recording didn't finish uploading. Upload it again." },
    });
    expect(transactions).toBe(0);
  });

  it.each([
    ["a future date", { occurredOn: "2026-10-23" }, "occurredOn"],
    ["a date that isn't one", { occurredOn: "2026-02-30" }, "occurredOn"],
    ["an unknown mode", { mode: "video" }, "mode"],
    ["an unknown spoke-with", { spokeWith: "teacher" }, "spokeWith"],
    ["a 0-minute duration", { durationMinutes: 0 }, "durationMinutes"],
    ["a 241-minute duration", { durationMinutes: 241 }, "durationMinutes"],
    ["a fractional duration", { durationMinutes: 12.5 }, "durationMinutes"],
  ])("rejects %s in the session details (422) and creates nothing", async (_case, details, field) => {
    signedInAs(MENTOR_A);
    const res = await createDraft("501", { s3Key: KEY_501, contentType: "audio/mpeg", byteSize: 4_200_000, ...details });

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors)).toEqual([field]);
    expect(transactions).toBe(0);
  });

  it("accepts today's date and the 1- and 240-minute bounds", async () => {
    signedInAs(MENTOR_A);
    const res = await createDraft("501", {
      s3Key: KEY_501,
      contentType: "audio/mpeg",
      byteSize: 4_200_000,
      occurredOn: "2026-10-22",
      durationMinutes: 240,
    });
    expect(res.status).toBe(201);
    expect(tables.drafts[0]).toEqual(expect.objectContaining({ occurred_on: "2026-10-22", duration_minutes: 240 }));
  });

  it("returns 409 when the open-draft unique index refuses a second draft, and keeps nothing", async () => {
    signedInAs(MENTOR_A);
    const res = await createDraft("502", { s3Key: KEY_502, contentType: "audio/wav", byteSize: 1000 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This Mentee already has a Conversation Draft." });
    expect(tables).toEqual({ drafts: [], requests: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await createDraft("501", { s3Key: KEY_501, byteSize: 4_200_000 })).status).toBe(401);
  });

  it.each([
    ["a read-only Blended Learning Admin", ADMIN_READ_ONLY],
    ["a user without Blended Learning access", TEACHER],
  ])("returns 403 to %s and creates nothing", async (_case, email) => {
    signedInAs(email);
    expect((await createDraft("501", { s3Key: KEY_501, byteSize: 4_200_000 })).status).toBe(403);
    expect(transactions).toBe(0);
  });

  it.each([
    ["another Mentor's Mentee", "601", KEY_601],
    ["an unmapped Student", "503", KEY_501],
    ["a malformed id", "50x", KEY_501],
  ])("returns 404 for %s and creates nothing", async (_case, studentId, s3Key) => {
    signedInAs(MENTOR_A);
    expect((await createDraft(studentId, { s3Key, byteSize: 4_200_000 })).status).toBe(404);
    expect(transactions).toBe(0);
  });

  describe("waking etl-next", () => {
    it("POSTs the new request key to etl-next's enqueue endpoint and reports sent on 2xx", async () => {
      configureEtl();
      mockFetch.mockResolvedValue(new Response(null, { status: 202 }));
      signedInAs(MENTOR_A);

      const res = await createDraft("501", UPLOADED);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ draftId: 41, delivery: "sent" });
      const key = tables.requests[0].request_key as string;
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`https://etl.test/api/internal/blended-learning/transcription-requests/${key}/enqueue`);
      expect(init).toEqual(
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer etl-machine-token", "Content-Type": "application/json" },
          body: JSON.stringify({ environment: "staging" }),
          signal: expect.any(AbortSignal),
        })
      );
      expect(tables.requests[0]).toEqual(expect.objectContaining({ state: "queued", etl_run_id: null }));
      expect(tables.drafts[0].state).toBe("transcribing");
    });

    it.each([
      ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
      ["a timeout", () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))],
      ["a 500", () => Promise.resolve(new Response(null, { status: 500 }))],
      ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
      ["a 408", () => Promise.resolve(new Response(null, { status: 408 }))],
      ["a 429", () => Promise.resolve(new Response(null, { status: 429 }))],
    ])("reports ambiguous on %s and leaves the request queued and the draft transcribing", async (_case, respond) => {
      configureEtl();
      mockFetch.mockImplementation(respond);
      signedInAs(MENTOR_A);

      const res = await createDraft("501", UPLOADED);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ draftId: 41, delivery: "ambiguous" });
      expect(tables.requests).toEqual([expect.objectContaining({ state: "queued", etl_run_id: null, error_code: null })]);
      expect(tables.drafts[0].state).toBe("transcribing");
    });

    it.each([[400], [401], [403], [404], [422]])(
      "reports rejected on a %i and marks the request and the draft failed",
      async (status) => {
        configureEtl();
        mockFetch.mockResolvedValue(new Response(null, { status }));
        signedInAs(MENTOR_A);

        const res = await createDraft("501", UPLOADED);

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ draftId: 41, delivery: "rejected" });
        const key = tables.requests[0].request_key as string;
        expect(tables.requests).toEqual([
          expect.objectContaining({
            state: "failed",
            etl_run_id: `rejected-${key}`,
            error_code: "enqueue_rejected",
            error_message: expect.any(String),
          }),
        ]);
        expect(tables.drafts[0].state).toBe("failed");
        // The create and the rejection are separate transactions.
        expect(transactions).toBe(2);
      }
    );

    it("leaves a draft that is no longer transcribing alone when the wake is rejected", async () => {
      configureEtl();
      // Discarded in another tab while the wake call was in flight.
      mockFetch.mockImplementation(async () => {
        tables.drafts[0].state = "discarded";
        return new Response(null, { status: 404 });
      });
      signedInAs(MENTOR_A);

      const res = await createDraft("501", UPLOADED);

      expect(res.body.delivery).toBe("rejected");
      expect(tables.requests[0].state).toBe("failed");
      expect(tables.drafts[0].state).toBe("discarded");
    });

    it.each([
      ["the URL is missing", { BLENDED_LEARNING_ETL_URL: "" }],
      ["the URL is blank", { BLENDED_LEARNING_ETL_URL: " " }],
      ["the token is missing", { BLENDED_LEARNING_ETL_TOKEN: "" }],
      ["APP_ENV is missing", { APP_ENV: "" }],
      ["APP_ENV is development", { APP_ENV: "development" }],
    ])("skips the wake with no fetch and no error when %s", async (_case, env) => {
      configureEtl();
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
      signedInAs(MENTOR_A);

      const res = await createDraft("501", UPLOADED);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ draftId: 41, delivery: "skipped" });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(tables.requests[0]).toEqual(expect.objectContaining({ state: "queued", etl_run_id: null }));
      expect(tables.drafts[0].state).toBe("transcribing");
    });

    it("wakes etl-next in production too", async () => {
      configureEtl();
      vi.stubEnv("APP_ENV", "production");
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      signedInAs(MENTOR_A);

      expect((await createDraft("501", UPLOADED)).body.delivery).toBe("sent");
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ environment: "production" });
    });

    it("never logs the request key or the recording key", async () => {
      configureEtl();
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));
      const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
      for (const spy of logs) spy.mockImplementation(() => {});
      signedInAs(MENTOR_A);

      await createDraft("501", UPLOADED);

      const logged = logs.flatMap((spy) => spy.mock.calls.flat()).join(" ");
      expect(logged).not.toContain(tables.requests[0].request_key as string);
      expect(logged).not.toContain("blended-learning/recordings");
      for (const spy of logs) spy.mockRestore();
    });
  });
});
