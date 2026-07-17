import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_SESSION, NO_SESSION, PASSCODE_SESSION, PM_SESSION } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth");
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db");
vi.mock("@/lib/visit-teachers");

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { getVisitTeachersForSchool } from "@/lib/visit-teachers";

import { GET } from "./route";

const mockGetServerSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockGetVisitTeachersForSchool = vi.mocked(getVisitTeachersForSchool);

function teachersRequest(schoolCode?: string): NextRequest {
  const url = schoolCode
    ? `http://localhost/api/pm/teachers?school_code=${schoolCode}`
    : "http://localhost/api/pm/teachers";
  return new NextRequest(new URL(url));
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

describe("GET /api/pm/teachers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(NO_SESSION);
    const response = await GET(teachersRequest("SCH001"));
    expect(response.status).toBe(401);
  });

  it("returns 403 for passcode users", async () => {
    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    const response = await GET(teachersRequest("SCH001"));
    expect(response.status).toBe(403);
  });

  it("returns 403 for users without PM feature access", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: "teacher@avantifellows.org", name: "Teacher" },
      expires: "2099-01-01",
    });
    // getUserPermission returns a teacher-role permission (no visits access)
    mockQuery.mockResolvedValueOnce([
      { role: "teacher", level: 1, school_codes: ["SCH001"], regions: [], program_ids: [] },
    ] as never);
    const response = await GET(teachersRequest("SCH001"));
    expect(response.status).toBe(403);
  });

  it("returns 400 when school_code is missing", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    const response = await GET(teachersRequest());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("school_code query parameter is required");
  });

  it("returns 403 when PM cannot access the requested school", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    // Level 1 PM with access to SCH999 only
    stubPermission({ level: 1, school_codes: ["SCH999"] });
    // school region lookup
    mockQuery.mockResolvedValueOnce([{ region: "Jaipur" }] as never);

    const response = await GET(teachersRequest("SCH001"));
    expect(response.status).toBe(403);
  });

  it("returns 403 when level-2 PM region does not match school", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission({ level: 2, regions: ["Patna"] });
    // school region is Jaipur, PM only has Patna
    mockQuery.mockResolvedValueOnce([{ region: "Jaipur" }] as never);

    const response = await GET(teachersRequest("SCH001"));
    expect(response.status).toBe(403);
  });


  it("returns teachers for a valid school_code", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    // 2nd query: school region lookup
    mockQuery.mockResolvedValueOnce([{ region: "Jaipur" }] as never);
    mockGetVisitTeachersForSchool.mockResolvedValueOnce([
      { id: 1, email: "teacher1@school.com", full_name: "Alice Teacher" },
      { id: 2, email: "teacher2@school.com", full_name: "teacher2@school.com" },
    ]);

    const response = await GET(teachersRequest("SCH001"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.teachers).toEqual([
      { id: 1, email: "teacher1@school.com", full_name: "Alice Teacher" },
      { id: 2, email: "teacher2@school.com", full_name: "teacher2@school.com" },
    ]);
    expect(mockGetVisitTeachersForSchool).toHaveBeenCalledWith("SCH001");
  });

  it("looks up visit teachers even when a level-3 user's school has no region row", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();
    // school region lookup returns empty
    mockQuery.mockResolvedValueOnce([] as never);
    mockGetVisitTeachersForSchool.mockResolvedValueOnce([
      { id: 1, email: "t@school.com", full_name: "Only Direct" },
    ]);

    const response = await GET(teachersRequest("UNKNOWN"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.teachers).toHaveLength(1);
    expect(mockGetVisitTeachersForSchool).toHaveBeenCalledWith("UNKNOWN");
  });

  it("returns empty array when no teachers found", async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    stubPermission({ role: "admin" });
    mockQuery.mockResolvedValueOnce([{ region: "Patna" }] as never);
    mockGetVisitTeachersForSchool.mockResolvedValueOnce([]);

    const response = await GET(teachersRequest("EMPTY_SCHOOL"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.teachers).toEqual([]);
  });

  it("works for admin users", async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    stubPermission({ role: "admin" });
    mockQuery.mockResolvedValueOnce([{ region: "Lucknow" }] as never);
    mockGetVisitTeachersForSchool.mockResolvedValueOnce([
      { id: 10, email: "t@school.com", full_name: "Bob" },
    ]);

    const response = await GET(teachersRequest("SCH002"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.teachers).toHaveLength(1);
    expect(mockGetVisitTeachersForSchool).toHaveBeenCalledWith("SCH002");
  });
});
