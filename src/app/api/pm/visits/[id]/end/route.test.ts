import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { POST } from "./route";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
  PM_SESSION,
} from "../../../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockGetPermission = vi.mocked(getUserPermission);
const mockFeatureAccess = vi.mocked(getFeatureAccess);
const mockQuery = vi.mocked(query);
const mockValidateGps = vi.mocked(validateGpsReading);

const PM_PERM = {
  email: "pm@avantifellows.org",
  level: 1 as const,
  role: "program_manager" as const,
  school_codes: ["70705"],
  regions: null,
  program_ids: [1],
  read_only: false,
};

const params = routeParams({ id: "10" });

const endBody = { end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 };

function setupAuth() {
  mockSession.mockResolvedValue(PM_SESSION);
  mockGetPermission.mockResolvedValue(PM_PERM as never);
  mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
  mockValidateGps.mockReturnValue({ valid: true, reading: { lat: 28.6, lng: 77.2, accuracy: 10 } });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/pm/visits/[id]/end", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/pm/visits/10/end", {
      method: "POST",
      body: endBody,
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks edit access", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });
    const req = jsonRequest("http://localhost/api/pm/visits/10/end", {
      method: "POST",
      body: endBody,
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 400 when GPS validation fails", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({ valid: false, error: "GPS accuracy too low" });

    const req = jsonRequest("http://localhost/api/pm/visits/10/end", {
      method: "POST",
      body: endBody,
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(400);
  });

  it("returns 404 when visit not found", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([]);
    const req = jsonRequest("http://localhost/api/pm/visits/10/end", {
      method: "POST",
      body: endBody,
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(404);
  });

  it("returns 403 when PM is not owner and not admin", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([{ id: 10, pm_email: "other@test.com", ended_at: null }]);
    const req = jsonRequest("http://localhost/api/pm/visits/10/end", {
      method: "POST",
      body: endBody,
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns idempotent success when visit already ended", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([{
      id: 10,
      pm_email: "pm@avantifellows.org",
      ended_at: "2026-02-15T18:00:00",
    }]);
    const req = jsonRequest("http://localhost/api/pm/visits/10/end", {
      method: "POST",
      body: endBody,
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain("already ended");
    expect(json.ended_at).toBeDefined();
  });

  it("ends visit successfully for owner", async () => {
    setupAuth();
    mockQuery
      .mockResolvedValueOnce([{ id: 10, pm_email: "pm@avantifellows.org", ended_at: null }]) // fetch
      .mockResolvedValueOnce([]); // update

    const req = jsonRequest("http://localhost/api/pm/visits/10/end", {
      method: "POST",
      body: endBody,
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("includes GPS warning in response", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue(PM_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockValidateGps.mockReturnValue({
      valid: true,
      warning: "GPS accuracy is moderate",
      reading: { lat: 28.6, lng: 77.2, accuracy: 150 },
    });
    mockQuery
      .mockResolvedValueOnce([{ id: 10, pm_email: "pm@avantifellows.org", ended_at: null }])
      .mockResolvedValueOnce([]);

    const req = jsonRequest("http://localhost/api/pm/visits/10/end", {
      method: "POST",
      body: endBody,
    });
    const res = await POST(req as never, params);
    const json = await res.json();
    expect(json.warning).toContain("moderate");
  });
});
