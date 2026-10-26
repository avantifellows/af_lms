import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { GET } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);

const MENTOR_A = "faizan@avantifellows.org";
const MENTOR_B = "lokesh@avantifellows.org";
const ADMIN_READ_ONLY = "viewer@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

// Fixture tables, keyed the way the SQL reads them.
const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [MENTOR_B]: { role: "blended_mentor", read_only: false, user_id: 9002 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
// Active current-year Mappings: student → Mentor user id. Student 503 is unmapped.
const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002 };
const CONVERSATIONS: Record<number, { student_id: number; kind: string; notes_html: string | null }> = {
  71: { student_id: 501, kind: "conversation", notes_html: "<h3>Exams</h3><ul><li>Revise optics</li></ul>" },
  72: { student_id: 501, kind: "conversation", notes_html: null },
  73: { student_id: 501, kind: "attempt", notes_html: null },
  81: { student_id: 601, kind: "conversation", notes_html: "<p>Mentor B's notes</p>" },
  91: { student_id: 503, kind: "conversation", notes_html: "<p>Unmapped</p>" },
};

function givenTables() {
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
    if (sql.includes("FROM blended_learning_conversations")) {
      const row = CONVERSATIONS[Number(params?.[0])];
      return row ? [row] : [];
    }
    return [];
  });
}

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function getNotes(conversationId: string) {
  const res = await GET(
    new Request(`http://localhost/api/blended-learning/conversations/${conversationId}/notes`),
    routeParams({ id: conversationId })
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  givenTables();
});

describe("GET /api/blended-learning/conversations/[id]/notes", () => {
  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await getNotes("71")).status).toBe(401);
  });

  it("returns 403 for a role without Blended Learning access", async () => {
    signedInAs(TEACHER);
    expect((await getNotes("71")).status).toBe(403);
  });

  it("returns the stored notes of the Mentor's own Mentee's Conversation", async () => {
    signedInAs(MENTOR_A);
    expect(await getNotes("71")).toEqual({
      status: 200,
      body: { notesHtml: "<h3>Exams</h3><ul><li>Revise optics</li></ul>" },
    });
  });

  it("returns null notes for a Conversation saved without notes", async () => {
    signedInAs(MENTOR_A);
    expect(await getNotes("72")).toEqual({ status: 200, body: { notesHtml: null } });
  });

  it("returns 404 for another Mentor's Mentee", async () => {
    signedInAs(MENTOR_A);
    expect((await getNotes("81")).status).toBe(404);
  });

  it("returns 404 for an unmapped Student, a missing Conversation, an Attempt and a malformed id", async () => {
    signedInAs(ADMIN_READ_ONLY);
    expect((await getNotes("91")).status).toBe(404);
    expect((await getNotes("99")).status).toBe(404);
    expect((await getNotes("73")).status).toBe(404);
    expect((await getNotes("7x")).status).toBe(404);
  });

  it("lets a read-only Blended Learning Admin read any mapped Mentee's notes", async () => {
    signedInAs(ADMIN_READ_ONLY);
    expect(await getNotes("81")).toEqual({ status: 200, body: { notesHtml: "<p>Mentor B's notes</p>" } });
  });
});
