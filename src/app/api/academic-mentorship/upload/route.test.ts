import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { ADMIN_SESSION, NO_SESSION, PASSCODE_SESSION } from "../../__test-utils__/api-test-helpers";
import { PROGRAM_IDS, type UserPermission } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockCanAccessSchool: vi.fn(),
  mockGetCurrentAcademicYear: vi.fn(),
  mockQuery: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.mockGetServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/academic-year", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/academic-year")>();
  return {
    ...actual,
    getCurrentAcademicYear: mocks.mockGetCurrentAcademicYear,
  };
});
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

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/academic-mentorship/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.mockGetServerSession.mockReset();
  mocks.mockGetUserPermission.mockReset();
  mocks.mockGetFeatureAccess.mockReset();
  mocks.mockCanAccessSchool.mockReset();
  mocks.mockGetCurrentAcademicYear.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
  mocks.mockCanAccessSchool.mockResolvedValue(true);
  mocks.mockGetCurrentAcademicYear.mockReturnValue("2026-2027");
  mocks.mockGetFeatureAccess.mockReturnValue({
    access: "edit",
    canView: true,
    canEdit: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DB_SERVICE_URL;
  delete process.env.DB_SERVICE_TOKEN;
});

describe("POST /api/academic-mentorship/upload", () => {
  it("returns 401 when unauthenticated", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await POST(postRequest({ school_code: "SCH001", rows: [] }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when the user cannot edit academic mentorship", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(PASSCODE_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission({ role: "teacher" }));
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await POST(postRequest({ school_code: "SCH001", rows: [] }));

    expect(res.status).toBe(403);
    expect(mocks.mockQuery).not.toHaveBeenCalled();
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("returns 403 when school_code is outside the actor scope", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockCanAccessSchool.mockResolvedValue(false);

    const res = await POST(
      postRequest({
        school_code: "SCH999",
        rows: [{ mentor_email: "mentor@avantifellows.org", student_id: "STU-001" }],
      })
    );

    expect(res.status).toBe(403);
    expect(mocks.mockQuery).not.toHaveBeenCalled();
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("rejects more than 500 rows before DB lookups", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        rows: Array.from({ length: 501 }, () => ({
          mentor_email: "mentor@avantifellows.org",
          student_id: "STU-001",
        })),
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Maximum 500 rows allowed" });
    expect(mocks.mockQuery).not.toHaveBeenCalled();
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("validates rows and proxies a batch create with the inferred academic year", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ])
      .mockResolvedValueOnce([
        {
          user_id: 1001,
          student_id: "STU-001",
          status: null,
          selected_school_match_count: 1,
          school_membership_count: 1,
        },
      ])
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ]);
    mocks.mockFetch
      .mockResolvedValueOnce(jsonResponse({ mappings: [] }))
      .mockResolvedValueOnce(jsonResponse({ created: 1 }));

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        rows: [{ mentor_email: " Mentor@AvantiFellows.Org ", student_id: " STU-001 " }],
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.mockCanAccessSchool).toHaveBeenCalledWith("admin@avantifellows.org", "SCH001");
    expect(mocks.mockQuery.mock.calls[0]?.[0]).toContain("LOWER(email) = ANY");
    expect(mocks.mockFetch).toHaveBeenLastCalledWith(
      "http://db-service.local/api/academic-mentorship-mapping/batch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          mappings: [
            {
              mentor_id: 21,
              mentee_id: 1001,
              academic_year: "2026-2027",
              created_by: "admin@avantifellows.org",
            },
          ],
        }),
      })
    );
    await expect(res.json()).resolves.toEqual({ created: 1 });
  });

  it("returns all validation errors and does not batch write when any row is invalid", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ])
      .mockResolvedValueOnce([
        {
          user_id: 1001,
          student_id: "STU-001",
          status: null,
          selected_school_match_count: 1,
          school_membership_count: 1,
        },
      ])
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ]);
    mocks.mockFetch.mockResolvedValueOnce(
      jsonResponse({
        mappings: [
          {
            id: 99,
            mentor_id: 21,
            mentee_id: 1001,
            academic_year: "2026-2027",
            created_by: "admin@avantifellows.org",
            inserted_at: "2026-05-01T00:00:00Z",
          },
        ],
      })
    );

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        rows: [
          { mentor_email: "mentor@avantifellows.org", student_id: "STU-001" },
          { mentor_email: "missing@avantifellows.org", student_id: "STU-001" },
        ],
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      errors: [
        { row: 2, field: "student_id", message: "Student already has an active mentor" },
        { row: 3, field: "mentor_email", message: "Mentor is not eligible at this school" },
        { row: 3, field: "student_id", message: "Duplicate student_id in upload" },
      ],
    });
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mocks.mockFetch.mock.calls[0]?.[0])).toContain(
      "/api/academic-mentorship-mapping?"
    );
  });

  it("translates a db-service 409 race condition", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ])
      .mockResolvedValueOnce([
        {
          user_id: 1001,
          student_id: "STU-001",
          status: null,
          selected_school_match_count: 1,
          school_membership_count: 1,
        },
      ])
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ]);
    mocks.mockFetch
      .mockResolvedValueOnce(jsonResponse({ mappings: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: "unique violation" }, 409));

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        rows: [{ mentor_email: "mentor@avantifellows.org", student_id: "STU-001" }],
      })
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "One or more students were assigned by another user during upload. Refresh and retry.",
    });
  });

  it("returns 502 when db-service batch create fails or times out", async () => {
    const { POST } = await loadRouteModule();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ])
      .mockResolvedValueOnce([
        {
          user_id: 1001,
          student_id: "STU-001",
          status: null,
          selected_school_match_count: 1,
          school_membership_count: 1,
        },
      ])
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ]);
    mocks.mockFetch
      .mockResolvedValueOnce(jsonResponse({ mappings: [] }))
      .mockRejectedValueOnce(new Error("timeout"));

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        rows: [{ mentor_email: "mentor@avantifellows.org", student_id: "STU-001" }],
      })
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Academic mentorship service unavailable",
    });
  });
});
