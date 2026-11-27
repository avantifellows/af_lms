import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The AI Test Insights list route through the real gate, access module and
// permission matrix: only the session and the Postgres `query()` boundary are
// stubbed. The fake answers each read by what it asks for, as Postgres would:
// the permission row, centre seats, the School, the School's active
// physical-centre centres, and the listed Students of the centres asked for.
const { mockQuery, mockGetServerSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { GET } from "./route";

const email = "staff@avantifellows.org";

// JNV001 (school id 9) has two active physical centres: 301 (JNV CoE,
// Program 1) and 302 (JNV Nodal, Program 2). JNV002 (school id 10) has 401.
const SCHOOLS: Record<string, Record<string, unknown>> = {
  JNV001: { id: "9", code: "JNV001", name: "JNV One", region: "South", af_school_category: "JNV" },
  JNV002: { id: "10", code: "JNV002", name: "JNV Two", region: "South", af_school_category: "JNV" },
};
const CENTRES = [
  { id: "301", school_id: "9", school_code: "JNV001", program_id: 1 },
  { id: "302", school_id: "9", school_code: "JNV001", program_id: 2 },
  { id: "401", school_id: "10", school_code: "JNV002", program_id: 1 },
];

// Listed Students as the list read returns them, by the centre that lists them.
const LISTED: Array<{ centreId: string; row: Record<string, unknown> }> = [
  { centreId: "301", row: { student_id: "1001", name: "Asha Kumar", student_code: "STU1001", grade: 11 } },
  { centreId: "301", row: { student_id: "1002", name: "Bilal Khan", student_code: null, grade: 12 } },
  { centreId: "302", row: { student_id: "1003", name: "Chitra Nair", student_code: "STU1003", grade: 11 } },
  { centreId: "401", row: { student_id: "2001", name: "Dev Other", student_code: "STU2001", grade: 11 } },
];

// Count rows as the two count reads return them: submitted Insight Sessions
// (with the newest session date) and completed Test Insights, per Student.
// Bilal has a Test Insight but no session; Chitra and Asha's neighbours none.
const SESSION_COUNTS = [{ student_id: "1001", sessions_completed: 3, last_session_date: "2026-11-14" }];
const REQUEST_COUNTS = [
  { student_id: "1001", tests_generated: 2 },
  { student_id: "1002", tests_generated: 1 },
];

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
const NO_FEATURE_ROLES = ["holistic_mentorship_admin", "pmu_manager", "pmu_govt_school_user"] as const;

let permissionRow: Record<string, unknown> | null;
let seats: number[];
let schoolCentres: Record<string, Array<Record<string, unknown>>>;

function row(role: string, overrides: Record<string, unknown> = {}) {
  return {
    email,
    level: role === "admin" ? 3 : 1,
    role,
    school_codes: role === "admin" ? null : ["JNV001"],
    regions: null,
    program_ids: [1, 2],
    read_only: false,
    user_id: 777,
    ...overrides,
  };
}

const isStudentRead = (sql: string) => sql.includes("centre_students") || /FROM\s+student\b/.test(sql);

beforeEach(() => {
  vi.resetAllMocks();
  permissionRow = row("admin");
  seats = [];
  schoolCentres = {
    "9": CENTRES.filter((centre) => centre.school_id === "9").map(({ id, program_id }) => ({ id, program_id })),
    "10": CENTRES.filter((centre) => centre.school_id === "10").map(({ id, program_id }) => ({ id, program_id })),
  };
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
      return [...new Set(CENTRES.filter((c) => ids.includes(c.id)).map((c) => c.program_id))].map((program_id) => ({ program_id }));
    }
    if (sql.includes("FROM school WHERE")) {
      const school = SCHOOLS[String(params[0])];
      return school ? [school] : [];
    }
    if (sql.includes("FROM ai_test_insight_sessions") || sql.includes("FROM ai_test_insight_requests")) {
      const ids = (params[0] as number[]).map(String);
      const rows = sql.includes("FROM ai_test_insight_sessions") ? SESSION_COUNTS : REQUEST_COUNTS;
      return rows.filter((countRow) => ids.includes(countRow.student_id));
    }
    if (isStudentRead(sql)) {
      const centreIds = params.find(
        (param) => Array.isArray(param) && param.every((value) => typeof value === "number"),
      ) as number[];
      const wanted = centreIds.map(String);
      return LISTED.filter((listed) => wanted.includes(listed.centreId)).map((listed) => listed.row);
    }
    if (/FROM centres\b/.test(sql) && sql.includes("school_id = $1")) {
      return schoolCentres[String(params[0])] ?? [];
    }
    return [];
  });
});

