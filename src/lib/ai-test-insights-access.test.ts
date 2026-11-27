import { beforeEach, describe, expect, it, vi } from "vitest";

// Student access for AI Test Insights (#557) through the real permission
// matrix: only the session and the Postgres `query()` boundary are stubbed.
// The fake answers each read by what it asks for, as Postgres would: the
// permission row, centre seats, and the listed-Student rows of one Student
// (one per centre that lists them). Which Students are listed is the
// database's answer, declared here by hand; the e2e spec proves the real
// predicate against the fixture database.
const { mockQuery, mockGetServerSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { aiTestInsightsTabHasScope, resolveAiTestInsightsStudentAccess } from "./ai-test-insights-access";
import type { UserPermission } from "./permissions";

const email = "staff@avantifellows.org";

// JNV001 (school id 9) has two active physical centres: 301 (JNV CoE,
// Program 1) and 302 (JNV Nodal, Program 2). JNV002 (school id 10) has 401.
const CENTRES = [
  { id: "301", school_id: "9", school_code: "JNV001", program_id: 1 },
  { id: "302", school_id: "9", school_code: "JNV001", program_id: 2 },
  { id: "401", school_id: "10", school_code: "JNV002", program_id: 1 },
];
const SCHOOL_COLUMNS = {
  "9": { school_id: "9", school_code: "JNV001", school_udise: "29000000001", school_region: "South" },
  "10": { school_id: "10", school_code: "JNV002", school_udise: "29000000002", school_region: "South" },
} as const;

function listedRow(studentId: string, userId: string, centreId: string, grade: number) {
  const centre = CENTRES.find((c) => c.id === centreId)!;
  return {
    student_id: studentId,
    user_id: userId,
    centre_id: centreId,
    program_id: centre.program_id,
    grade,
    ...SCHOOL_COLUMNS[centre.school_id as "9" | "10"],
  };
}

// Listed-Student rows by `student.id`. 1005 is listed by both JNV001 centres.
// 1101 to 1105 exist but are not listed (medical stream, blank stream,
// dropout, Grade 10, NVS-only batch), so the listed read returns nothing.
const LISTED: Record<string, Array<Record<string, unknown>>> = {
  "1001": [listedRow("1001", "5001", "301", 11)],
  "1003": [listedRow("1003", "5003", "302", 12)],
  "1005": [listedRow("1005", "5005", "301", 11), listedRow("1005", "5005", "302", 11)],
  "2001": [listedRow("2001", "6001", "401", 12)],
};
const NOT_LISTED = ["1101", "1102", "1103", "1104", "1105"];

const ROLES = [
  "teacher",
  "program_manager",
  "program_admin",
  "holistic_mentorship_admin",
  "admin",
  "pmu_manager",
  "pmu_govt_school_user",
  "blended_mentor",
  "blended_admin",
  "alumni_manager",
] as const;
const VIEWER_ROLES = ["teacher", "program_manager", "program_admin", "admin"] as const;
const NO_FEATURE_ROLES = ROLES.filter((role) => !(VIEWER_ROLES as readonly string[]).includes(role));

let permissionRow: Record<string, unknown> | null;
let seats: number[];

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

const isStudentRead = (sql: string) => sql.includes("centre_students");

beforeEach(() => {
  vi.resetAllMocks();
  permissionRow = row("teacher");
  seats = [];
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) {
      return seats.map((centreId) => ({ centre_id: centreId, role: "teacher", centre_active: true }));
    }
    if (/SELECT DISTINCT s\.code\s+FROM centres c/.test(sql)) {
      const ids = (params[0] as number[]).map(String);
      return [...new Set(CENTRES.filter((c) => ids.includes(c.id)).map((c) => c.school_code))].map((code) => ({ code }));
    }
    if (/SELECT DISTINCT program_id\s+FROM centres/.test(sql)) {
      const ids = (params[0] as number[]).map(String);
      return [...new Set(CENTRES.filter((c) => ids.includes(c.id)).map((c) => c.program_id))].map((program_id) => ({
        program_id,
      }));
    }
    if (isStudentRead(sql)) return LISTED[String(params[0])] ?? [];
    return [];
  });
});

