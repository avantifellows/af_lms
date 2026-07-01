import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_SESSION, NO_SESSION, PASSCODE_SESSION, PM_SESSION } from "@/app/api/__test-utils__/api-test-helpers";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

vi.mock("next-auth");
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db");

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";

import { GET } from "./route";

const mockGetServerSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);

function studentsRequest(params?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/pm/students");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url);
}

// Roster-shaped row, as returned by the canonical school-roster query the
// route now shares with the Enrollment tab.
function makeRosterStudent(overrides: Partial<{
  group_user_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  student_id: string | null;
  grade: number | null;
  status: string | null;
}> = {}) {
  const user_id = overrides.user_id ?? "1";
  return {
    group_user_id: `gu-${user_id}`,
    user_id,
    first_name: "Alice",
    last_name: "Student",
    student_id: "STU001",
    grade: 11,
    status: null,
    stream: null,
    program_name: null,
    program_id: null,
    ...overrides,
  };
}

// Stub getUserPermission for role-based checks
function stubPermission(overrides: Record<string, unknown> = {}) {
  const defaultPermission = {
    role: "program_manager",
    level: 3,
    school_codes: [],
    regions: [],
    program_ids: [1],
    read_only: false,
    ...overrides,
  };
  mockQuery.mockResolvedValueOnce([defaultPermission] as never);
}

describe("GET /api/pm/students", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default for queries after the roster fetch (e.g. the multi-school
    // issue check inside processStudents).
    mockQuery.mockResolvedValue([] as never);
  });

  it("returns 401 when no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(NO_SESSION);
    const response = await GET(studentsRequest({ school_code: "SCH001" }));
    expect(response.status).toBe(401);
  });

  it("returns 403 for passcode users", async () => {
    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    const response = await GET(studentsRequest({ school_code: "SCH001" }));
    expect(response.status).toBe(403);
  });

  it("returns 400 when school_code is missing", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    const response = await GET(studentsRequest());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("school_code query parameter is required");
  });

  it("returns 400 when grade is not a positive integer", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    const response = await GET(studentsRequest({ school_code: "SCH001", grade: "abc" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("grade must be a positive integer");
  });

  it("returns 400 when grade is zero", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    const response = await GET(studentsRequest({ school_code: "SCH001", grade: "0" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("grade must be a positive integer");
  });

  it("returns 404 when school not found", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    // school lookup returns empty
    mockQuery.mockResolvedValueOnce([] as never);

    const response = await GET(studentsRequest({ school_code: "UNKNOWN" }));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("School not found");
  });

  it("returns 403 when PM cannot access the requested school", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    // Level 1 PM with access to SCH999 only
    stubPermission({ level: 1, school_codes: ["SCH999"] });
    // school lookup returns school with different region
    mockQuery.mockResolvedValueOnce([{ id: 42, region: "Jaipur" }] as never);

    const response = await GET(studentsRequest({ school_code: "SCH001" }));
    expect(response.status).toBe(403);
  });

  it("returns students from the canonical roster, sorted by grade then name", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    // school lookup
    mockQuery.mockResolvedValueOnce([{ id: 10, region: "Jaipur" }] as never);
    // roster query
    mockQuery.mockResolvedValueOnce([
      makeRosterStudent({ user_id: "2", first_name: null, last_name: null, student_id: "STU002", grade: 12 }),
      makeRosterStudent({ user_id: "1", first_name: "Alice", last_name: "Student", student_id: "STU001", grade: 11 }),
    ] as never);

    const response = await GET(studentsRequest({ school_code: "SCH001" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.students).toEqual([
      { id: "1", full_name: "Alice Student", student_id: "STU001", grade: 11 },
      { id: "2", full_name: null, student_id: "STU002", grade: 12 },
    ]);

    // The roster query is the canonical one: scoped to the school and the
    // current academic year (no grade param — grade filtering happens in JS).
    const rosterCall = mockQuery.mock.calls[2];
    expect(rosterCall[0]).toContain("g.type = 'school' AND g.child_id = $1");
    expect(rosterCall[0]).toContain("er.academic_year = $2");
    expect(rosterCall[1]).toEqual([10, CURRENT_ACADEMIC_YEAR]);
  });

  it("filters to the requested grade in JS with roster semantics", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    mockQuery.mockResolvedValueOnce([{ id: 10, region: "Jaipur" }] as never);
    mockQuery.mockResolvedValueOnce([
      makeRosterStudent({ user_id: "3", first_name: "Eleven", student_id: "STU003", grade: 11 }),
      makeRosterStudent({ user_id: "4", first_name: "Twelve", student_id: "STU004", grade: 12 }),
    ] as never);

    const response = await GET(studentsRequest({ school_code: "SCH001", grade: "11" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.students).toEqual([
      { id: "3", full_name: "Eleven Student", student_id: "STU003", grade: 11 },
    ]);
  });

  it("excludes dropout students even when they match the grade", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    mockQuery.mockResolvedValueOnce([{ id: 10, region: "Jaipur" }] as never);
    mockQuery.mockResolvedValueOnce([
      makeRosterStudent({ user_id: "5", first_name: "Active", grade: 11 }),
      makeRosterStudent({ user_id: "6", first_name: "Gone", grade: 11, status: "dropout" }),
    ] as never);

    const response = await GET(studentsRequest({ school_code: "SCH001", grade: "11" }));
    const body = await response.json();
    expect(body.students).toHaveLength(1);
    expect(body.students[0].full_name).toBe("Active Student");
  });

  it("returns empty array when no matching students", async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    stubPermission({ role: "admin" });
    mockQuery.mockResolvedValueOnce([{ id: 5, region: "Patna" }] as never);
    mockQuery.mockResolvedValueOnce([] as never);

    const response = await GET(studentsRequest({ school_code: "EMPTY_SCHOOL" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.students).toEqual([]);
  });
});
