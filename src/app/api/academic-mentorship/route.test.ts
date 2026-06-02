import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import {
  ADMIN_SESSION,
  NO_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
  TEACHER_SESSION,
} from "../__test-utils__/api-test-helpers";
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
    email: "user@avantifellows.org",
    full_name: null,
    level: 1,
    role: "teacher",
    school_codes: ["70705"],
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

async function loadRouteModule(env?: {
  dbServiceUrl?: string;
  dbServiceToken?: string;
}) {
  vi.resetModules();
  if (env?.dbServiceUrl === undefined) {
    process.env.DB_SERVICE_URL = "http://db-service.local";
  } else if (env.dbServiceUrl) {
    process.env.DB_SERVICE_URL = env.dbServiceUrl;
  } else {
    delete process.env.DB_SERVICE_URL;
  }

  if (env?.dbServiceToken === undefined) {
    process.env.DB_SERVICE_TOKEN = "test-token";
  } else if (env.dbServiceToken) {
    process.env.DB_SERVICE_TOKEN = env.dbServiceToken;
  } else {
    delete process.env.DB_SERVICE_TOKEN;
  }

  return import("./route");
}

function request(url = "http://localhost/api/academic-mentorship?school_code=70705&academic_year=2026-2027") {
  return new NextRequest(url);
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/academic-mentorship", {
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
  mocks.mockQuery.mockReset();
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
  mocks.mockCanAccessSchool.mockResolvedValue(true);
  mocks.mockGetFeatureAccess.mockReturnValue({
    access: "view",
    canView: true,
    canEdit: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DB_SERVICE_URL;
  delete process.env.DB_SERVICE_TOKEN;
});

describe("GET /api/academic-mentorship", () => {
  it("returns 401 when unauthenticated", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await GET(request());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when the user cannot view academic mentorship", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(PASSCODE_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "none",
      canView: false,
      canEdit: false,
    });

    const res = await GET(request());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns 403 when school_code is outside the actor scope", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(PM_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(
      makePermission({ role: "program_manager", email: "pm@avantifellows.org" })
    );
    mocks.mockCanAccessSchool.mockResolvedValue(false);

    const res = await GET(request());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("scopes teacher requests to the actor's own user_permission id", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(TEACHER_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(
      makePermission({
        id: 42,
        email: "teacher@avantifellows.org",
        full_name: "  Anjali Teacher  ",
        role: "teacher",
      })
    );
    mocks.mockFetch.mockResolvedValue(
      jsonResponse({
        mappings: [
          {
            id: 1,
            mentor_id: 42,
            mentee_id: 1001,
            academic_year: "2026-2027",
            created_by: "admin@avantifellows.org",
            inserted_at: "2026-05-01T00:00:00Z",
          },
        ],
      })
    );
    mocks.mockQuery.mockResolvedValueOnce([
      {
        id: 1001,
        mentee_name: "Riya Shah",
        mentee_student_id: "STU001",
        mentee_grade: 11,
      },
    ]);

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(mocks.mockFetch).toHaveBeenCalledWith(
      "http://db-service.local/api/academic-mentorship-mapping?mentor_ids=42&academic_year=2026-2027",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
    await expect(res.json()).resolves.toEqual({
      mappings: [
        {
          id: 1,
          mentor_id: 42,
          mentor_name: "Anjali Teacher",
          mentor_email: "teacher@avantifellows.org",
          mentee_id: 1001,
          mentee_name: "Riya Shah",
          mentee_grade: 11,
          mentee_student_id: "STU001",
          academic_year: "2026-2027",
          created_by: "admin@avantifellows.org",
          inserted_at: "2026-05-01T00:00:00Z",
        },
      ],
    });
  });

  it("scopes non-teacher viewers to all teachers at the school and enriches names", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(
      makePermission({ role: "admin", email: "admin@avantifellows.org" })
    );
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "mentor1@avantifellows.org", full_name: " Mentor One " },
        { id: 22, email: "mentor2@avantifellows.org", full_name: "   " },
      ])
      .mockResolvedValueOnce([
        {
          id: 2001,
          mentee_name: "Aarav Kumar",
          mentee_student_id: "STU2001",
          mentee_grade: 12,
        },
      ]);
    mocks.mockFetch.mockResolvedValue(
      jsonResponse({
        mappings: [
          {
            id: 9,
            mentor_id: 22,
            mentee_id: 2001,
            academic_year: "2026-2027",
            created_by: "admin@avantifellows.org",
            inserted_at: "2026-05-02T00:00:00Z",
          },
        ],
      })
    );

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(mocks.mockFetch.mock.calls[0]?.[0]).toContain("mentor_ids=21%2C22");
    await expect(res.json()).resolves.toEqual({
      mappings: [
        expect.objectContaining({
          mentor_id: 22,
          mentor_name: "mentor2@avantifellows.org",
          mentor_email: "mentor2@avantifellows.org",
          mentee_name: "Aarav Kumar",
          mentee_grade: 12,
          mentee_student_id: "STU2001",
        }),
      ],
    });
  });

  it("lets read-only program admins see all teachers at the school", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(
      makePermission({ role: "program_admin", read_only: true })
    );
    mocks.mockQuery.mockResolvedValueOnce([
      { id: 31, email: "teacher@avantifellows.org", full_name: null },
    ]);
    mocks.mockFetch.mockResolvedValue(jsonResponse({ mappings: [] }));

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(mocks.mockFetch.mock.calls[0]?.[0]).toContain("mentor_ids=31");
  });

  it("returns 502 when db-service configuration is missing", async () => {
    const { GET } = await loadRouteModule({ dbServiceUrl: "", dbServiceToken: "" });
    mocks.mockGetServerSession.mockResolvedValue(PM_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission({ role: "program_manager" }));
    mocks.mockQuery.mockResolvedValueOnce([
      { id: 21, email: "mentor1@avantifellows.org", full_name: null },
    ]);

    const res = await GET(request());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Academic mentorship service unavailable",
    });
  });

  it("returns 502 when db-service fails", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(PM_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission({ role: "program_manager" }));
    mocks.mockQuery.mockResolvedValueOnce([
      { id: 21, email: "mentor1@avantifellows.org", full_name: null },
    ]);
    mocks.mockFetch.mockResolvedValue(jsonResponse({ error: "downstream" }, 500));

    const res = await GET(request());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Academic mentorship service unavailable",
    });
  });
});

