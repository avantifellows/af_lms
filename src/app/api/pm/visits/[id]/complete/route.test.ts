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

import {
  CLASSROOM_OBSERVATION_RUBRIC,
  CURRENT_RUBRIC_VERSION,
} from "@/lib/classroom-observation-rubric";
import { query } from "@/lib/db";
import { getFeatureAccess, getUserPermission } from "@/lib/permissions";
import {
  ADMIN_SESSION,
  NO_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
  routeParams,
} from "../../../../__test-utils__/api-test-helpers";
import { POST } from "./route";

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

const ADMIN_PERM = {
  email: "admin@avantifellows.org",
  level: 2 as const,
  role: "admin" as const,
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
  completed_at: null,
  school_region: "North",
};

const COMPLETED_VISIT_ROW = {
  ...VISIT_ROW,
  status: "completed",
  completed_at: "2026-02-19T12:00:00.000Z",
};

function buildValidClassroomData() {
  const params = Object.fromEntries(
    CLASSROOM_OBSERVATION_RUBRIC.parameters.map((parameter) => [
      parameter.key,
      { score: parameter.options[0]!.score },
    ])
  );

  return {
    rubric_version: CURRENT_RUBRIC_VERSION,
    params,
    teacher_id: 1,
    teacher_name: "Test Teacher",
    grade: "10",
  };
}

function completionRequest(accuracy = 10) {
  return new Request("http://localhost/api/pm/visits/10/complete", {
    method: "POST",
    body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: accuracy }),
    headers: { "Content-Type": "application/json" },
  });
}

function setupPmEdit() {
  mockSession.mockResolvedValue(PM_SESSION);
  mockGetPermission.mockResolvedValue(PM_PERM as never);
  mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/pm/visits/[id]/complete", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Passcode users cannot access visit routes",
    });
  });

  it("returns 403 for program admin write attempt", async () => {
    mockSession.mockResolvedValue(PROGRAM_ADMIN_SESSION as never);
    mockGetPermission.mockResolvedValue(PROGRAM_ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 422 when no completed classroom observation exists", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([{ has_in_progress_actions: false }])
      .mockResolvedValueOnce([]);

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "At least one completed classroom observation is required to complete visit",
      details: ["No completed classroom observation action found for this visit"],
    });
  });

  it("returns 422 when completed classroom observations are rubric-invalid", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([{ has_in_progress_actions: false }])
      .mockResolvedValueOnce([
        {
          id: 201,
          data: {
            rubric_version: CURRENT_RUBRIC_VERSION,
            params: {
              teacher_on_time: { score: 1 },
            },
          },
        },
      ]);

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("At least one completed classroom observation is required to complete visit");
    expect(json.details).toEqual(
      expect.arrayContaining([
        "Action 201: Missing score for Teacher Grooming",
        "Action 201: Missing score for Gender Sensitivity Parameters",
      ])
    );
  });

  it("returns 422 when completed classroom observation uses unsupported rubric version", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([{ has_in_progress_actions: false }])
      .mockResolvedValueOnce([
        {
          id: 301,
          data: {
            rubric_version: "99.0",
            params: {},
          },
        },
      ]);

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "At least one completed classroom observation is required to complete visit",
      details: ["Action 301: Unsupported classroom observation rubric_version: 99.0"],
    });
  });

  it("returns 422 when any action is in progress", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([{ has_in_progress_actions: true }]);

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "All in-progress action points must be ended before completing visit",
    });
  });

  it("returns 422 when GPS accuracy is poor (>500m)", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]);

    const res = await POST(completionRequest(701) as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "GPS accuracy too low (701m). Move to an open area and try again.",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("completes visit, sets completed fields, and does not expose lat/lng", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([{ has_in_progress_actions: false }])
      .mockResolvedValueOnce([
        {
          id: 201,
          data: buildValidClassroomData(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 10,
          status: "completed",
          completed_at: "2026-02-19T12:15:00.000Z",
        },
      ]);

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      visit: {
        id: 10,
        status: "completed",
        completed_at: "2026-02-19T12:15:00.000Z",
      },
    });
    expect(json.visit.end_lat).toBeUndefined();
    expect(json.visit.end_lng).toBeUndefined();
    expect(json.visit.end_accuracy).toBeUndefined();

    const [completionQueryText, completionParams] = mockQuery.mock.calls[3] as [string, unknown[]];
    expect(completionQueryText).toContain("UPDATE lms_pm_school_visits v");
    expect(completionQueryText).toContain("status = 'completed'");
    expect(completionQueryText).toContain("completed_at = (NOW() AT TIME ZONE 'UTC')");
    expect(completionQueryText).toContain("end_lat = $2");
    expect(completionQueryText).toContain("end_lng = $3");
    expect(completionQueryText).toContain("end_accuracy = $4");
    expect(completionQueryText).toContain("updated_at = (NOW() AT TIME ZONE 'UTC')");
    expect(completionQueryText).toContain("a.status = 'in_progress'");
    expect(completionQueryText).toContain("a.deleted_at IS NULL");
    expect(completionQueryText).toContain("v.status = 'in_progress'");
    expect(completionParams).toEqual(["10", 28.6, 77.2, 10]);
  });

  it("is idempotent when visit is already completed and does not attempt update", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([COMPLETED_VISIT_ROW]);

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      visit: {
        id: 10,
        status: "completed",
        completed_at: "2026-02-19T12:00:00.000Z",
      },
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("allows admin to complete other PM visit with same validation rules and GPS", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetPermission.mockResolvedValue(ADMIN_PERM as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery
      .mockResolvedValueOnce([{ ...VISIT_ROW, pm_email: "other-pm@avantifellows.org" }])
      .mockResolvedValueOnce([{ has_in_progress_actions: false }])
      .mockResolvedValueOnce([
        {
          id: 202,
          data: buildValidClassroomData(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 10,
          status: "completed",
          completed_at: "2026-02-19T12:20:00.000Z",
        },
      ]);

    const res = await POST(completionRequest() as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      visit: {
        id: 10,
        status: "completed",
        completed_at: "2026-02-19T12:20:00.000Z",
      },
    });
  });
});
