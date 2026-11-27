import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The AI Summary card's test picker route (#559) through the real Student
// access helper and permission matrix: the session, the Postgres `query()`
// boundary and BigQuery are stubbed. Postgres answers the permission row,
// centre seats and the listed-Student rows of one Student; the warehouse
// answers the picker read with the rows declared here.
const { mockQuery, mockGetServerSession, mockBigQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
  mockBigQuery: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/bigquery", () => ({
  getBigQueryClient: () => ({ query: mockBigQuery }),
  FACT_TABLE: "`fact_student_test_results_overall`",
  SUBMITTED_ONLY: "AND has_quiz_ended IS NOT FALSE",
}));

import { GET } from "./route";

const email = "staff@avantifellows.org";

// Student 1001 (user 5001) is listed by centre 301 (JNV001, Program 1).
// 2001 (user 6001) is listed by centre 401 of another School, JNV002.
const LISTED: Record<string, Array<Record<string, unknown>>> = {
  "1001": [
    {
      student_id: "1001", user_id: "5001", centre_id: "301", program_id: 1, grade: 11,
      school_id: "9", school_code: "JNV001", school_udise: "29000000001", school_region: "South",
    },
  ],
  "2001": [
    {
      student_id: "2001", user_id: "6001", centre_id: "401", program_id: 1, grade: 12,
      school_id: "10", school_code: "JNV002", school_udise: "29000000002", school_region: "South",
    },
  ],
};

// The warehouse's answer for user 5001, as the picker read returns it.
const WAREHOUSE_ROWS = [
  { picker_test_id: "T9", picker_test_name: "Mock Test 1", picker_test_format: "mock_test", picker_test_date: "2026-11-02" },
  { picker_test_id: "T4", picker_test_name: "Major Test 2", picker_test_format: "major_test", picker_test_date: "2026-10-12" },
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
const NO_FEATURE_ROLES = ROLES.filter((role) => !(VIEWER_ROLES as readonly string[]).includes(role));

let permissionRow: Record<string, unknown> | null;

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

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  permissionRow = row("teacher");
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    return [];
  });
  mockBigQuery.mockResolvedValue([WAREHOUSE_ROWS]);
});

async function get(studentId: string) {
  return GET(new NextRequest(`http://localhost/api/ai-test-insights/students/${studentId}/tests`), {
    params: Promise.resolve({ studentId }),
  });
}

describe("GET /api/ai-test-insights/students/[studentId]/tests", () => {
  it("answers a Teacher with the Student's tests, newest first, read by the Student's user id", async () => {
    const response = await get("1001");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tests: [
        { id: "T9", name: "Mock Test 1", date: "2026-11-02", format: "mock_test" },
        { id: "T4", name: "Major Test 2", date: "2026-10-12", format: "major_test" },
      ],
    });
    expect(mockBigQuery).toHaveBeenCalledTimes(1);
    expect(mockBigQuery.mock.calls[0][0].params).toMatchObject({ userId: 5001 });
  });

  it("answers an empty list when the Student has no such test", async () => {
    mockBigQuery.mockResolvedValue([[]]);

    const response = await get("1001");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tests: [] });
  });

  describe("refusal order", () => {
    it("answers 401 without a session, before checking the id", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect((await get("1001")).status).toBe(401);
      expect((await get("abc")).status).toBe(401);
      expect(mockBigQuery).not.toHaveBeenCalled();
    });

    it.each(["abc", "0", "-1", "1.5"])("answers 422 for the id %j, before the feature check", async (id) => {
      permissionRow = row("pmu_manager");

      expect((await get(id)).status).toBe(422);
      expect(mockBigQuery).not.toHaveBeenCalled();
    });

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, whose role has no AI Test Insights view", async (role) => {
      permissionRow = row(role);

      expect((await get("1001")).status).toBe(403);
      expect((await get("9999")).status).toBe(403);
      expect(mockBigQuery).not.toHaveBeenCalled();
    });

    it("answers 403 to a Teacher with only JNV NVS", async () => {
      permissionRow = row("teacher", { program_ids: [64] });

      expect((await get("1001")).status).toBe(403);
      expect(mockBigQuery).not.toHaveBeenCalled();
    });

    it.each(VIEWER_ROLES)("answers 404 to %s for a Student who does not exist", async (role) => {
      permissionRow = row(role);

      expect((await get("9999")).status).toBe(404);
      expect(mockBigQuery).not.toHaveBeenCalled();
    });

    it("answers 404 to a Teacher for a listed Student of another School", async () => {
      expect((await get("2001")).status).toBe(404);
      expect(mockBigQuery).not.toHaveBeenCalled();
    });

    it("answers every viewer role, including a read_only Teacher", async () => {
      for (const role of VIEWER_ROLES) {
        permissionRow = row(role);
        expect((await get("1001")).status).toBe(200);
      }
      permissionRow = row("teacher", { read_only: true });
      expect((await get("1001")).status).toBe(200);
    });
  });

  it("answers 502 when the warehouse read fails, and logs only the error name", async () => {
    mockBigQuery.mockRejectedValue(new TypeError("warehouse said: student 5001 has rows"));

    const response = await get("1001");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Tests could not be loaded" });
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("5001");
  });
});
