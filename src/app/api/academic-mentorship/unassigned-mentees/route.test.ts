import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { ADMIN_SESSION } from "../../__test-utils__/api-test-helpers";
import { PROGRAM_IDS, type UserPermission } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockCanAccessSchool: vi.fn(),
  mockQuery: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.mockGetServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    getUserPermission: mocks.mockGetUserPermission,
    getFeatureAccess: mocks.mockGetFeatureAccess,
    canAccessSchool: mocks.mockCanAccessSchool,
  };
});
vi.mock("@/lib/db", () => ({
  query: mocks.mockQuery,
}));

function makePermission(overrides: Partial<UserPermission> = {}): UserPermission {
  return {
    id: 10,
    email: "admin@avantifellows.org",
    full_name: "Admin User",
    level: 3,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: [PROGRAM_IDS.COE],
    read_only: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadRouteModule() {
  vi.resetModules();
  process.env.DB_SERVICE_URL = "http://db-service.local";
  process.env.DB_SERVICE_TOKEN = "test-token";
  return import("./route");
}

function request(
  url = "http://localhost/api/academic-mentorship/unassigned-mentees?school_code=SCH001&academic_year=2026-2027"
) {
  return new NextRequest(url);
}

beforeEach(() => {
  mocks.mockGetServerSession.mockReset();
  mocks.mockGetUserPermission.mockReset();
  mocks.mockGetFeatureAccess.mockReset();
  mocks.mockCanAccessSchool.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
  mocks.mockCanAccessSchool.mockResolvedValue(true);
  mocks.mockGetFeatureAccess.mockReturnValue({
    access: "edit",
    canView: true,
    canEdit: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.DB_SERVICE_URL;
  delete process.env.DB_SERVICE_TOKEN;
});

describe("GET /api/academic-mentorship/unassigned-mentees", () => {
  it("returns 403 when school_code is outside the actor scope", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockCanAccessSchool.mockResolvedValue(false);

    const res = await GET(request());

    expect(res.status).toBe(403);
    expect(mocks.mockQuery).not.toHaveBeenCalled();
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("excludes assigned students and silently skips multi-school anomalies", async () => {
    const { GET } = await loadRouteModule();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "eligible@avantifellows.org", full_name: "Eligible Mentor" },
        { id: 22, email: "level2@avantifellows.org", full_name: "Changed Eligibility" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1001,
          name: "Assigned Student",
          grade: 11,
          student_id: "STU-001",
          school_membership_count: 1,
        },
        {
          id: 1002,
          name: "Available Student",
          grade: 12,
          student_id: "STU-002",
          school_membership_count: 1,
        },
        {
          id: 1003,
          name: "Anomalous Student",
          grade: 11,
          student_id: "STU-003",
          school_membership_count: 2,
        },
        {
          id: 1004,
          name: "Grade Ten Student",
          grade: 10,
          student_id: "STU-004",
          school_membership_count: 1,
        },
      ]);
    mocks.mockFetch.mockResolvedValue(
      jsonResponse({
        mappings: [
          {
            id: 99,
            mentor_id: 22,
            mentee_id: 1001,
            academic_year: "2026-2027",
            created_by: "admin@avantifellows.org",
            inserted_at: "2026-05-01T00:00:00Z",
          },
        ],
      })
    );

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(mocks.mockFetch.mock.calls[0]?.[0]).toContain("mentor_ids=21%2C22");
    expect(mocks.mockQuery.mock.calls[1]?.[0]).toContain("s.status IS NULL OR s.status != 'dropout'");
    expect(mocks.mockQuery.mock.calls[1]?.[0]).toContain("gr.number IN (11, 12)");
    expect(errorSpy).toHaveBeenCalledWith(
      "Skipping academic mentorship mentee with school membership anomaly:",
      expect.objectContaining({ id: 1003, school_membership_count: 2 })
    );
    await expect(res.json()).resolves.toEqual({
      students: [
        { id: 1002, name: "Available Student", grade: 12, student_id: "STU-002" },
      ],
    });
  });
});