function studentReads() {
  return mockQuery.mock.calls.map(([sql]) => String(sql)).filter(isStudentRead);
}

async function statusOf(studentId: string, options?: { centre?: string | null; write?: boolean }) {
  const result = await resolveAiTestInsightsStudentAccess(studentId, options);
  if (result.authorized) return 200;
  expect(result.response.status).toBe(result.status);
  return result.status;
}

describe("resolveAiTestInsightsStudentAccess", () => {
  // Review finding (PR #573, second review): an Admin below level 3 who holds a
  // centre seat is seat-confined; only their seat centres' Students open.
  describe("a level-1 Admin seated at centre 301", () => {
    beforeEach(() => {
      permissionRow = row("admin", { level: 1, school_codes: [], program_ids: [1, 2] });
      seats = [301];
    });

    it("cannot open a Student listed only by the School's other centre, even naming it", async () => {
      expect(await statusOf("1003")).toBe(404);
      expect(await statusOf("1003", { centre: "302" })).toBe(404);
    });

    it("opens a Student of their seat centre, and a Student of both centres through their seat", async () => {
      expect(await statusOf("1001")).toBe(200);
      const both = await resolveAiTestInsightsStudentAccess("1005", { centre: "302" });
      expect(both.authorized && both.student.centreId).toBe(301);
    });
  });

  it("still lets a level-3 Admin open a Student of any centre", async () => {
    permissionRow = row("admin", { level: 3, school_codes: null, program_ids: [1] });

    expect(await statusOf("1003")).toBe(200);
  });

  it("gives a Teacher the context of a listed Student of their School", async () => {
    const result = await resolveAiTestInsightsStudentAccess("1001");

    expect(result).toEqual({
      authorized: true,
      student: {
        studentId: 1001,
        userId: 5001,
        school: { id: 9, code: "JNV001", udise: "29000000001" },
        centreId: 301,
        programId: 1,
        grade: 11,
        canEdit: true,
      },
      centreNamedByPage: false,
      actor: { email: "staff@avantifellows.org", linkedUserId: 777 },
    });
  });

  it("gives no linked User when the permission links none", async () => {
    permissionRow = row("teacher", { user_id: null });

    const result = await resolveAiTestInsightsStudentAccess("1001");

    expect(result.authorized && result.actor).toEqual({ email: "staff@avantifellows.org", linkedUserId: null });
  });

  describe("refusal order", () => {
    it("answers 401 without a session, before checking the id", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect(await statusOf("1001")).toBe(401);
      expect(await statusOf("not-a-number")).toBe(401);
      expect(studentReads()).toHaveLength(0);
    });

    it.each(["abc", "0", "-5", "1.5", "1e3", " 1001", "", "9007199254740993"])(
      "answers 422 for the id %j, before the feature check",
      async (id) => {
        permissionRow = row("holistic_mentorship_admin");

        expect(await statusOf(id)).toBe(422);
        expect(studentReads()).toHaveLength(0);
      },
    );

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, whose role has no AI Test Insights view, before any Student read", async (role) => {
      permissionRow = row(role);

      expect(await statusOf("1001")).toBe(403);
      expect(await statusOf("9999")).toBe(403);
      expect(studentReads()).toHaveLength(0);
    });

    it("answers 403 to a Teacher with only JNV NVS, and to a signed-in user with no permission row", async () => {
      permissionRow = row("teacher", { program_ids: [64] });
      expect(await statusOf("1001")).toBe(403);

      permissionRow = null;
      expect(await statusOf("1001")).toBe(403);
      expect(studentReads()).toHaveLength(0);
    });

    it.each(VIEWER_ROLES)("answers 404 to %s for a Student who does not exist", async (role) => {
      permissionRow = row(role);

      expect(await statusOf("9999")).toBe(404);
    });

    it.each(NOT_LISTED)("answers 404 for Student %s, who exists but is not listed", async (id) => {
      permissionRow = row("admin");

      expect(await statusOf(id)).toBe(404);
    });

    it("lets every viewer role, including a read_only Teacher, open a listed Student", async () => {
      for (const role of VIEWER_ROLES) {
        permissionRow = row(role);
        expect(await statusOf("1001")).toBe(200);
      }
      permissionRow = row("teacher", { read_only: true });
      expect(await statusOf("1001")).toBe(200);
    });
  });

  describe("a write", () => {
    it.each([
      ["program_manager", {}],
      ["program_admin", {}],
      ["admin", {}],
      ["read_only Teacher", { read_only: true }],
    ] as const)("answers 403 to a %s before revealing whether the Student exists", async (label, overrides) => {
      permissionRow = row(label === "read_only Teacher" ? "teacher" : label, overrides);

      expect(await statusOf("9999", { write: true })).toBe(403);
      expect(await statusOf("1001", { write: true })).toBe(403);
      expect(studentReads()).toHaveLength(0);
    });

    it("lets a Teacher write for a listed Student and answers 404 for a missing one", async () => {
      expect(await statusOf("1001", { write: true })).toBe(200);
      expect(await statusOf("9999", { write: true })).toBe(404);
    });

    it.each(["abc", "0"])("still answers 422 for the id %j before the edit check", async (id) => {
      permissionRow = row("program_manager");

      expect(await statusOf(id, { write: true })).toBe(422);
    });
  });

  describe("scope", () => {
    it("answers 404 to a Teacher for a listed Student of another School, and lets an Admin open them", async () => {
      expect(await statusOf("2001")).toBe(404);

      permissionRow = row("admin");
      const result = await resolveAiTestInsightsStudentAccess("2001");
      expect(result.authorized && result.student).toMatchObject({
        studentId: 2001,
        userId: 6001,
        school: { id: 10, code: "JNV002", udise: "29000000002" },
        centreId: 401,
        programId: 1,
        grade: 12,
        canEdit: false,
      });
    });

    it("lets a Teacher of the School open a listed Student of every centre in their Programs, with no mentee mapping", async () => {
      expect(await statusOf("1001")).toBe(200);
      expect(await statusOf("1003")).toBe(200);
    });

    it("answers 404 for a Student of a centre outside the Teacher's Programs", async () => {
      permissionRow = row("teacher", { program_ids: [2] });

      expect(await statusOf("1001")).toBe(404);
      expect(await statusOf("1003")).toBe(200);
    });

    it("keeps a seat-confined Teacher to their seat centre, even when the page names another centre", async () => {
      permissionRow = row("teacher", { school_codes: [], program_ids: [] });
      seats = [301];

      expect(await statusOf("1001")).toBe(200);
      expect(await statusOf("1003")).toBe(404);
      expect(await statusOf("1003", { centre: "302" })).toBe(404);
      const result = await resolveAiTestInsightsStudentAccess("1005", { centre: "302" });
      expect(result).toMatchObject({ authorized: true, student: { centreId: 301 }, centreNamedByPage: false });
    });

    it("gives a Program Manager and a read_only Teacher the context without edit", async () => {
      permissionRow = row("program_manager");
      const pm = await resolveAiTestInsightsStudentAccess("1003");
      expect(pm).toMatchObject({
        authorized: true,
        student: { studentId: 1003, userId: 5003, centreId: 302, programId: 2, grade: 12, canEdit: false },
      });

      permissionRow = row("teacher", { read_only: true });
      const readOnly = await resolveAiTestInsightsStudentAccess("1003");
      expect(readOnly).toMatchObject({ authorized: true, student: { canEdit: false } });
    });
  });

  describe("a Student listed by two centres", () => {
    it("uses the lowest centre id when the page names no centre", async () => {
      const result = await resolveAiTestInsightsStudentAccess("1005");

      expect(result).toMatchObject({
        authorized: true,
        student: { studentId: 1005, centreId: 301, programId: 1 },
        centreNamedByPage: false,
      });
    });

    it("uses the centre the page names when the user may list it", async () => {
      const result = await resolveAiTestInsightsStudentAccess("1005", { centre: "302" });

      expect(result).toMatchObject({
        authorized: true,
        student: { studentId: 1005, centreId: 302, programId: 2 },
        centreNamedByPage: true,
      });
    });

    it.each(["401", "abc", "999", ""])("ignores the named centre %j that does not list the Student", async (centre) => {
      const result = await resolveAiTestInsightsStudentAccess("1005", { centre });

      expect(result).toMatchObject({ authorized: true, student: { centreId: 301 }, centreNamedByPage: false });
    });

    it("falls back to the centre the user may list when the named one is outside their Programs", async () => {
      permissionRow = row("teacher", { program_ids: [2] });

      const lowest = await resolveAiTestInsightsStudentAccess("1005");
      expect(lowest).toMatchObject({ authorized: true, student: { centreId: 302 }, centreNamedByPage: false });

      const named = await resolveAiTestInsightsStudentAccess("1005", { centre: "301" });
      expect(named).toMatchObject({ authorized: true, student: { centreId: 302 }, centreNamedByPage: false });
    });

    it("reads the Student once, with the list's predicate", async () => {
      await resolveAiTestInsightsStudentAccess("1005", { centre: "302" });

      expect(studentReads()).toHaveLength(1);
    });
  });
});

