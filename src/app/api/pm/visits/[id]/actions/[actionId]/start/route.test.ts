import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { getServerSession } from "next-auth";

import { query } from "@/lib/db";
import { getFeatureAccess, getUserPermission } from "@/lib/permissions";
import {
  NO_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
  routeParams,
} from "../../../../../../__test-utils__/api-test-helpers";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockGetPermission = vi.mocked(getUserPermission);
const mockFeatureAccess = vi.mocked(getFeatureAccess);
const mockQuery = vi.mocked(query);

const params = routeParams({ id: "10", actionId: "101" });

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

const VISIT_ROW = {
  id: 10,
  school_code: "70705",
  pm_email: "pm@avantifellows.org",
  status: "in_progress",
  school_region: "North",
};

const PENDING_ACTION = {
  id: 101,
  visit_id: 10,
  action_type: "classroom_observation",
  status: "pending",
  data: {},
  started_at: null,
  ended_at: null,
  start_accuracy: null,
  end_accuracy: null,
  inserted_at: "2026-02-19T10:00:00.000Z",
  updated_at: "2026-02-19T10:00:00.000Z",
};

const STARTED_ACTION = {
  ...PENDING_ACTION,
  status: "in_progress",
  started_at: "2026-02-19T10:05:00.000Z",
  start_accuracy: "12.00",
  updated_at: "2026-02-19T10:05:00.000Z",
};

function setupPmEdit() {
  mockSession.mockResolvedValue(PM_SESSION);
  mockGetPermission.mockResolvedValue(PM_PERM as never);
  mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/pm/visits/[id]/actions/[actionId]/start", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Passcode users cannot access visit routes",
    });
  });

  it("returns 403 for program admin write attempt", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 409 when visit is completed", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, status: "completed" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Visit is completed and read-only",
    });
  });

  it("returns 422 when GPS accuracy is poor (>500m)", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 700 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "GPS accuracy too low (700m). Move to an open area and try again.",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for missing or soft-deleted action", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Action not found" });

    const [queryText, queryParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(queryText).toContain("deleted_at IS NULL");
    expect(queryParams).toEqual(["10", "101"]);
  });

  it("starts pending action, sets in_progress timestamps, and does not expose lat/lng", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([PENDING_ACTION])
      .mockResolvedValueOnce([STARTED_ACTION]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ action: STARTED_ACTION });
    expect(json.action.start_lat).toBeUndefined();
    expect(json.action.start_lng).toBeUndefined();
    expect(json.action.end_lat).toBeUndefined();
    expect(json.action.end_lng).toBeUndefined();

    const [updateQueryText, updateParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(updateQueryText).toContain("UPDATE lms_pm_visit_actions");
    expect(updateQueryText).toContain("status = 'in_progress'");
    expect(updateQueryText).toContain("started_at = (NOW() AT TIME ZONE 'UTC')");
    expect(updateQueryText).toContain("updated_at = (NOW() AT TIME ZONE 'UTC')");
    expect(updateQueryText).toContain("status = 'pending'");
    expect(updateQueryText).toContain("started_at IS NULL");
    expect(updateQueryText).toContain("ended_at IS NULL");
    expect(updateParams).toEqual(["10", "101", 28.6, 77.2, 10]);
  });

  it("returns warning when GPS accuracy is moderate (100-500m)", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([PENDING_ACTION])
      .mockResolvedValueOnce([STARTED_ACTION]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 250 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warning).toContain("moderate");
    expect(json.warning).toContain("250m");
  });

  it("is idempotent when already started (no overwrite query)", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([STARTED_ACTION]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ action: STARTED_ACTION });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("handles concurrent start requests safely with idempotent success", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([PENDING_ACTION])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([STARTED_ACTION]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/start", {
      method: "POST",
      body: JSON.stringify({ start_lat: 28.6, start_lng: 77.2, start_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ action: STARTED_ACTION });
  });
});
