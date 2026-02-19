import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    getUserPermission: vi.fn(),
    getFeatureAccess: vi.fn(),
  };
});
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/geo-validation", () => ({ validateGpsReading: vi.fn() }));

import { getServerSession } from "next-auth";
import { getUserPermission, getFeatureAccess } from "@/lib/permissions";
import { query } from "@/lib/db";
import { validateGpsReading } from "@/lib/geo-validation";
import { GET, POST } from "./route";
import { ADMIN_SESSION, NO_SESSION, PASSCODE_SESSION, PM_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockGetPermission = vi.mocked(getUserPermission);
const mockFeatureAccess = vi.mocked(getFeatureAccess);
const mockQuery = vi.mocked(query);
const mockValidateGps = vi.mocked(validateGpsReading);

function nextReq(url: string, opts?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost"), opts);
}

beforeEach(() => {
  vi.resetAllMocks();
});

const PM_PERM = {
  email: "pm@avantifellows.org",
  level: 1 as const,
  role: "program_manager" as const,
  school_codes: ["70705"],
  regions: null,
  program_ids: [1],
  read_only: false,
};

const PROGRAM_ADMIN_SESSION = {
  user: { email: "pa@avantifellows.org", name: "PA User" },
  expires: "2099-01-01",
};

const PROGRAM_ADMIN_PERM = {
  email: "pa@avantifellows.org",
  level: 2 as const,
  role: "program_admin" as const,
  school_codes: null,
  regions: ["North"],
  program_ids: [1],
  read_only: false,
};

const ADMIN_PERM = {
  email: "admin@avantifellows.org",
  level: 2 as const,
  role: "admin" as const,
  school_codes: null,
  regions: ["North"],
  program_ids: [1],
  read_only: false,
};

describe("GET /api/pm/visits", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const res = await GET(nextReq("/api/pm/visits"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when user lacks visit view access", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "none", canView: false, canEdit: false });

    const res = await GET(nextReq("/api/pm/visits"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);

    const res = await GET(nextReq("/api/pm/visits"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Passcode users cannot access visit routes",
    });
  });

  it("returns own visits for PM and only selected columns", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    const visits = [{
      id: 1,
      school_code: "70705",
      school_name: "JNV Bhavnagar",
      pm_email: "pm@avantifellows.org",
      visit_date: "2026-02-15",
      status: "completed",
      completed_at: "2026-02-15T12:00:00.000Z",
      inserted_at: "2026-02-15T09:00:00.000Z",
      updated_at: "2026-02-15T12:00:00.000Z",
    }];
    mockQuery.mockResolvedValue(visits);

    const res = await GET(nextReq("/api/pm/visits"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visits).toEqual(visits);
    expect(json.visits[0].completed_at).toBe("2026-02-15T12:00:00.000Z");
    expect(json.visits[0].ended_at).toBeUndefined();
    expect(json.visits[0].data).toBeUndefined();

    const [queryText, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(queryText).toContain("v.completed_at");
    expect(queryText).not.toContain("v.ended_at");
    expect(queryText).not.toContain("v.data");
    expect(queryText).toContain("LOWER(v.pm_email) = LOWER($1)");
    expect(queryText).not.toContain("v.school_code = ANY(");
    expect(queryText).not.toContain("COALESCE(s.region, '') = ANY(");
    expect(params).toEqual(["pm@avantifellows.org", 50]);
  });

  it("does not infer PM list scope from level", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue({
      ...PM_PERM,
      level: 2,
      regions: ["North"],
      school_codes: null,
    } as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery.mockResolvedValue([]);

    const res = await GET(nextReq("/api/pm/visits"));
    expect(res.status).toBe(200);
    const [queryText] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(queryText).toContain("LOWER(v.pm_email) = LOWER($1)");
    expect(queryText).not.toContain("COALESCE(s.region, '') = ANY(");
  });

  it("returns 403 when PM passes pm_email filter", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });

    const res = await GET(nextReq("/api/pm/visits?pm_email=other@avantifellows.org"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows admin pm_email filter with school/status filters and scope", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetPermission.mockResolvedValue(ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery.mockResolvedValue([]);

    const res = await GET(
      nextReq("/api/pm/visits?pm_email=other@avantifellows.org&school_code=70705&status=completed&limit=10")
    );
    expect(res.status).toBe(200);
    const [queryText, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(queryText).toContain("LOWER(v.pm_email) = LOWER($1)");
    expect(queryText).toContain("v.school_code = $2");
    expect(queryText).toContain("v.status = $3");
    expect(queryText).toContain("COALESCE(s.region, '') = ANY($4)");
    expect(queryText).toContain("LIMIT $5");
    expect(params).toEqual([
      "other@avantifellows.org",
      "70705",
      "completed",
      ["North"],
      10,
    ]);
  });

  it("applies program admin pm_email filter within scoped visibility", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });
    mockQuery.mockResolvedValue([]);

    const res = await GET(nextReq("/api/pm/visits?pm_email=pm2@avantifellows.org"));
    expect(res.status).toBe(200);

    const [queryText, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(queryText).toContain("LOWER(v.pm_email) = LOWER($1)");
    expect(queryText).toContain("COALESCE(s.region, '') = ANY($2)");
    expect(queryText).toContain("LIMIT $3");
    expect(params).toEqual(["pm2@avantifellows.org", ["North"], 50]);
  });

  it("defaults limit to 50 when missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetPermission.mockResolvedValue(ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery.mockResolvedValue([]);

    const res = await GET(nextReq("/api/pm/visits"));
    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[params.length - 1]).toBe(50);
  });
});