async function get(udise = "JNV001", centreId?: string) {
  const search = centreId === undefined ? "" : `?centre_id=${encodeURIComponent(centreId)}`;
  return GET(new NextRequest(`http://localhost/api/school/${udise}/ai-test-insights${search}`), {
    params: Promise.resolve({ udise }),
  });
}

function studentReads() {
  return mockQuery.mock.calls.map(([sql]) => String(sql)).filter(isStudentRead);
}

async function listedIds(response: Response) {
  const body = (await response.json()) as { students: Array<{ studentId: number }> };
  return body.students.map((student) => student.studentId);
}

describe("GET /api/school/[udise]/ai-test-insights — refusal order", () => {
  it.each(ROLES)("answers 401 to a signed-out caller (%s row present), before any read", async (role) => {
    permissionRow = row(role);
    mockGetServerSession.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each(ROLES)("answers 404 to %s for a School that does not exist", async (role) => {
    permissionRow = row(role);

    const response = await get("NOPE999");

    expect(response.status).toBe(404);
    expect(studentReads()).toEqual([]);
  });

  it.each(ROLES.filter((role) => role !== "admin"))(
    "answers 403 to %s for a School outside their access, without reading Students",
    async (role) => {
      permissionRow = row(role, { school_codes: ["JNV002"] });

      const response = await get("JNV001");

      expect(response.status).toBe(403);
      expect(studentReads()).toEqual([]);
    },
  );

  it.each(["blended_mentor", "blended_admin", "alumni_manager"] as const)(
    "answers 403 to %s, who has no School access, without reading Students",
    async (role) => {
      permissionRow = row(role, { level: 3, school_codes: null });

      const response = await get();

      expect(response.status).toBe(403);
      expect(studentReads()).toEqual([]);
    },
  );

  it.each(NO_FEATURE_ROLES)(
    "answers 403 to %s, who has the School but not the feature, without reading Students",
    async (role) => {
      permissionRow = row(role, { level: 3, school_codes: null });

      const response = await get();

      expect(response.status).toBe(403);
      expect(studentReads()).toEqual([]);
    },
  );

  it.each(["teacher", "program_manager", "program_admin"] as const)(
    "answers 403 to an NVS-only %s, without reading Students",
    async (role) => {
      permissionRow = row(role, { program_ids: [64] });

      const response = await get();

      expect(response.status).toBe(403);
      expect(studentReads()).toEqual([]);
    },
  );

  it.each(VIEWER_ROLES)(
    "answers 403 to %s at a School with no active physical centre, without reading Students",
    async (role) => {
      permissionRow = row(role);
      schoolCentres["9"] = [];

      const response = await get();

      expect(response.status).toBe(403);
      expect(studentReads()).toEqual([]);
    },
  );
});

describe("GET /api/school/[udise]/ai-test-insights — list scope", () => {
  it("gives an Admin every active physical centre of the School", async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(await listedIds(response)).toEqual([1001, 1002, 1003]);
  });

  it("gives a read_only Admin the same list", async () => {
    permissionRow = row("admin", { read_only: true });

    const response = await get();

    expect(response.status).toBe(200);
    expect(await listedIds(response)).toEqual([1001, 1002, 1003]);
  });

  it.each(["teacher", "program_manager", "program_admin"] as const)(
    "gives a seatless %s with CoE and Nodal both centres",
    async (role) => {
      permissionRow = row(role);

      const response = await get();

      expect(response.status).toBe(200);
      expect(await listedIds(response)).toEqual([1001, 1002, 1003]);
    },
  );

  it("gives a seatless CoE-only Teacher only the CoE centre", async () => {
    permissionRow = row("teacher", { program_ids: [1] });

    const response = await get();

    expect(response.status).toBe(200);
    expect(await listedIds(response)).toEqual([1001, 1002]);
  });

  it("gives a read_only Teacher the list", async () => {
    permissionRow = row("teacher", { read_only: true });

    const response = await get();

    expect(response.status).toBe(200);
    expect(await listedIds(response)).toEqual([1001, 1002, 1003]);
  });

  it("refuses a seat-confined Teacher on the School route without a centre", async () => {
    permissionRow = row("teacher", { school_codes: [], program_ids: [] });
    seats = [301];

    const response = await get();

    expect(response.status).toBe(403);
    expect(studentReads()).toEqual([]);
  });

  it("gives a seat-confined Teacher their seat centre when the centre is named", async () => {
    permissionRow = row("teacher", { school_codes: [], program_ids: [] });
    seats = [301];

    const response = await get("JNV001", "301");

    expect(response.status).toBe(200);
    expect(await listedIds(response)).toEqual([1001, 1002]);
  });

  it("refuses a seat-confined Teacher who names another centre of the same School", async () => {
    permissionRow = row("teacher", { school_codes: [], program_ids: [] });
    seats = [301];

    const response = await get("JNV001", "302");

    expect(response.status).toBe(403);
    expect(studentReads()).toEqual([]);
  });

  it("narrows an Admin to the named centre", async () => {
    const response = await get("JNV001", "302");

    expect(response.status).toBe(200);
    expect(await listedIds(response)).toEqual([1003]);
  });

  it("refuses a named centre that belongs to another School, even for an Admin", async () => {
    const response = await get("JNV001", "401");

    expect(response.status).toBe(403);
    expect(studentReads()).toEqual([]);
  });

  it("refuses a named centre outside a seatless Teacher's Programs", async () => {
    permissionRow = row("teacher", { program_ids: [1] });

    const response = await get("JNV001", "302");

    expect(response.status).toBe(403);
    expect(studentReads()).toEqual([]);
  });

  it.each(["abc", "0", "-1", "3.5", ""])("refuses a centre_id of %j", async (centreId) => {
    const response = await get("JNV001", centreId);

    expect(response.status).toBe(403);
    expect(studentReads()).toEqual([]);
  });
});

describe("GET /api/school/[udise]/ai-test-insights — response", () => {
  it("returns each listed Student's id, name, Student ID, Grade and Insight counts", async () => {
    const response = await get();

    expect(await response.json()).toEqual({
      students: [
        {
          studentId: 1001,
          name: "Asha Kumar",
          studentCode: "STU1001",
          grade: 11,
          insightSessionsCompleted: 3,
          testInsightsGenerated: 2,
          lastInsightSessionDate: "2026-11-14",
        },
        {
          studentId: 1002,
          name: "Bilal Khan",
          studentCode: null,
          grade: 12,
          insightSessionsCompleted: 0,
          testInsightsGenerated: 1,
          lastInsightSessionDate: null,
        },
        {
          studentId: 1003,
          name: "Chitra Nair",
          studentCode: "STU1003",
          grade: 11,
          insightSessionsCompleted: 0,
          testInsightsGenerated: 0,
          lastInsightSessionDate: null,
        },
      ],
    });
  });

  it.each(["ai_test_insight_sessions", "ai_test_insight_requests"])(
    "answers 500, never zeros, when the %s count read fails",
    async (table) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const base = mockQuery.getMockImplementation()!;
      mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes(`FROM ${table}`)) throw Object.assign(new Error("relation does not exist"), { name: "DatabaseError" });
        return base(sql, params);
      });

      const response = await get();

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to load AI Test Insights" });
      consoleError.mockRestore();
    },
  );

  it("returns an empty list when the centres list no Student", async () => {
    schoolCentres["9"] = [{ id: "303", program_id: 1 }];

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ students: [] });
  });

  it("answers 500 and logs no Student name when the Student read fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const base = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (isStudentRead(sql)) throw Object.assign(new Error("relation does not exist for Asha Kumar"), { name: "DatabaseError" });
      return base(sql, params);
    });

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load AI Test Insights" });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("DatabaseError");
    expect(logged).not.toContain("Asha");
    consoleError.mockRestore();
  });
});
