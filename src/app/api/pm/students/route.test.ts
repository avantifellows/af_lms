import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_SESSION, NO_SESSION, PASSCODE_SESSION, PM_SESSION } from "@/app/api/__test-utils__/api-test-helpers";

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

  it("returns students for a valid school_code", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    // school lookup
    mockQuery.mockResolvedValueOnce([{ id: 10, region: "Jaipur" }] as never);
    // students query
    mockQuery.mockResolvedValueOnce([
      { id: 1, full_name: "Alice Student", student_id: "STU001", grade: 11 },
      { id: 2, full_name: null, student_id: "STU002", grade: 12 },
    ] as never);

    const response = await GET(studentsRequest({ school_code: "SCH001" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.students).toEqual([
      { id: 1, full_name: "Alice Student", student_id: "STU001", grade: 11 },
      { id: 2, full_name: null, student_id: "STU002", grade: 12 },
    ]);

    // Verify students query uses school.id and null grade
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("g.child_id = $1"),
      [10, null]
    );
  });

  it("passes grade filter to query when provided", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    mockQuery.mockResolvedValueOnce([{ id: 10, region: "Jaipur" }] as never);
    mockQuery.mockResolvedValueOnce([
      { id: 3, full_name: "Grade 11 Student", student_id: "STU003", grade: 11 },
    ] as never);

    const response = await GET(studentsRequest({ school_code: "SCH001", grade: "11" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.students).toHaveLength(1);

    // Verify grade is passed as number
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("g.child_id = $1"),
      [10, 11]
    );
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
