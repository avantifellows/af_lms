import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
// etl-next's enqueue endpoint is the wake call's process boundary.
const mockFetch = vi.fn();

const MENTOR_A = "faizan@avantifellows.org";
const ADMIN = "juned@avantifellows.org";
const ADMIN_READ_ONLY = "shalinijha@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
// Active current-year Mappings: student → Mentor user id.
const MAPPINGS: Record<number, number> = { 501: 9001, 502: 9001, 503: 9001, 504: 9001, 505: 9001, 506: 9001, 601: 9002 };

const QUEUED_KEY = "0b7d6c3a-1f2e-4d5c-9a8b-7c6d5e4f3a2b";
const RUNNING_KEY = "5e4f3a2b-0b7d-4c3a-8f2e-1d5c9a8b7c6d";
const FAILED_KEY = "9a8b7c6d-5e4f-4a2b-8b7d-6c3a1f2e4d5c";
const OTHER_MENTOR_KEY = "1f2e4d5c-9a8b-4c6d-9e4f-3a2b0b7d6c3a";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Row = Record<string, unknown>;
// Committed rows by table. A transaction's writes land here only when its
// callback resolves; a throw rolls them back.
let tables: { drafts: Row[]; requests: Row[] };
let transactions: number;

function givenTables() {
  tables = {
    drafts: [
      // Transcribing, and the wake never reached ETL.
      { id: 41, student_id: 501, state: "transcribing" },
      // Transcribing, and ETL has picked it up.
      { id: 42, student_id: 502, state: "transcribing" },
      { id: 43, student_id: 503, state: "failed" },
      { id: 44, student_id: 504, state: "ready" },
      { id: 45, student_id: 505, state: "discarded" },
      { id: 46, student_id: 506, state: "saved" },
      // Another Mentor's Mentee.
      { id: 61, student_id: 601, state: "failed" },
    ],
    requests: [
      { request_key: QUEUED_KEY, draft_id: 41, student_id: 501, state: "queued", etl_run_id: null },
      { request_key: RUNNING_KEY, draft_id: 42, student_id: 502, state: "running", etl_run_id: "run-77" },
      { request_key: FAILED_KEY, draft_id: 43, student_id: 503, state: "failed", etl_run_id: "run-78" },
      { request_key: OTHER_MENTOR_KEY, draft_id: 61, student_id: 601, state: "failed", etl_run_id: "run-79" },
    ],
  };
  transactions = 0;

  // A draft with its active (queued or running) Transcription Request, if any.
  function draftWithActiveRequest(source: typeof tables, draftId: number) {
    const draft = source.drafts.find((row) => row.id === draftId);
    if (!draft) return [];
    const request = source.requests.find(
      (row) => row.draft_id === draftId && (row.state === "queued" || row.state === "running")
    );
    return [
      {
        id: String(draft.id),
        student_id: String(draft.student_id),
        state: draft.state,
        request_key: request?.request_key ?? null,
        request_state: request?.state ?? null,
        etl_run_id: request?.etl_run_id ?? null,
      },
    ];
  }

  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_permission")) {
      const email = String(params?.[0]).toLowerCase();
      const row = PERMISSIONS[email];
      return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
    }
    if (sql.includes("FROM blended_learning_mentor_mentee_mappings")) {
      const mentor = MAPPINGS[Number(params?.[0])];
      return mentor ? [{ mentor_user_id: mentor }] : [];
    }
    if (sql.includes("FROM blended_learning_conversation_drafts")) {
      return draftWithActiveRequest(tables, Number(params?.[0]));
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  mockWithTransaction.mockImplementation(async (fn) => {
    transactions += 1;
    const pending = { drafts: tables.drafts.map((row) => ({ ...row })), requests: tables.requests.map((row) => ({ ...row })) };
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        // SET state = $2 … WHERE id = $1 AND state = '<from>'
        if (sql.includes("UPDATE blended_learning_conversation_drafts")) {
          const [draftId, state] = params;
          const from = /AND state = '(\w+)'/.exec(sql)?.[1];
          const rows = pending.drafts.filter((row) => row.id === Number(draftId) && row.state === from);
          for (const row of rows) row.state = state;
          return { rows: rows.map((row) => ({ id: String(row.id) })) };
        }
        if (sql.includes("INSERT INTO blended_learning_transcription_requests")) {
          const columns = /INSERT INTO \w+\s*\(([^)]+)\)/.exec(sql)![1].split(",").map((column) => column.trim());
          const row: Row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
          const active = pending.requests.some(
            (other) => other.draft_id === row.draft_id && (other.state === "queued" || other.state === "running")
          );
          if (active) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
          pending.requests.push({ etl_run_id: null, ...row });
          return { rows: [] };
        }
        // SET state = $2, etl_run_id = $3, error_code = $4, error_message = $5
        // WHERE request_key = $1 AND state = 'queued' AND etl_run_id IS NULL
        if (sql.includes("UPDATE blended_learning_transcription_requests")) {
          const [requestKey, state, etlRunId, errorCode] = params;
          const rows = pending.requests.filter(
            (row) => row.request_key === requestKey && row.state === "queued" && row.etl_run_id === null
          );
          for (const row of rows) Object.assign(row, { state, etl_run_id: etlRunId, error_code: errorCode });
          return { rows: rows.map((row) => ({ draft_id: String(row.draft_id) })) };
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

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function retry(draftId: string) {
  const res = await POST(
    jsonRequest(`http://localhost/api/blended-learning/drafts/${draftId}/retry`, { method: "POST" }),
    routeParams({ id: draftId })
  );
  return { status: res.status, body: await res.json() };
}

function enqueueUrl(key: string) {
  return `https://etl.test/api/internal/blended-learning/transcription-requests/${key}/enqueue`;
}

beforeEach(() => {
  vi.clearAllMocks();
  givenTables();
  vi.stubGlobal("fetch", mockFetch);
  // ETL is unconfigured unless a test configures it.
  vi.stubEnv("BLENDED_LEARNING_ETL_URL", "");
  vi.stubEnv("BLENDED_LEARNING_ETL_TOKEN", "");
  vi.stubEnv("APP_ENV", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/blended-learning/drafts/[id]/retry", () => {
  it("wakes ETL again with the same key when the wake never reached it, and creates no new request", async () => {
    configureEtl();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: "enqueued" }), { status: 202 }));
    signedInAs(MENTOR_A);
    const before = structuredClone(tables);

    const res = await retry("41");

    expect(res).toEqual({
      status: 200,
      body: { id: 41, state: "transcribing", retryOffered: true, delivery: "sent" },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      enqueueUrl(QUEUED_KEY),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ environment: "staging" }) })
    );
    expect(tables).toEqual(before);
  });

  it("gives a failed draft a new queued request and moves it back to transcribing in one transaction", async () => {
    configureEtl();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: "enqueued" }), { status: 202 }));
    signedInAs(MENTOR_A);

    const res = await retry("43");

    expect(res).toEqual({
      status: 200,
      body: { id: 43, state: "transcribing", retryOffered: true, delivery: "sent" },
    });
    expect(transactions).toBe(1);
    expect(tables.drafts.find((row) => row.id === 43)).toEqual({ id: 43, student_id: 503, state: "transcribing" });
    const drafts43 = tables.requests.filter((row) => row.draft_id === 43);
    expect(drafts43).toEqual([
      { request_key: FAILED_KEY, draft_id: 43, student_id: 503, state: "failed", etl_run_id: "run-78" },
      {
        request_key: expect.stringMatching(UUID),
        draft_id: 43,
        student_id: 503,
        requested_by_user_id: 9001,
        requested_by_email: MENTOR_A,
        state: "queued",
        etl_run_id: null,
      },
    ]);
    const newKey = drafts43[1].request_key as string;
    expect(newKey).not.toBe(FAILED_KEY);
    expect(mockFetch).toHaveBeenCalledWith(enqueueUrl(newKey), expect.objectContaining({ method: "POST" }));
  });

  it("lets a Blended Learning Admin retry a Mentor's failed draft as themselves", async () => {
    signedInAs(ADMIN);

    const res = await retry("61");

    // Unconfigured ETL: the new request waits, queued, and the retry stays offered.
    expect(res).toEqual({
      status: 200,
      body: { id: 61, state: "transcribing", retryOffered: true, delivery: "skipped" },
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(tables.requests.filter((row) => row.draft_id === 61 && row.state === "queued")).toEqual([
      expect.objectContaining({ student_id: 601, requested_by_user_id: 11, requested_by_email: ADMIN }),
    ]);
  });

  it("fails the draft again when ETL rejects the new request", async () => {
    configureEtl();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "bad request" }), { status: 400 }));
    signedInAs(MENTOR_A);

    const res = await retry("43");

    expect(res).toEqual({
      status: 200,
      body: { id: 43, state: "failed", retryOffered: true, delivery: "rejected" },
    });
    expect(tables.drafts.find((row) => row.id === 43)?.state).toBe("failed");
    expect(tables.requests.filter((row) => row.draft_id === 43).map((row) => row.state)).toEqual(["failed", "failed"]);
  });

  it.each([
    ["a transcribing draft ETL has already picked up", "42"],
    ["a ready draft", "44"],
    ["a discarded draft", "45"],
    ["a saved draft", "46"],
  ])("returns 409 for %s and changes nothing", async (_case, draftId) => {
    configureEtl();
    signedInAs(MENTOR_A);
    const before = structuredClone(tables);

    expect(await retry(draftId)).toEqual({ status: 409, body: { error: "This draft can't be retried now." } });
    expect(tables).toEqual(before);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await retry("43")).status).toBe(401);
  });

  it.each([
    ["a read-only Blended Learning Admin", ADMIN_READ_ONLY],
    ["a user without Blended Learning access", TEACHER],
  ])("returns 403 to %s and changes nothing", async (_case, email) => {
    signedInAs(email);
    const before = structuredClone(tables);

    expect(await retry("43")).toEqual({ status: 403, body: { error: "Forbidden" } });
    expect(tables).toEqual(before);
  });

  it.each([
    ["another Mentor's Mentee's draft", "61"],
    ["a draft that doesn't exist", "99"],
    ["a malformed id", "4x"],
  ])("returns 404 for %s", async (_case, draftId) => {
    signedInAs(MENTOR_A);
    const before = structuredClone(tables);

    expect(await retry(draftId)).toEqual({ status: 404, body: { error: "Not found" } });
    expect(tables).toEqual(before);
  });
});