describe("POST /api/academic-mentorship", () => {
  it("returns 403 when school_code is outside the actor scope", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(
      makePermission({ role: "admin", email: "admin@avantifellows.org" })
    );
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mocks.mockCanAccessSchool.mockResolvedValue(false);

    const res = await POST(
      postRequest({
        school_code: "SCH999",
        mentor_email: "mentor@avantifellows.org",
        mentee_user_id: 1001,
        academic_year: "2026-2027",
      })
    );

    expect(res.status).toBe(403);
    expect(mocks.mockQuery).not.toHaveBeenCalled();
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("creates a mapping with a case-insensitive mentor lookup and session creator email", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(
      makePermission({ role: "admin", email: "admin@avantifellows.org" })
    );
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1001,
          selected_school_match_count: 1,
          school_membership_count: 1,
          is_dropout: null,
        },
      ]);
    mocks.mockFetch.mockResolvedValue(
      jsonResponse({
        mapping: {
          id: 99,
          mentor_id: 21,
          mentee_id: 1001,
          academic_year: "2026-2027",
          created_by: "admin@avantifellows.org",
        },
      })
    );

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        mentor_email: " Mentor@AvantiFellows.Org ",
        mentee_user_id: 1001,
        academic_year: "2026-2027",
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.mockCanAccessSchool).toHaveBeenCalledWith("admin@avantifellows.org", "SCH001");
    expect(mocks.mockQuery.mock.calls[0]?.[0]).toContain("LOWER(email) = LOWER($1)");
    expect(mocks.mockQuery.mock.calls[0]?.[0]).toContain("cardinality(school_codes) = 1");
    expect(mocks.mockQuery.mock.calls[0]?.[1]).toEqual(["mentor@avantifellows.org", "SCH001"]);
    expect(mocks.mockQuery.mock.calls[1]?.[0]).toContain("COUNT(DISTINCT all_schools.code)");
    expect(mocks.mockFetch).toHaveBeenCalledWith(
      "http://db-service.local/api/academic-mentorship-mapping",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          mentor_id: 21,
          mentee_id: 1001,
          academic_year: "2026-2027",
          created_by: "admin@avantifellows.org",
        }),
      })
    );
    await expect(res.json()).resolves.toEqual({
      mapping: {
        id: 99,
        mentor_id: 21,
        mentee_id: 1001,
        academic_year: "2026-2027",
        created_by: "admin@avantifellows.org",
      },
    });
  });

  it("rejects a mentee with multiple school memberships", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(
      makePermission({ role: "admin", email: "admin@avantifellows.org" })
    );
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1001,
          selected_school_match_count: 1,
          school_membership_count: 2,
          is_dropout: null,
        },
      ]);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        mentor_email: "mentor@avantifellows.org",
        mentee_user_id: 1001,
        academic_year: "2026-2027",
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Mentee has multiple school memberships",
    });
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("returns 409 when db-service reports a duplicate active assignment", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(
      makePermission({ role: "admin", email: "admin@avantifellows.org" })
    );
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1001,
          selected_school_match_count: 1,
          school_membership_count: 1,
          is_dropout: null,
        },
      ]);
    mocks.mockFetch.mockResolvedValue(jsonResponse({ error: "unique violation" }, 409));

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        mentor_email: "mentor@avantifellows.org",
        mentee_user_id: 1001,
        academic_year: "2026-2027",
      })
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "This student already has an active mentor for this academic year",
    });
  });

  it("returns 502 when db-service create fails", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(
      makePermission({ role: "admin", email: "admin@avantifellows.org" })
    );
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mocks.mockQuery
      .mockResolvedValueOnce([
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1001,
          selected_school_match_count: 1,
          school_membership_count: 1,
          is_dropout: null,
        },
      ]);
    mocks.mockFetch.mockResolvedValue(jsonResponse({ error: "downstream" }, 500));

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        mentor_email: "mentor@avantifellows.org",
        mentee_user_id: 1001,
        academic_year: "2026-2027",
      })
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Academic mentorship service unavailable",
    });
  });
});
