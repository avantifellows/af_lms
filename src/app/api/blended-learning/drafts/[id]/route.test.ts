import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { GET } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);

const MENTOR_A = "faizan@avantifellows.org";
const ADMIN_READ_ONLY = "shalinijha@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

// Fixture tables, keyed the way the SQL reads them.
const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
// Active current-year Mappings: student → Mentor user id.
const MAPPINGS: Record<number, number> = { 501: 9001, 502: 9001, 503: 9001, 504: 9001, 505: 9001, 601: 9002 };
// Drafts, each with its active (queued or running) Transcription Request, if any.
const DRAFTS: Record<number, { student_id: number; state: string; request_state: string | null; etl_run_id: string | null }> = {
  // Queued, and the wake never reached ETL.
  41: { student_id: 501, state: "transcribing", request_state: "queued", etl_run_id: null },
  // ETL has picked it up.
  42: { student_id: 502, state: "transcribing", request_state: "running", etl_run_id: "run-77" },
  43: { student_id: 503, state: "failed", request_state: null, etl_run_id: null },
  44: { student_id: 504, state: "ready", request_state: null, etl_run_id: null },
  45: { student_id: 505, state: "discarded", request_state: null, etl_run_id: null },
  // Another Mentor's Mentee.
  61: { student_id: 601, state: "transcribing", request_state: "queued", etl_run_id: null },
};

beforeEach(() => {
  vi.clearAllMocks();
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
      const id = Number(params?.[0]);
      const draft = DRAFTS[id];
      return draft ? [{ id: String(id), ...draft }] : [];
    }
    return [];
  });
});

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function status(draftId: string) {
  const res = await GET(
    jsonRequest(`http://localhost/api/blended-learning/drafts/${draftId}`),
    routeParams({ id: draftId })
  );
  return { status: res.status, body: await res.json() };
}

describe("GET /api/blended-learning/drafts/[id]", () => {
  it.each([
    ["a transcribing draft whose wake never reached ETL offers Retry drafting", "41", "transcribing", true],
    ["a transcribing draft ETL has picked up offers no retry", "42", "transcribing", false],
    ["a failed draft offers Retry drafting", "43", "failed", true],
    ["a ready draft offers no retry", "44", "ready", false],
    ["a discarded draft offers no retry", "45", "discarded", false],
  ])("%s", async (_case, draftId, state, retryOffered) => {
    signedInAs(MENTOR_A);
    const res = await status(draftId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: Number(draftId), state, retryOffered });
  });

  it("lets a read-only Blended Learning Admin see the state, but never offers them a retry", async () => {
    signedInAs(ADMIN_READ_ONLY);
    expect(await status("61")).toEqual({ status: 200, body: { id: 61, state: "transcribing", retryOffered: false } });
  });

  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await status("41")).status).toBe(401);
  });

  it("returns 403 to a user without Blended Learning access", async () => {
    signedInAs(TEACHER);
    expect((await status("41")).status).toBe(403);
  });

  it.each([
    ["another Mentor's Mentee's draft", "61"],
    ["a draft that doesn't exist", "99"],
    ["a malformed id", "4x"],
  ])("returns 404 for %s", async (_case, draftId) => {
    signedInAs(MENTOR_A);
    expect(await status(draftId)).toEqual({ status: 404, body: { error: "Not found" } });
  });
});
