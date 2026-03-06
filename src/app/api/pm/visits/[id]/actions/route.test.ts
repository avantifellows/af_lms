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
} from "../../../../__test-utils__/api-test-helpers";
import { GET, POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockGetPermission = vi.mocked(getUserPermission);
const mockFeatureAccess = vi.mocked(getFeatureAccess);
const mockQuery = vi.mocked(query);

const params = routeParams({ id: "10" });

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

const ACTION_ROWS = [
  {
    id: 101,
    visit_id: 10,
    action_type: "principal_meeting",
    status: "pending",
    data: {},
    started_at: null,
    ended_at: null,
    start_accuracy: null,
    end_accuracy: null,
    inserted_at: "2026-02-18T10:00:00.000Z",
    updated_at: "2026-02-18T10:00:00.000Z",
  },
];

function setupPmView() {
  mockSession.mockResolvedValue(PM_SESSION);
  mockGetPermission.mockResolvedValue(PM_PERM as never);
  mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/pm/visits/[id]/actions", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);

    const req = new Request("http://localhost/api/pm/visits/10/actions");
    const res = await GET(req as never, params);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);

    const req = new Request("http://localhost/api/pm/visits/10/actions");
    const res = await GET(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Passcode users cannot access visit routes",
    });
  });

  it("returns 404 when visit does not exist", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions");
    const res = await GET(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Visit not found" });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns 403 for non-owner PM", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, pm_email: "other@avantifellows.org" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions");
    const res = await GET(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns actions for owner PM and excludes deleted rows with stable ordering", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce(ACTION_ROWS);

    const req = new Request("http://localhost/api/pm/visits/10/actions");
    const res = await GET(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ actions: ACTION_ROWS });

    const [actionsQueryText, actionsParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(actionsQueryText).toContain("FROM lms_pm_school_visit_actions");
    expect(actionsQueryText).toContain("deleted_at IS NULL");
    expect(actionsQueryText).toContain("ORDER BY inserted_at ASC, id ASC");
    expect(actionsQueryText).not.toContain("start_lat");
    expect(actionsQueryText).not.toContain("start_lng");
    expect(actionsQueryText).not.toContain("end_lat");
    expect(actionsQueryText).not.toContain("end_lng");
    expect(actionsParams).toEqual(["10"]);
  });

  it("allows in-scope admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetPermission.mockResolvedValue({
      ...PM_PERM,
      role: "admin",
      level: 2,
      regions: ["North"],
      school_codes: null,
    } as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, pm_email: "other@avantifellows.org" }]);
    mockQuery.mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions");
    const res = await GET(req as never, params);

    expect(res.status).toBe(200);
  });

  it("allows in-scope program admin read-only access", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, pm_email: "other@avantifellows.org" }]);
    mockQuery.mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions");
    const res = await GET(req as never, params);

    expect(res.status).toBe(200);
  });

  it("returns 403 for out-of-scope program admin", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, pm_email: "other@avantifellows.org", school_region: "South" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions");
    const res = await GET(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });
});

describe("POST /api/pm/visits/[id]/actions", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);

    const req = new Request("http://localhost/api/pm/visits/10/actions", {
      method: "POST",
      body: JSON.stringify({ action_type: "principal_meeting" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for program admin write attempt", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });

    const req = new Request("http://localhost/api/pm/visits/10/actions", {
      method: "POST",
      body: JSON.stringify({ action_type: "principal_meeting" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);

    const req = new Request("http://localhost/api/pm/visits/10/actions", {
      method: "POST",
      body: JSON.stringify({ action_type: "principal_meeting" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Passcode users cannot access visit routes",
    });
  });

  it("returns 404 when visit does not exist", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions", {
      method: "POST",
      body: JSON.stringify({ action_type: "principal_meeting" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Visit not found" });
  });

  it("returns 403 when PM is not visit owner", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, pm_email: "other@avantifellows.org" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions", {
      method: "POST",
      body: JSON.stringify({ action_type: "principal_meeting" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns 409 when visit is completed", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([{ ...VISIT_ROW, status: "completed" }]);

    const req = new Request("http://localhost/api/pm/visits/10/actions", {
      method: "POST",
      body: JSON.stringify({ action_type: "principal_meeting" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Visit is completed and read-only",
    });
  });

  it("returns 400 when action_type is missing", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]);

    const req = new Request("http://localhost/api/pm/visits/10/actions", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "action_type is required" });
  });

  it("returns 400 when action_type is invalid", async () => {
    setupPmView();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]);

    const req = new Request("http://localhost/api/pm/visits/10/actions", {
      method: "POST",
      body: JSON.stringify({ action_type: "invalid_action" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid action_type" });
  });

  it("creates pending action with default empty data", async () => {
    setupPmView();
    const createdAction = {
      id: 102,
      visit_id: 10,
      action_type: "classroom_observation",
      status: "pending",
      data: {},
      started_at: null,
      ended_at: null,
      start_accuracy: null,
      end_accuracy: null,
      inserted_at: "2026-02-18T10:05:00.000Z",
      updated_at: "2026-02-18T10:05:00.000Z",
    };
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([createdAction]);

    const req = new Request("http://localhost/api/pm/visits/10/actions", {
      method: "POST",
      body: JSON.stringify({ action_type: " classroom_observation " }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ action: createdAction });

    const [insertQueryText, insertParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(insertQueryText).toContain("INSERT INTO lms_pm_school_visit_actions");
    expect(insertQueryText).toContain("(visit_id, action_type, status, data)");
    expect(insertQueryText).toContain("'pending'");
    expect(insertQueryText).toContain("'{}'::jsonb");
    expect(insertParams).toEqual(["10", "classroom_observation"]);
  });
});