describe("POST /api/pm/visits", () => {
  const visitBody = {
    school_code: "70705",
    start_lat: 28.6,
    start_lng: 77.2,
    start_accuracy: 10,
  };

  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when user lacks edit access", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(403);
  });

  it("returns 403 for program admin (read-only role)", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);
    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when school_code is missing", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 10 }),
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("school_code");
  });

  it("returns 422 when GPS validation fails", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({ valid: false, error: "GPS accuracy too low" });

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: "GPS accuracy too low" });
  });

  it("returns 403 when PM has no permission record", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(null as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({ valid: true, reading: { lat: 28.6, lng: 77.2, accuracy: 10 } });

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when level-1 PM has no access to school", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    const permNoSchool = { ...PM_PERM, school_codes: ["99999"] };
    mockGetPermission.mockResolvedValue(permNoSchool as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({ valid: true, reading: { lat: 28.6, lng: 77.2, accuracy: 10 } });

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("creates visit for level-3 PM (all school access)", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    const permL3 = { ...PM_PERM, level: 3 as const };
    mockGetPermission.mockResolvedValue(permL3 as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({ valid: true, reading: { lat: 28.6, lng: 77.2, accuracy: 10 } });
    mockQuery.mockResolvedValue([{ id: 42, visit_date: "2026-02-15" }]);

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe(42);
  });

  it("creates visit for level-1 PM with matching school_code", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({ valid: true, reading: { lat: 28.6, lng: 77.2, accuracy: 10 } });
    mockQuery.mockResolvedValue([{ id: 43, visit_date: "2026-02-15" }]);

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toEqual({
      id: 43,
      visit_date: "2026-02-15",
    });

    const [queryText, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(queryText).toContain("INSERT INTO lms_pm_school_visits");
    expect(queryText).toContain("(school_code, pm_email, visit_date, status,");
    expect(queryText).toContain("(NOW() AT TIME ZONE 'Asia/Kolkata')::date");
    expect(queryText).toContain("start_lat, start_lng, start_accuracy");
    expect(queryText).not.toContain("data");
    expect(params).toEqual([
      "70705",
      "pm@avantifellows.org",
      28.6,
      77.2,
      10,
    ]);
  });

  it("includes GPS warning in response when accuracy is moderate", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({
      valid: true,
      warning: "GPS accuracy is moderate",
      reading: { lat: 28.6, lng: 77.2, accuracy: 150 },
    });
    mockQuery.mockResolvedValue([{ id: 44, visit_date: "2026-02-15" }]);

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    const json = await res.json();
    expect(json).toEqual({
      id: 44,
      visit_date: "2026-02-15",
      warning: "GPS accuracy is moderate",
    });
  });

  it("checks region for level-2 PM", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    const permL2 = { ...PM_PERM, level: 2 as const, regions: ["North"] };
    mockGetPermission.mockResolvedValue(permL2 as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({ valid: true, reading: { lat: 28.6, lng: 77.2, accuracy: 10 } });
    // Region lookup
    mockQuery.mockResolvedValueOnce([{ region: "North" }]);
    // Insert
    mockQuery.mockResolvedValueOnce([{ id: 45, visit_date: "2026-02-15" }]);

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(201);
  });

  it("returns 404 for level-2 PM when school not found", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    const permL2 = { ...PM_PERM, level: 2 as const, regions: ["North"] };
    mockGetPermission.mockResolvedValue(permL2 as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({ valid: true, reading: { lat: 28.6, lng: 77.2, accuracy: 10 } });
    mockQuery.mockResolvedValueOnce([]); // no school

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(404);
  });
});
