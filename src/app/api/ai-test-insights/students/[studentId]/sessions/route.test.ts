import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The Session Notes read of the Student page (#574) through the real Student
// access helper, the real permission matrix, the real route opening and the
// real Session Notes module. The session and the Postgres boundary are
// stubbed: Postgres answers the permission row, centre seats, the
// listed-Student rows of one Student, the actor's User by email, and the
// drafts in `drafts`, filtered by Student and author as the SQL says. The
// History timeline's reads find nothing here (route.timeline.test.ts).
const { mockQuery, mockGetServerSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery, withTransaction: vi.fn() }));

import { GET } from "./route";

const email = "staff@avantifellows.org";
const MARKER = "[marker-574-read]";

// Student 1001 is listed by centre 301 of School JNV001; 2001 by centre 401
// of another School, JNV002.
const LISTED: Record<string, Array<Record<string, unknown>>> = {
  "1001": [
    {
      student_id: "1001", user_id: "5001", centre_id: "301", program_id: "1", grade: 11,
      school_id: "9", school_code: "JNV001", school_udise: "29000000001", school_region: "South",
    },
  ],
  "2001": [
    {
      student_id: "2001", user_id: "6001", centre_id: "401", program_id: "1", grade: 12,
      school_id: "10", school_code: "JNV002", school_udise: "29000000002", school_region: "South",
    },
  ],
};

const VIEW_ONLY_ROLES = ["program_manager", "program_admin", "admin"] as const;
const NO_FEATURE_ROLES = [
  "holistic_mentorship_admin",
  "pmu_manager",
  "pmu_govt_school_user",
  "blended_mentor",
  "blended_admin",
  "alumni_manager",
] as const;

/** Drafts as Postgres holds them (`session_date` read with `to_char`). */
type DraftRow = {
  student_id: number;
  author_user_id: number;
  state: string;
  revision: number;
  session_date: string | null;
  areas_of_concern: string | null;
  immediate_actions: string | null;
  other_notes: string | null;
};

let permissionRow: Record<string, unknown> | null;
let usersByEmail: Array<Record<string, unknown>>;
let drafts: DraftRow[];

function row(role: string, overrides: Record<string, unknown> = {}) {
  return {
    email,
    level: role === "admin" ? 3 : 1,
    role,
    school_codes: role === "admin" ? null : ["JNV001"],
    regions: null,
    program_ids: role.startsWith("pmu") ? [64] : [1, 2],
    read_only: false,
    user_id: 777,
    ...overrides,
  };
}

const draftOf = (author: number, overrides: Partial<DraftRow> = {}): DraftRow => ({
  student_id: 1001,
  author_user_id: author,
  state: "draft",
  revision: 2,
  session_date: "2026-11-26",
  areas_of_concern: `Concern ${MARKER}`,
  immediate_actions: null,
  other_notes: "  as typed  ",
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  for (const level of ["error", "info", "warn", "log"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  permissionRow = row("teacher");
  usersByEmail = [];
  drafts = [];
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    if (sql.includes('FROM "user"') && sql.includes("LOWER(email)")) return usersByEmail;
    if (sql.includes("FROM ai_test_insight_sessions") && sql.includes("state = 'draft'")) {
      expect(sql).toMatch(/student_id = \$1 AND author_user_id = \$2 AND state = 'draft'/);
      return drafts.filter((d) => d.student_id === params[0] && d.author_user_id === params[1] && d.state === "draft");
    }
    return [];
  });
});

async function get(studentId: string, search = "") {
  return GET(new NextRequest(`http://localhost/api/ai-test-insights/students/${studentId}/sessions${search}`), {
    params: Promise.resolve({ studentId }),
  });
}

const draftReads = () =>
  mockQuery.mock.calls.filter(
    ([sql]) => String(sql).includes("ai_test_insight_sessions") && String(sql).includes("state = 'draft'"),
  );

