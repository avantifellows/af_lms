import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  ADMIN_SESSION,
  NO_SESSION,
  PASSCODE_SESSION,
} from "../../__test-utils__/api-test-helpers";
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

async function loadRouteModule(env?: { dbServiceUrl?: string; dbServiceToken?: string }) {
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

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/academic-mentorship/reassign", {
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

describe("POST /api/academic-mentorship/reassign", () => {
  it("returns 401 when unauthenticated", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: "mentor@avantifellows.org",
      })
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when the user cannot edit academic mentorship", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(PASSCODE_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: "mentor@avantifellows.org",
      })
    );

    expect(res.status).toBe(403);
    expect(mocks.mockFetch).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns 422 when the old mapping is already unassigned", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockFetch.mockResolvedValueOnce(
      jsonResponse({
        mapping: {
          id: 10,
          mentor_id: 21,
          mentee_id: 1001,
          academic_year: "2026-2027",
          deleted_at: "2026-05-01T00:00:00Z",
        },
      })
    );

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: "mentor@avantifellows.org",
      })
    );

    expect(res.status).toBe(422);
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ error: "Mapping already unassigned" });
  });

  it("returns 403 when the mapping belongs to another school", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockFetch.mockResolvedValueOnce(
      jsonResponse({
        mapping: {
          id: 10,
          mentor_id: 21,
          mentee_id: 1001,
          academic_year: "2026-2027",
          deleted_at: null,
        },
      })
    );
    mocks.mockQuery.mockResolvedValueOnce([{ school_codes: ["SCH002"] }]);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: "mentor@avantifellows.org",
      })
    );

    expect(res.status).toBe(403);
    expect(mocks.mockCanAccessSchool).not.toHaveBeenCalled();
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns 403 when the actor cannot access the mapping school", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockFetch.mockResolvedValueOnce(
      jsonResponse({
        mapping: {
          id: 10,
          mentor_id: 21,
          mentee_id: 1001,
          academic_year: "2026-2027",
          deleted_at: null,
        },
      })
    );
    mocks.mockQuery.mockResolvedValueOnce([{ school_codes: ["SCH001"] }]);
    mocks.mockCanAccessSchool.mockResolvedValue(false);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: "mentor@avantifellows.org",
      })
    );

    expect(res.status).toBe(403);
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects an ineligible new mentor", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockFetch.mockResolvedValueOnce(
      jsonResponse({
        mapping: {
          id: 10,
          mentor_id: 21,
          mentee_id: 1001,
          academic_year: "2026-2027",
          deleted_at: null,
        },
      })
    );
    mocks.mockQuery
      .mockResolvedValueOnce([{ school_codes: ["SCH001"] }])
      .mockResolvedValueOnce([]);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: "mentor@avantifellows.org",
      })
    );

    expect(res.status).toBe(400);
    expect(mocks.mockQuery.mock.calls[1]?.[0]).toContain("role = 'teacher'");
    expect(mocks.mockQuery.mock.calls[1]?.[0]).toContain("level = 1");
    expect(mocks.mockQuery.mock.calls[1]?.[0]).toContain("cardinality(school_codes) = 1");
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({
      error: "Mentor is not eligible for academic mentorship at this school",
    });
  });

  it("rejects a mentee with multiple school memberships", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockFetch.mockResolvedValueOnce(
      jsonResponse({
        mapping: {
          id: 10,
          mentor_id: 21,
          mentee_id: 1001,
          academic_year: "2026-2027",
          deleted_at: null,
        },
      })
    );
    mocks.mockQuery
      .mockResolvedValueOnce([{ school_codes: ["SCH001"] }])
      .mockResolvedValueOnce([
        { id: 22, email: "mentor@avantifellows.org", full_name: "Mentor" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1001,
          selected_school_match_count: 1,
          school_membership_count: 2,
        },
      ]);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: "mentor@avantifellows.org",
      })
    );

    expect(res.status).toBe(400);
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({
      error: "Mentee has multiple school memberships",
    });
  });

  it("reassigns an active mapping to an eligible mentor with the session user as updated_by", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          mapping: {
            id: 10,
            mentor_id: 21,
            mentee_id: 1001,
            academic_year: "2026-2027",
            deleted_at: null,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ mapping: { id: 11, mentor_id: 22 } }));
    mocks.mockQuery
      .mockResolvedValueOnce([{ school_codes: ["SCH001"] }])
      .mockResolvedValueOnce([
        { id: 22, email: "newmentor@avantifellows.org", full_name: "New Mentor" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1001,
          selected_school_match_count: 1,
          school_membership_count: 1,
        },
      ]);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: " NewMentor@AvantiFellows.Org ",
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.mockCanAccessSchool).toHaveBeenCalledWith(
      "admin@avantifellows.org",
      "SCH001"
    );
    expect(mocks.mockQuery.mock.calls[1]?.[0]).toContain("LOWER(email) = LOWER($1)");
    expect(mocks.mockQuery.mock.calls[1]?.[0]).toContain("cardinality(school_codes) = 1");
    expect(mocks.mockQuery.mock.calls[1]?.[1]).toEqual([
      "newmentor@avantifellows.org",
      "SCH001",
    ]);
    expect(mocks.mockQuery.mock.calls[2]?.[0]).toContain("COUNT(DISTINCT all_schools.code)");
    expect(mocks.mockQuery.mock.calls[2]?.[0]).not.toContain("dropout");
    expect(mocks.mockFetch).toHaveBeenNthCalledWith(
      2,
      "http://db-service.local/api/academic-mentorship-mapping/reassign",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          old_mapping_id: 10,
          new_mentor_id: 22,
          updated_by: "admin@avantifellows.org",
        }),
      })
    );
    await expect(res.json()).resolves.toEqual({ mapping: { id: 11, mentor_id: 22 } });
  });

  it("returns 409 when db-service reports a duplicate active assignment", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          mapping: {
            id: 10,
            mentor_id: 21,
            mentee_id: 1001,
            academic_year: "2026-2027",
            deleted_at: null,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ error: "unique violation" }, 409));
    mocks.mockQuery
      .mockResolvedValueOnce([{ school_codes: ["SCH001"] }])
      .mockResolvedValueOnce([
        { id: 22, email: "mentor@avantifellows.org", full_name: "Mentor" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1001,
          selected_school_match_count: 1,
          school_membership_count: 1,
        },
      ]);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: "mentor@avantifellows.org",
      })
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "This student already has an active mentor for this academic year",
    });
  });

  it("returns 502 when db-service reassign fails", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          mapping: {
            id: 10,
            mentor_id: 21,
            mentee_id: 1001,
            academic_year: "2026-2027",
            deleted_at: null,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ error: "downstream" }, 500));
    mocks.mockQuery
      .mockResolvedValueOnce([{ school_codes: ["SCH001"] }])
      .mockResolvedValueOnce([
        { id: 22, email: "mentor@avantifellows.org", full_name: "Mentor" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1001,
          selected_school_match_count: 1,
          school_membership_count: 1,
        },
      ]);

    const res = await POST(
      postRequest({
        school_code: "SCH001",
        old_mapping_id: 10,
        new_mentor_email: "mentor@avantifellows.org",
      })
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Academic mentorship service unavailable",
    });
  });
});
