import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  ADMIN_SESSION,
  NO_SESSION,
  PASSCODE_SESSION,
  routeParams,
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

function deleteRequest(url = "http://localhost/api/academic-mentorship/10?school_code=SCH001") {
  return new NextRequest(url, { method: "DELETE" });
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

describe("DELETE /api/academic-mentorship/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    const { DELETE } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await DELETE(deleteRequest(), routeParams({ id: "10" }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when the user cannot edit academic mentorship", async () => {
    const { DELETE } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(PASSCODE_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await DELETE(deleteRequest(), routeParams({ id: "10" }));

    expect(res.status).toBe(403);
    expect(mocks.mockFetch).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns 400 when school_code is absent", async () => {
    const { DELETE } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);

    const res = await DELETE(
      deleteRequest("http://localhost/api/academic-mentorship/10"),
      routeParams({ id: "10" })
    );

    expect(res.status).toBe(400);
    expect(mocks.mockFetch).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: "school_code is required" });
  });

  it("returns 404 when the mapping is missing", async () => {
    const { DELETE } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockFetch.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));

    const res = await DELETE(deleteRequest(), routeParams({ id: "10" }));

    expect(res.status).toBe(404);
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ error: "Mapping not found" });
  });

  it("returns 404 when the mapping is already unassigned", async () => {
    const { DELETE } = await loadRouteModule();
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

    const res = await DELETE(deleteRequest(), routeParams({ id: "10" }));

    expect(res.status).toBe(404);
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ error: "Mapping not found" });
  });

  it("returns 403 when the mapping school does not match the requested school", async () => {
    const { DELETE } = await loadRouteModule();
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

    const res = await DELETE(deleteRequest(), routeParams({ id: "10" }));

    expect(res.status).toBe(403);
    expect(mocks.mockCanAccessSchool).not.toHaveBeenCalled();
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns 403 when the actor cannot access the mapping school", async () => {
    const { DELETE } = await loadRouteModule();
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

    const res = await DELETE(deleteRequest(), routeParams({ id: "10" }));

    expect(res.status).toBe(403);
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("soft-deletes an active mapping with the session user as updated_by", async () => {
    const { DELETE } = await loadRouteModule();
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
      .mockResolvedValueOnce(jsonResponse({ mapping: { id: 10, deleted_at: "2026-05-01" } }));
    mocks.mockQuery.mockResolvedValueOnce([{ school_codes: ["SCH001"] }]);

    const res = await DELETE(deleteRequest(), routeParams({ id: "10" }));

    expect(res.status).toBe(200);
    expect(mocks.mockFetch).toHaveBeenNthCalledWith(
      1,
      "http://db-service.local/api/academic-mentorship-mapping/10",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
    expect(mocks.mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM user_permission"),
      [21]
    );
    expect(mocks.mockCanAccessSchool).toHaveBeenCalledWith(
      "admin@avantifellows.org",
      "SCH001"
    );
    expect(mocks.mockFetch).toHaveBeenNthCalledWith(
      2,
      "http://db-service.local/api/academic-mentorship-mapping/10",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ updated_by: "admin@avantifellows.org" }),
      })
    );
    await expect(res.json()).resolves.toEqual({
      mapping: { id: 10, deleted_at: "2026-05-01" },
    });
  });

  it("returns 502 when db-service fails during unassign", async () => {
    const { DELETE } = await loadRouteModule();
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
    mocks.mockQuery.mockResolvedValueOnce([{ school_codes: ["SCH001"] }]);

    const res = await DELETE(deleteRequest(), routeParams({ id: "10" }));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Academic mentorship service unavailable",
    });
  });
});