describe("GET /api/ai-test-insights/students/[studentId]/sessions", () => {
  it("answers a Teacher with their own draft, write access and an empty timeline, never cached", async () => {
    drafts = [draftOf(777)];

    const response = await get("1001");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      timeline: [],
      draft: {
        revision: 2,
        sessionDate: "2026-11-26",
        areasOfConcern: `Concern ${MARKER}`,
        immediateActions: null,
        otherNotes: "  as typed  ",
      },
      notesAccess: "write",
    });
  });

  it("answers draft null to a Teacher with no draft", async () => {
    expect(await (await get("1001")).json()).toEqual({ timeline: [], draft: null, notesAccess: "write" });
  });

  it("never gives a Teacher another Teacher's draft of the same Student", async () => {
    drafts = [draftOf(888)];

    expect(await (await get("1001")).json()).toEqual({ timeline: [], draft: null, notesAccess: "write" });
  });

  it("gives a Teacher none of their submitted sessions as the draft", async () => {
    drafts = [draftOf(777, { state: "submitted" })];

    expect((await (await get("1001")).json()).draft).toBeNull();
  });

  it("finds the Teacher's draft through the User with the same email when the permission links none", async () => {
    permissionRow = row("teacher", { user_id: null });
    usersByEmail = [{ id: "888" }];
    drafts = [draftOf(888)];

    const body = await (await get("1001")).json();

    expect(body.notesAccess).toBe("write");
    expect(body.draft).toMatchObject({ revision: 2, areasOfConcern: `Concern ${MARKER}` });
  });

  it("answers no_linked_user and no draft to a Teacher with no User", async () => {
    permissionRow = row("teacher", { user_id: null });

    expect(await (await get("1001")).json()).toEqual({ timeline: [], draft: null, notesAccess: "no_linked_user" });
    expect(draftReads()).toHaveLength(0);
  });

  it.each([...VIEW_ONLY_ROLES])("answers %s read access and no draft, reading no draft", async (role) => {
    permissionRow = row(role);
    drafts = [draftOf(777)];

    const response = await get("1001");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ timeline: [], draft: null, notesAccess: "read" });
    expect(draftReads()).toHaveLength(0);
  });

  it("answers a read_only Teacher read access and no draft, even their own", async () => {
    permissionRow = row("teacher", { read_only: true });
    drafts = [draftOf(777)];

    expect(await (await get("1001")).json()).toEqual({ timeline: [], draft: null, notesAccess: "read" });
  });

  describe("refusal order", () => {
    it("answers 401 without a session, before checking the id", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect((await get("1001")).status).toBe(401);
      expect((await get("abc")).status).toBe(401);
    });

    it.each(["abc", "0", "-1", "1.5"])("answers 422 for the id %j, before the feature check", async (id) => {
      permissionRow = row("pmu_manager");

      expect((await get(id)).status).toBe(422);
    });

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, whose role has no AI Test Insights view", async (role) => {
      permissionRow = row(role);

      expect((await get("1001")).status).toBe(403);
      expect(draftReads()).toHaveLength(0);
    });

    it("answers 403 to a Teacher with only JNV NVS", async () => {
      permissionRow = row("teacher", { program_ids: [64] });

      expect((await get("1001")).status).toBe(403);
    });

    it.each(["teacher", ...VIEW_ONLY_ROLES])("answers 404 to %s for a Student who does not exist", async (role) => {
      permissionRow = row(role);

      expect((await get("9999")).status).toBe(404);
      expect(draftReads()).toHaveLength(0);
    });

    it("answers 404 to a Teacher for a listed Student of another School, reading no draft", async () => {
      drafts = [draftOf(777, { student_id: 2001 })];

      expect((await get("2001")).status).toBe(404);
      expect(draftReads()).toHaveLength(0);
    });
  });

  it("answers 500 for a database error, logging only the Student's id and the error name", async () => {
    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM user_permission")) return [permissionRow];
      if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
      if (sql.includes("ai_test_insight_sessions")) {
        throw Object.assign(new Error(`bad value "${MARKER}"`), { name: "DatabaseError" });
      }
      return [];
    });

    const response = await get("1001");

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("1001");
    expect(logged).toContain("DatabaseError");
    expect(logged).not.toContain(MARKER);
  });
});
