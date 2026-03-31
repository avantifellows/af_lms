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

import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction";
import {
  CLASSROOM_OBSERVATION_RUBRIC,
  CURRENT_RUBRIC_VERSION,
} from "@/lib/classroom-observation-rubric";
import { GROUP_STUDENT_DISCUSSION_CONFIG } from "@/lib/group-student-discussion";
import { INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG } from "@/lib/individual-af-teacher-interaction";
import { INDIVIDUAL_STUDENT_DISCUSSION_CONFIG } from "@/lib/individual-student-discussion";
import { PRINCIPAL_INTERACTION_CONFIG } from "@/lib/principal-interaction";
import { SCHOOL_STAFF_INTERACTION_CONFIG } from "@/lib/school-staff-interaction";
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

const COMPLETE_PI_DATA = {
  questions: {
    oh_program_feedback: { answer: true },
    ip_curriculum_progress: { answer: true },
    ip_key_events: { answer: false },
    sp_student_performance: { answer: true },
    sn_concerns_raised: { answer: false },
    mp_monthly_plan: { answer: true },
    mp_permissions_obtained: { answer: true },
  },
};

const PENDING_ACTION = {
  id: 101,
  visit_id: 10,
  action_type: "principal_interaction",
  status: "pending",
  data: COMPLETE_PI_DATA,
  started_at: null,
  ended_at: null,
  start_accuracy: null,
  end_accuracy: null,
  inserted_at: "2026-02-19T10:00:00.000Z",
  updated_at: "2026-02-19T10:00:00.000Z",
};

const IN_PROGRESS_ACTION = {
  ...PENDING_ACTION,
  status: "in_progress",
  started_at: "2026-02-19T10:05:00.000Z",
  start_accuracy: "12.00",
  updated_at: "2026-02-19T10:05:00.000Z",
};

const COMPLETED_ACTION = {
  ...IN_PROGRESS_ACTION,
  status: "completed",
  ended_at: "2026-02-19T10:25:00.000Z",
  end_accuracy: "15.00",
  updated_at: "2026-02-19T10:25:00.000Z",
};

function buildValidAFTeamData() {
  const questions = Object.fromEntries(
    AF_TEAM_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
  );
  return {
    teachers: [{ id: 1, name: "Teacher A" }],
    questions,
  };
}

function buildValidIndividualTeacherData(teacherIds: number[] = [1]) {
  const questions = Object.fromEntries(
    INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys.map((key) => [
      key,
      { answer: true },
    ])
  );
  return {
    teachers: teacherIds.map((id) => ({
      id,
      name: `Teacher ${id}`,
      attendance: "present" as const,
      questions,
    })),
  };
}


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

function buildValidPrincipalInteractionData() {
  const questions = Object.fromEntries(
    PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
  );
  return { questions };
}

function buildValidGroupStudentDiscussionData() {
  const questions = Object.fromEntries(
    GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
  );
  return { grade: 11, questions };
}

function buildValidIndividualStudentDiscussionData() {
  const questions = Object.fromEntries(
    INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
  );
  return {
    students: [{ id: 1, name: "Student A", grade: 11, questions }],
  };
}

function buildValidSchoolStaffInteractionData() {
  const questions = Object.fromEntries(
    SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
  );
  return { questions };
}

