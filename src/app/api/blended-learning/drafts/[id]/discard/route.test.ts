import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);

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
const MAPPINGS: Record<number, number> = { 501: 9001, 503: 9001, 504: 9001, 505: 9001, 506: 9001, 601: 9002 };

type Draft = { id: number; student_id: number; state: string; discarded_at: string | null };
// The drafts table; the UPDATE stamps discarded_at with this time.
let drafts: Draft[];
const NOW = "2026-10-22 06:00:00";

beforeEach(() => {
  vi.clearAllMocks();
  drafts = [
    { id: 41, student_id: 501, state: "transcribing", discarded_at: null },
    { id: 43, student_id: 503, state: "failed", discarded_at: null },
    { id: 44, student_id: 504, state: "ready", discarded_at: null },
    { id: 45, student_id: 505, state: "discarded", discarded_at: "2026-10-01 10:00:00" },
    { id: 46, student_id: 506, state: "saved", discarded_at: null },
    // Another Mentor's Mentee.
    { id: 61, student_id: 601, state: "ready", discarded_at: null },
  ];
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
    // SET state = $2, discarded_at = now() … WHERE id = $1 AND state IN ('transcribing', 'ready', 'failed')
    if (sql.includes("UPDATE blended_learning_conversation_drafts")) {
      const [draftId, state] = params ?? [];
      const rows = drafts.filter(
        (row) => row.id === Number(draftId) && ["transcribing", "ready", "failed"].includes(row.state)
      );
      for (const row of rows) Object.assign(row, { state, discarded_at: NOW });
      return rows.map((row) => ({ id: String(row.id) }));
    }
    if (sql.includes("FROM blended_learning_conversation_drafts")) {
      const draft = drafts.find((row) => row.id === Number(params?.[0]));
      return draft
        ? [{ id: String(draft.id), student_id: String(draft.student_id), state: draft.state, request_key: null, request_state: null, etl_run_id: null }]
        : [];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
});

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function discard(draftId: string) {
  const res = await POST(
    jsonRequest(`http://localhost/api/blended-learning/drafts/${draftId}/discard`, { method: "POST" }),
    routeParams({ id: draftId })
  );
  return { status: res.status, body: await res.json() };
}

describe("POST /api/blended-learning/drafts/[id]/discard", () => {
  it.each([
    ["a transcribing draft", "41"],
    ["a failed draft", "43"],
    ["a ready draft", "44"],
  ])("discards %s and stamps discarded_at", async (_case, draftId) => {
    signedInAs(MENTOR_A);

    expect(await discard(draftId)).toEqual({ status: 200, body: { id: Number(draftId), state: "discarded" } });
    expect(drafts.find((row) => row.id === Number(draftId))).toMatchObject({ state: "discarded", discarded_at: NOW });
  });

  it.each([
    ["an already discarded draft", "45"],
    ["a saved draft", "46"],
  ])("returns 409 for %s and changes nothing", async (_case, draftId) => {
    signedInAs(MENTOR_A);
    const before = structuredClone(drafts);

    expect(await discard(draftId)).toEqual({ status: 409, body: { error: "This draft can't be discarded now." } });
    expect(drafts).toEqual(before);
  });

  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await discard("43")).status).toBe(401);
  });

  // Blended Learning Admins are view only: only Mentors discard.
  it.each([
    ["a Blended Learning Admin", ADMIN],
    ["a read-only Blended Learning Admin", ADMIN_READ_ONLY],
    ["a user without Blended Learning access", TEACHER],
  ])("returns 403 to %s and changes nothing", async (_case, email) => {
    signedInAs(email);
    const before = structuredClone(drafts);

    expect(await discard("43")).toEqual({ status: 403, body: { error: "Forbidden" } });
    expect(drafts).toEqual(before);
  });

  it.each([
    ["another Mentor's Mentee's draft", "61"],
    ["a draft that doesn't exist", "99"],
    ["a malformed id", "4x"],
  ])("returns 404 for %s", async (_case, draftId) => {
    signedInAs(MENTOR_A);
    const before = structuredClone(drafts);

    expect(await discard(draftId)).toEqual({ status: 404, body: { error: "Not found" } });
    expect(drafts).toEqual(before);
  });
});
