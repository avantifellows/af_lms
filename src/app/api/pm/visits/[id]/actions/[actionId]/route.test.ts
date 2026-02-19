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
  ADMIN_SESSION,
  NO_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
  routeParams,
} from "../../../../../__test-utils__/api-test-helpers";
import { DELETE, GET, PATCH } from "./route";

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
  visit_date: "2026-02-18",
  status: "in_progress",
  completed_at: null,
  school_region: "North",
};

const BASE_ACTION_ROW = {
  id: 101,
  visit_id: 10,
  action_type: "classroom_observation",
  status: "in_progress",
  data: { notes: "current" },
  started_at: "2026-02-18T10:05:00.000Z",
  ended_at: null,
  start_accuracy: "10.00",
  end_accuracy: null,
  inserted_at: "2026-02-18T10:00:00.000Z",
  updated_at: "2026-02-18T10:05:00.000Z",
};

function setupPmView() {
  mockSession.mockResolvedValue(PM_SESSION);
  mockGetPermission.mockResolvedValue(PM_PERM as never);
  mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/pm/visits/[id]/actions/[actionId]", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101");
    const res = await GET(req as never, params);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101");
    const res = await GET(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Passcode users cannot access visit routes",
    });
  });

  it("returns 404 when visit does not exist", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101");
    const res = await GET(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Visit not found" });
  });

  it("returns 404 when action is missing (including soft-deleted)", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101");
    const res = await GET(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Action not found" });

    const [actionQueryText, actionParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(actionQueryText).toContain("deleted_at IS NULL");
    expect(actionParams).toEqual(["10", "101"]);
  });

  it("returns 403 for non-owner PM", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, pm_email: "other@avantifellows.org" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101");
    const res = await GET(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns visit + action without coordinate fields", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([BASE_ACTION_ROW]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101");
    const res = await GET(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      visit: {
        id: 10,
        school_code: "70705",
        pm_email: "pm@avantifellows.org",
        visit_date: "2026-02-18",
        status: "in_progress",
        completed_at: null,
      },
      action: BASE_ACTION_ROW,
    });

    const [actionQueryText] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(actionQueryText).not.toContain("start_lat");
    expect(actionQueryText).not.toContain("start_lng");
    expect(actionQueryText).not.toContain("end_lat");
    expect(actionQueryText).not.toContain("end_lng");
  });

  it("allows in-scope admin to read non-owner visit action", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetPermission.mockResolvedValue({
      ...PM_PERM,
      email: "admin@avantifellows.org",
      role: "admin",
      level: 2,
      regions: ["North"],
      school_codes: null,
    } as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery
      .mockResolvedValueOnce([{ ...VISIT_ROW, pm_email: "other@avantifellows.org" }])
      .mockResolvedValueOnce([BASE_ACTION_ROW]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101");
    const res = await GET(req as never, params);

    expect(res.status).toBe(200);
  });

  it("returns 403 for out-of-scope program admin", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });
    mockQuery.mockResolvedValueOnce([
      { ...VISIT_ROW, pm_email: "other@avantifellows.org", school_region: "South" },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101");
    const res = await GET(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });
});

describe("PATCH /api/pm/visits/[id]/actions/[actionId]", () => {
  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "PATCH",
      body: JSON.stringify({ data: { notes: "updated" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Passcode users cannot access visit routes",
    });
  });

  it("returns 403 for program admin write attempt", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "PATCH",
      body: JSON.stringify({ data: { notes: "updated" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 409 when visit is completed", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, status: "completed" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "PATCH",
      body: JSON.stringify({ data: { notes: "updated" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Visit is completed and read-only",
    });
  });

  it("returns 404 when action does not belong to visit", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "PATCH",
      body: JSON.stringify({ data: { notes: "updated" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Action not found" });
  });

  it("returns 404 when action is soft-deleted", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "PATCH",
      body: JSON.stringify({ data: { notes: "updated" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Action not found" });
    const [actionQueryText, actionParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(actionQueryText).toContain("deleted_at IS NULL");
    expect(actionParams).toEqual(["10", "101"]);
  });

  it("returns 400 when data is missing or invalid", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([BASE_ACTION_ROW]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "PATCH",
      body: JSON.stringify({ data: "invalid" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "data must be an object" });
  });

  it("returns 409 when PM tries to patch completed action", async () => {
    setupPmView();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([{ ...BASE_ACTION_ROW, status: "completed" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "PATCH",
      body: JSON.stringify({ data: { notes: "updated" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Completed actions are read-only",
    });
  });

  it("allows admin to patch completed action", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetPermission.mockResolvedValue({
      ...PM_PERM,
      email: "admin@avantifellows.org",
      role: "admin",
      level: 2,
      regions: ["North"],
      school_codes: null,
    } as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    const updated = { ...BASE_ACTION_ROW, status: "completed", data: { notes: "admin edit" } };
    mockQuery
      .mockResolvedValueOnce([{ ...VISIT_ROW, pm_email: "other@avantifellows.org" }])
      .mockResolvedValueOnce([{ ...BASE_ACTION_ROW, status: "completed" }])
      .mockResolvedValueOnce([updated]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "PATCH",
      body: JSON.stringify({ data: { notes: "admin edit" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ action: updated });
  });

  it("updates only data and bumps updated_at with UTC timestamp semantics", async () => {
    setupPmView();
    const updated = { ...BASE_ACTION_ROW, data: { notes: "updated" } };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([BASE_ACTION_ROW])
      .mockResolvedValueOnce([updated]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "PATCH",
      body: JSON.stringify({ data: { notes: "updated" }, status: "completed" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ action: updated });

    const [updateQueryText, updateParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(updateQueryText).toContain("UPDATE lms_pm_visit_actions");
    expect(updateQueryText).toContain("SET data = $3::jsonb");
    expect(updateQueryText).toContain("updated_at = (NOW() AT TIME ZONE 'UTC')");
    expect(updateQueryText).not.toContain("status =");
    expect(updateQueryText).not.toContain("started_at =");
    expect(updateQueryText).not.toContain("ended_at =");
    expect(updateParams).toEqual(["10", "101", JSON.stringify({ notes: "updated" })]);
  });
});

describe("DELETE /api/pm/visits/[id]/actions/[actionId]", () => {
  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Passcode users cannot access visit routes",
    });
  });

  it("returns 403 for program admin write attempt", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 409 when visit is completed", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, status: "completed" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Visit is completed and read-only",
    });
  });

  it("returns 404 when action does not belong to visit", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Action not found" });
  });

  it("returns 404 when action is soft-deleted", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Action not found" });
    const [actionQueryText, actionParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(actionQueryText).toContain("deleted_at IS NULL");
    expect(actionParams).toEqual(["10", "101"]);
  });

  it("returns 409 when action status is not pending", async () => {
    setupPmView();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([{ ...BASE_ACTION_ROW, status: "in_progress" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Only pending actions can be deleted",
    });
  });

  it("soft-deletes pending action and bumps updated_at", async () => {
    setupPmView();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([{ ...BASE_ACTION_ROW, status: "pending" }])
      .mockResolvedValueOnce([{ id: 101 }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });

    const [deleteQueryText, deleteParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(deleteQueryText).toContain("UPDATE lms_pm_visit_actions");
    expect(deleteQueryText).toContain("deleted_at = (NOW() AT TIME ZONE 'UTC')");
    expect(deleteQueryText).toContain("updated_at = (NOW() AT TIME ZONE 'UTC')");
    expect(deleteQueryText).toContain("deleted_at IS NULL");
    expect(deleteParams).toEqual(["10", "101"]);
  });
});