// The tab's visibility (PR #573 review finding 3): the list route's scope
// rule on the page's centre, or on the School's active centre Programs.
describe("aiTestInsightsTabHasScope", () => {
  const permission = (overrides: Partial<UserPermission> = {}) =>
    ({
      email,
      level: 3,
      role: "program_manager",
      school_codes: null,
      regions: null,
      program_ids: [1, 64],
      read_only: false,
      ...overrides,
    }) as UserPermission;
  const seated = (centres: number[]) =>
    permission({
      role: "teacher",
      level: 1,
      school_codes: ["JNV001"],
      scope: { schools: new Set(["JNV001"]), centres: new Set(centres), programs: new Set([1]) },
    } as Partial<UserPermission>);

  it.each([
    ["its Program is in the user's Programs", permission(), { centreId: 301, programId: 1 }, true],
    ["its Program is not in the user's Programs", permission(), { centreId: 302, programId: 2 }, false],
    ["it is JNV NVS", permission({ program_ids: [1, 64] }), { centreId: 303, programId: 64 }, false],
    ["it has no Program", permission(), { centreId: 304, programId: null }, false],
    ["the user is an Admin, whatever their Programs", permission({ role: "admin", program_ids: [1] }), { centreId: 302, programId: 2 }, true],
    ["the user is an Admin seated elsewhere", { ...seated([301]), role: "admin" } as UserPermission, { centreId: 302, programId: 2 }, false],
    ["the user is seated there", seated([302]), { centreId: 302, programId: 2 }, true],
    ["the user is seated elsewhere", seated([301]), { centreId: 302, programId: 2 }, false],
  ] as const)("on a Centre page: %s → %s", (_label, user, page, expected) => {
    expect(aiTestInsightsTabHasScope(user, page)).toBe(expected);
  });

  it.each([
    ["one active physical centre's Program is the user's", permission(), [2, 1, 64], true],
    ["none of the School's physical centre Programs is the user's", permission(), [2, 64], false],
    ["the School's only active centre is JNV NVS", permission(), [64], false],
    ["the School has no active centre", permission(), [], false],
    ["an Admin, whatever their Programs", permission({ role: "admin", program_ids: [1] }), [2, 64], true],
    ["a seat-confined user (the route refuses them without a centre)", seated([301]), [1, 2], false],
    ["a seat-confined Admin", { ...seated([301]), role: "admin" } as UserPermission, [1, 2], false],
  ] as const)("on a School page: %s → %s", (_label, user, centreProgramIds, expected) => {
    expect(aiTestInsightsTabHasScope(user, { centreProgramIds: [...centreProgramIds] })).toBe(expected);
  });
});
