import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { getUserPermission, getFeatureAccess } from "@/lib/permissions";
import { query } from "@/lib/db";
import { GET } from "./route";
import {
  routeParams,
  NO_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
} from "../../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockGetPermission = vi.mocked(getUserPermission);
const mockFeatureAccess = vi.mocked(getFeatureAccess);
const mockQuery = vi.mocked(query);

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

const params = routeParams({ id: "10" });

function setupAuth(featureAccess = { access: "edit" as const, canView: true, canEdit: true }) {
  mockSession.mockResolvedValue(PM_SESSION);
  mockGetPermission.mockResolvedValue(PM_PERM as never);
  mockFeatureAccess.mockReturnValue(featureAccess);
}

beforeEach(() => {
  vi.resetAllMocks();
});

const VISIT_DETAIL = {
  id: 10,
  school_code: "70705",
  pm_email: "pm@avantifellows.org",
  visit_date: "2026-02-15",
  status: "in_progress",
  completed_at: null,
  inserted_at: "2026-02-15T10:00:00Z",
  updated_at: "2026-02-15T10:00:00Z",
  school_name: "JNV Test",
  school_region: "North",
};

const COMPLETED_VISIT_DETAIL = {
  ...VISIT_DETAIL,
  status: "completed",
  completed_at: "2026-02-15T12:00:00Z",
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
    inserted_at: "2026-02-15T10:01:00Z",
    updated_at: "2026-02-15T10:01:00Z",
  },
];

describe("GET /api/pm/visits/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when user lacks view access", async () => {
    setupAuth({ access: "none", canView: false, canEdit: false });
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Passcode users cannot access visit routes",
    });
  });

  it("returns 404 when visit not found", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([]);
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Visit not found" });
  });

  it("returns 403 when PM is not owner and not admin", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([{ ...VISIT_DETAIL, pm_email: "other@avantifellows.org" }]);
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns visit + actions for the owner PM and excludes GPS coordinates", async () => {
    setupAuth();
    mockQuery
      .mockResolvedValueOnce([VISIT_DETAIL])
      .mockResolvedValueOnce(ACTION_ROWS);

    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visit).toEqual({
      id: 10,
      school_code: "70705",
      pm_email: "pm@avantifellows.org",
      visit_date: "2026-02-15",
      status: "in_progress",
      completed_at: null,
      inserted_at: "2026-02-15T10:00:00Z",
      updated_at: "2026-02-15T10:00:00Z",
      school_name: "JNV Test",
    });
    expect(json.actions).toEqual(ACTION_ROWS);

    const [visitQueryText, visitParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(visitQueryText).toContain("s.region as school_region");
    expect(visitQueryText).not.toContain("start_lat");
    expect(visitQueryText).not.toContain("start_lng");
    expect(visitQueryText).not.toContain("end_lat");
    expect(visitQueryText).not.toContain("end_lng");
    expect(visitParams).toEqual(["10"]);

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

  it("allows admin to view non-owner visit within scope", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue({
      ...PM_PERM,
      role: "admin",
      level: 2,
      regions: ["North"],
      school_codes: null,
    } as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery
      .mockResolvedValueOnce([{ ...VISIT_DETAIL, pm_email: "other@avantifellows.org" }])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(200);
  });

  it("allows in-scope program admin to view non-owner visit", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });
    mockQuery
      .mockResolvedValueOnce([{ ...VISIT_DETAIL, pm_email: "other@avantifellows.org" }])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(200);
  });

  it("allows owner PM to read completed visit", async () => {
    setupAuth();
    mockQuery
      .mockResolvedValueOnce([COMPLETED_VISIT_DETAIL])
      .mockResolvedValueOnce(ACTION_ROWS);

    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visit.status).toBe("completed");
    expect(json.visit.completed_at).toBe("2026-02-15T12:00:00Z");
  });

  it("allows admin to read completed non-owner visit within scope", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue({
      ...PM_PERM,
      role: "admin",
      level: 2,
      regions: ["North"],
      school_codes: null,
    } as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery
      .mockResolvedValueOnce([{ ...COMPLETED_VISIT_DETAIL, pm_email: "other@avantifellows.org" }])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(200);
  });

  it("allows in-scope program admin to read completed non-owner visit", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });
    mockQuery
      .mockResolvedValueOnce([{ ...COMPLETED_VISIT_DETAIL, pm_email: "other@avantifellows.org" }])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(200);
  });

  it("returns 403 for admin out of scope", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue({
      ...PM_PERM,
      role: "admin",
      level: 2,
      regions: ["North"],
      school_codes: null,
    } as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery.mockResolvedValue([{ ...VISIT_DETAIL, pm_email: "other@avantifellows.org", school_region: "South" }]);

    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns 403 for program admin out of scope", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });
    mockQuery.mockResolvedValue([{ ...VISIT_DETAIL, pm_email: "other@avantifellows.org", school_region: "South" }]);

    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });
});
