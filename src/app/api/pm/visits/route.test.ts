import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: vi.fn(),
  getFeatureAccess: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/geo-validation", () => ({ validateGpsReading: vi.fn() }));

import { getServerSession } from "next-auth";
import { getUserPermission, getFeatureAccess } from "@/lib/permissions";
import { query } from "@/lib/db";
import { validateGpsReading } from "@/lib/geo-validation";
import { GET, POST } from "./route";
import { NO_SESSION, PM_SESSION } from "../../__test-utils__/api-test-helpers";

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

describe("GET /api/pm/visits", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const res = await GET(nextReq("/api/pm/visits"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks visit view access", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "none", canView: false, canEdit: false });

    const res = await GET(nextReq("/api/pm/visits"));
    expect(res.status).toBe(403);
  });

  it("returns visits for authenticated PM", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    const visits = [{ id: 1, school_code: "70705", status: "in_progress" }];
    mockQuery.mockResolvedValue(visits);

    const res = await GET(nextReq("/api/pm/visits"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visits).toEqual(visits);
  });

  it("applies school_code and status filters", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery.mockResolvedValue([]);

    const res = await GET(nextReq("/api/pm/visits?school_code=70705&status=completed&limit=10"));
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("v.school_code = $2"),
      expect.arrayContaining(["pm@avantifellows.org", "70705", "completed", 10]),
    );
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

  it("returns 400 when GPS validation fails", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({ valid: false, error: "GPS accuracy too low" });

    const res = await POST(nextReq("/api/pm/visits", {
      method: "POST",
      body: JSON.stringify(visitBody),
    }));
    expect(res.status).toBe(400);
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
    expect(json.warning).toContain("moderate");
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