function setupPmEdit() {
  mockSession.mockResolvedValue(PM_SESSION);
  mockGetPermission.mockResolvedValue(PM_PERM as never);
  mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/pm/visits/[id]/actions/[actionId]/end", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
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

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
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

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Visit is completed and read-only",
    });
  });

  it("returns 422 when action is not started", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([PENDING_ACTION]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Action must be started before ending",
    });
  });

  it("returns 422 when GPS accuracy is poor (>500m)", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 701 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "GPS accuracy too low (701m). Move to an open area and try again.",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for missing or soft-deleted action", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Action not found" });

    const [queryText, queryParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(queryText).toContain("deleted_at IS NULL");
    expect(queryParams).toEqual(["10", "101"]);
  });

  it("returns 422 when classroom observation rubric data is incomplete", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "classroom_observation",
        data: {
          rubric_version: CURRENT_RUBRIC_VERSION,
          params: {
            teacher_on_time: { score: 1 },
          },
        },
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid classroom observation data");
    expect(json.details).toEqual(
      expect.arrayContaining([
        "Missing score for Teacher Grooming",
        "Missing score for Gender Sensitivity Parameters",
      ])
    );
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns 422 when classroom observation stored data is malformed JSON", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "classroom_observation",
        data: null,
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid classroom observation data",
      details: ["Classroom observation data must be an object"],
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns 422 when classroom observation rubric version is unsupported", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "classroom_observation",
        data: {
          rubric_version: "99.0",
          params: {},
        },
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid classroom observation data",
      details: ["Unsupported classroom observation rubric_version: 99.0"],
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("ends classroom observation when strict rubric data is valid", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "classroom_observation",
          data: buildValidClassroomData(),
        },
      ])
      .mockResolvedValueOnce([
        {
          ...COMPLETED_ACTION,
          action_type: "classroom_observation",
          data: buildValidClassroomData(),
        },
      ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action.status).toBe("completed");
    expect(json.action.action_type).toBe("classroom_observation");
  });

  it("ends in-progress action, sets completed timestamps, and does not expose lat/lng", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([IN_PROGRESS_ACTION])
      .mockResolvedValueOnce([COMPLETED_ACTION]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ action: COMPLETED_ACTION });
    expect(json.action.start_lat).toBeUndefined();
    expect(json.action.start_lng).toBeUndefined();
    expect(json.action.end_lat).toBeUndefined();
    expect(json.action.end_lng).toBeUndefined();

    const [updateQueryText, updateParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(updateQueryText).toContain("UPDATE lms_pm_school_visit_actions");
    expect(updateQueryText).toContain("status = 'completed'");
    expect(updateQueryText).toContain("ended_at = (NOW() AT TIME ZONE 'UTC')");
    expect(updateQueryText).toContain("updated_at = (NOW() AT TIME ZONE 'UTC')");
    expect(updateQueryText).toContain("status = 'in_progress'");
    expect(updateQueryText).toContain("started_at IS NOT NULL");
    expect(updateQueryText).toContain("ended_at IS NULL");
    expect(updateParams).toEqual(["10", "101", 28.6, 77.2, 10]);
  });

  it("returns warning when GPS accuracy is moderate (100-500m)", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([IN_PROGRESS_ACTION])
      .mockResolvedValueOnce([COMPLETED_ACTION]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 250 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warning).toContain("moderate");
    expect(json.warning).toContain("250m");
  });

  it("is idempotent when already ended (no overwrite query)", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([COMPLETED_ACTION]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ action: COMPLETED_ACTION });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("handles concurrent end requests safely with idempotent success", async () => {
    setupPmEdit();
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([IN_PROGRESS_ACTION])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([COMPLETED_ACTION]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ action: COMPLETED_ACTION });
  });

  it("returns 422 when AF team interaction data is incomplete", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "af_team_interaction",
        data: { teachers: [{ id: 1, name: "A" }], questions: {} },
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid AF team interaction data");
    expect(json.details.length).toBeGreaterThan(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns 422 when AF team interaction stored data is null", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "af_team_interaction",
        data: null,
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid AF team interaction data",
      details: ["Data must be an object"],
    });
  });

  it("returns 422 when AF team interaction has empty teachers", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "af_team_interaction",
        data: { ...buildValidAFTeamData(), teachers: [] },
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid AF team interaction data");
    expect(json.details).toEqual(
      expect.arrayContaining([expect.stringContaining("At least one teacher")])
    );
  });

  it("ends AF team interaction successfully when data is complete", async () => {
    setupPmEdit();
    const afTeamData = buildValidAFTeamData();
    const completedAFAction = {
      ...COMPLETED_ACTION,
      action_type: "af_team_interaction",
      data: afTeamData,
    };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "af_team_interaction",
          data: afTeamData,
        },
      ])
      .mockResolvedValueOnce([completedAFAction]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action.status).toBe("completed");
    expect(json.action.action_type).toBe("af_team_interaction");
  });

  it("concurrent fallback validates AF team interaction data", async () => {
    setupPmEdit();
    const incompleteData = { teachers: [{ id: 1, name: "A" }], questions: {} };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "af_team_interaction",
          data: buildValidAFTeamData(),
        },
      ])
      // UPDATE returns 0 rows (concurrent)
      .mockResolvedValueOnce([])
      // Re-fetch returns action still in_progress with incomplete data
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "af_team_interaction",
          data: incompleteData,
        },
      ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid AF team interaction data");
  });

  it("returns 422 when individual teacher interaction data is incomplete", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "individual_af_teacher_interaction",
        data: {
          teachers: [
            { id: 1, name: "Teacher 1", attendance: "present", questions: {} },
          ],
        },
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid individual teacher interaction data");
    expect(json.details.length).toBeGreaterThan(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns 422 when individual teacher interaction stored data is null", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "individual_af_teacher_interaction",
        data: null,
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid individual teacher interaction data",
      details: ["Data must be an object"],
    });
  });

  it("returns 422 when not all school teachers are recorded", async () => {
    setupPmEdit();
    const data = buildValidIndividualTeacherData([1]);
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "individual_af_teacher_interaction",
          data,
        },
      ])
      // allTeachersRecordedError query returns 2 teachers but data only has teacher 1
      .mockResolvedValueOnce([
        { id: 1, full_name: "Teacher 1", email: "t1@test.com" },
        { id: 2, full_name: "Teacher 2", email: "t2@test.com" },
      ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Not all teachers at this school have been recorded");
    expect(json.details).toEqual(["Missing: Teacher 2"]);
  });

  it("ends individual teacher interaction with absent/on_leave teachers (no questions needed)", async () => {
    setupPmEdit();
    const data = {
      teachers: [
        { id: 1, name: "Teacher 1", attendance: "on_leave" as const, questions: {} },
        { id: 2, name: "Teacher 2", attendance: "absent" as const, questions: {} },
      ],
    };
    const completedAction = {
      ...COMPLETED_ACTION,
      action_type: "individual_af_teacher_interaction",
      data,
    };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "individual_af_teacher_interaction",
          data,
        },
      ])
      // allTeachersRecordedError — all teachers accounted for
      .mockResolvedValueOnce([
        { id: 1, full_name: "Teacher 1", email: "t1@test.com" },
        { id: 2, full_name: "Teacher 2", email: "t2@test.com" },
      ])
      .mockResolvedValueOnce([completedAction]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action.status).toBe("completed");
    expect(json.action.action_type).toBe("individual_af_teacher_interaction");
  });

  it("ends individual teacher interaction successfully when all teachers recorded with valid data", async () => {
    setupPmEdit();
    const data = buildValidIndividualTeacherData([1, 2]);
    const completedAction = {
      ...COMPLETED_ACTION,
      action_type: "individual_af_teacher_interaction",
      data,
    };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "individual_af_teacher_interaction",
          data,
        },
      ])
      // allTeachersRecordedError — both teachers in DB match data
      .mockResolvedValueOnce([
        { id: 1, full_name: "Teacher 1", email: "t1@test.com" },
        { id: 2, full_name: "Teacher 2", email: "t2@test.com" },
      ])
      .mockResolvedValueOnce([completedAction]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action.status).toBe("completed");
    expect(json.action.action_type).toBe("individual_af_teacher_interaction");
  });

  it("concurrent fallback validates individual teacher interaction data", async () => {
    setupPmEdit();
    const validData = buildValidIndividualTeacherData([1]);
    const incompleteData = {
      teachers: [
        { id: 1, name: "Teacher 1", attendance: "present" as const, questions: {} },
      ],
    };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "individual_af_teacher_interaction",
          data: validData,
        },
      ])
      // allTeachersRecordedError for pre-update path — passes
      .mockResolvedValueOnce([
        { id: 1, full_name: "Teacher 1", email: "t1@test.com" },
      ])
      // UPDATE returns 0 rows (concurrent)
      .mockResolvedValueOnce([])
      // Re-fetch returns action still in_progress with incomplete data
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "individual_af_teacher_interaction",
          data: incompleteData,
        },
      ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid individual teacher interaction data");
  });

  it("returns 422 when principal interaction data is incomplete", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "principal_interaction",
        data: { questions: { oh_program_feedback: { answer: true } } },
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid principal interaction data");
    expect(json.details.length).toBeGreaterThan(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns 422 when principal interaction stored data is null", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "principal_interaction",
        data: null,
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid principal interaction data",
      details: ["Data must be an object"],
    });
  });

  it("ends principal interaction successfully when all 7 questions answered", async () => {
    setupPmEdit();
    const piData = buildValidPrincipalInteractionData();
    const completedPIAction = {
      ...COMPLETED_ACTION,
      action_type: "principal_interaction",
      data: piData,
    };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "principal_interaction",
          data: piData,
        },
      ])
      .mockResolvedValueOnce([completedPIAction]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action.status).toBe("completed");
    expect(json.action.action_type).toBe("principal_interaction");
  });

  it("returns 422 when principal interaction has all null answers", async () => {
    setupPmEdit();
    const nullData = {
      questions: Object.fromEntries(
        PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: null }])
      ),
    };
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "principal_interaction",
        data: nullData,
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid principal interaction data");
    expect(json.details).toHaveLength(7);
  });

  it("concurrent fallback validates principal interaction data", async () => {
    setupPmEdit();
    const validData = buildValidPrincipalInteractionData();
    const incompleteData = { questions: {} };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "principal_interaction",
          data: validData,
        },
      ])
      // UPDATE returns 0 rows (concurrent)
      .mockResolvedValueOnce([])
      // Re-fetch returns action still in_progress with incomplete data
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "principal_interaction",
          data: incompleteData,
        },
      ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid principal interaction data");
  });

  it("returns 422 when group student discussion data is incomplete", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "group_student_discussion",
        data: { grade: 11, questions: { gc_interacted: { answer: true } } },
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid group student discussion data");
    expect(json.details.length).toBeGreaterThan(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("ends group student discussion successfully when data is complete", async () => {
    setupPmEdit();
    const gsdData = buildValidGroupStudentDiscussionData();
    const completedGSDAction = {
      ...COMPLETED_ACTION,
      action_type: "group_student_discussion",
      data: gsdData,
    };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "group_student_discussion",
          data: gsdData,
        },
      ])
      .mockResolvedValueOnce([completedGSDAction]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action.status).toBe("completed");
    expect(json.action.action_type).toBe("group_student_discussion");
  });

  it("concurrent fallback validates group student discussion data", async () => {
    setupPmEdit();
    const validData = buildValidGroupStudentDiscussionData();
    const incompleteData = { grade: 11, questions: {} };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "group_student_discussion",
          data: validData,
        },
      ])
      // UPDATE returns 0 rows (concurrent)
      .mockResolvedValueOnce([])
      // Re-fetch returns action still in_progress with incomplete data
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "group_student_discussion",
          data: incompleteData,
        },
      ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid group student discussion data");
  });

  it("returns 422 when individual student discussion data is incomplete", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "individual_student_discussion",
        data: {
          students: [
            { id: 1, name: "Student 1", grade: 11, questions: {} },
          ],
        },
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid individual student discussion data");
    expect(json.details.length).toBeGreaterThan(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("ends individual student discussion successfully when data is complete", async () => {
    setupPmEdit();
    const isdData = buildValidIndividualStudentDiscussionData();
    const completedISDAction = {
      ...COMPLETED_ACTION,
      action_type: "individual_student_discussion",
      data: isdData,
    };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "individual_student_discussion",
          data: isdData,
        },
      ])
      .mockResolvedValueOnce([completedISDAction]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action.status).toBe("completed");
    expect(json.action.action_type).toBe("individual_student_discussion");
  });

  it("concurrent fallback validates individual student discussion data", async () => {
    setupPmEdit();
    const validData = buildValidIndividualStudentDiscussionData();
    const incompleteData = {
      students: [
        { id: 1, name: "Student 1", grade: 11, questions: {} },
      ],
    };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "individual_student_discussion",
          data: validData,
        },
      ])
      // UPDATE returns 0 rows (concurrent)
      .mockResolvedValueOnce([])
      // Re-fetch returns action still in_progress with incomplete data
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "individual_student_discussion",
          data: incompleteData,
        },
      ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid individual student discussion data");
  });

  it("returns 422 when school staff interaction data is incomplete", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "school_staff_interaction",
        data: { questions: { gc_staff_concern: { answer: true } } },
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid school staff interaction data");
    expect(json.details.length).toBeGreaterThan(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns 422 when school staff interaction stored data is null", async () => {
    setupPmEdit();
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "school_staff_interaction",
        data: null,
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid school staff interaction data",
      details: ["Data must be an object"],
    });
  });

  it("ends school staff interaction successfully when all questions answered", async () => {
    setupPmEdit();
    const ssiData = buildValidSchoolStaffInteractionData();
    const completedSSIAction = {
      ...COMPLETED_ACTION,
      action_type: "school_staff_interaction",
      data: ssiData,
    };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "school_staff_interaction",
          data: ssiData,
        },
      ])
      .mockResolvedValueOnce([completedSSIAction]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action.status).toBe("completed");
    expect(json.action.action_type).toBe("school_staff_interaction");
  });

  it("returns 422 when school staff interaction has all null answers", async () => {
    setupPmEdit();
    const nullData = {
      questions: Object.fromEntries(
        SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: null }])
      ),
    };
    mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
      {
        ...IN_PROGRESS_ACTION,
        action_type: "school_staff_interaction",
        data: nullData,
      },
    ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid school staff interaction data");
    expect(json.details).toHaveLength(2);
  });

  it("concurrent fallback validates school staff interaction data", async () => {
    setupPmEdit();
    const validData = buildValidSchoolStaffInteractionData();
    const incompleteData = { questions: {} };
    mockQuery
      .mockResolvedValueOnce([VISIT_ROW])
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "school_staff_interaction",
          data: validData,
        },
      ])
      // UPDATE returns 0 rows (concurrent)
      .mockResolvedValueOnce([])
      // Re-fetch returns action still in_progress with incomplete data
      .mockResolvedValueOnce([
        {
          ...IN_PROGRESS_ACTION,
          action_type: "school_staff_interaction",
          data: incompleteData,
        },
      ]);

    const req = new Request("http://localhost/api/pm/visits/10/actions/101/end", {
      method: "POST",
      body: JSON.stringify({ end_lat: 28.6, end_lng: 77.2, end_accuracy: 10 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never, params);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid school staff interaction data");
  });
});
