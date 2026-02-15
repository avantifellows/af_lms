import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: vi.fn(),
  getFeatureAccess: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { getUserPermission, getFeatureAccess } from "@/lib/permissions";
import { query } from "@/lib/db";
import { GET, PATCH, PUT } from "./route";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
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

const params = routeParams({ id: "10" });

function setupAuth(featureAccess = { access: "edit" as const, canView: true, canEdit: true }) {
  mockSession.mockResolvedValue(PM_SESSION);
  mockGetPermission.mockResolvedValue(PM_PERM as never);
  mockFeatureAccess.mockReturnValue(featureAccess);
}

beforeEach(() => {
  vi.resetAllMocks();
});

const VISIT = {
  id: 10,
  school_code: "70705",
  pm_email: "pm@avantifellows.org",
  visit_date: "2026-02-15",
  status: "in_progress",
  data: {
    principalMeeting: null,
    leadershipMeetings: null,
    classroomObservations: [],
    studentDiscussions: { groupDiscussions: [], individualDiscussions: [] },
    staffMeetings: { individualMeetings: [], teamMeeting: null },
    teacherFeedback: [],
    issueLog: [],
  },
  inserted_at: "2026-02-15T10:00:00",
  updated_at: "2026-02-15T10:00:00",
  ended_at: null,
  start_lat: "28.6",
  start_lng: "77.2",
  start_accuracy: "10",
  end_lat: null,
  end_lng: null,
  end_accuracy: null,
  school_name: "JNV Test",
};

describe("GET /api/pm/visits/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks view access", async () => {
    setupAuth({ access: "none", canView: false, canEdit: false });
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 404 when visit not found", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([]);
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(404);
  });

  it("returns 403 when PM is not owner and not admin", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([{ ...VISIT, pm_email: "other@avantifellows.org" }]);
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns visit for the owner PM", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([VISIT]);
    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visit.id).toBe(10);
  });

  it("allows admin (level 4) to view any visit", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockGetPermission.mockResolvedValue({ ...PM_PERM, level: 4 } as never);
    mockFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockQuery.mockResolvedValue([{ ...VISIT, pm_email: "other@avantifellows.org" }]);

    const req = new Request("http://localhost/api/pm/visits/10");
    const res = await GET(req as never, params);
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/pm/visits/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PATCH",
      body: { section: "principalMeeting", data: {} },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks edit access", async () => {
    setupAuth({ access: "view", canView: true, canEdit: false });
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PATCH",
      body: { section: "principalMeeting", data: {} },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 404 when visit not found", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([]);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PATCH",
      body: { section: "principalMeeting", data: {} },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(404);
  });

  it("returns 403 when PM is not the creator", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([{ ...VISIT, pm_email: "other@test.com" }]);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PATCH",
      body: { section: "principalMeeting", data: {} },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 400 when visit is already completed", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([{ ...VISIT, status: "completed" }]);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PATCH",
      body: { section: "principalMeeting", data: {} },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("completed");
  });

  it("returns 400 when section or data is missing", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([VISIT]);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PATCH",
      body: { section: "principalMeeting" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid section name", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([VISIT]);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PATCH",
      body: { section: "invalidSection", data: {} },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid section");
  });

  it("updates a valid section successfully", async () => {
    setupAuth();
    mockQuery
      .mockResolvedValueOnce([VISIT]) // fetch visit
      .mockResolvedValueOnce([]) // update query
      .mockResolvedValueOnce([{ ...VISIT, data: { ...VISIT.data, principalMeeting: { notes: "test" } } }]); // refetch

    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PATCH",
      body: { section: "principalMeeting", data: { notes: "test" } },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visit).toBeDefined();
  });
});

describe("PUT /api/pm/visits/[id] (complete)", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PUT",
      body: { action: "complete" },
    });
    const res = await PUT(req as never, params);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid action", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PUT",
      body: { action: "delete" },
    });
    const res = await PUT(req as never, params);
    expect(res.status).toBe(400);
  });

  it("returns 404 when visit not found", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockQuery.mockResolvedValue([]);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PUT",
      body: { action: "complete" },
    });
    const res = await PUT(req as never, params);
    expect(res.status).toBe(404);
  });

  it("returns 403 when PM is not the owner", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockQuery.mockResolvedValue([{ ...VISIT, pm_email: "other@test.com" }]);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PUT",
      body: { action: "complete" },
    });
    const res = await PUT(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 400 when visit is already completed", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockQuery.mockResolvedValue([{ ...VISIT, pm_email: "pm@avantifellows.org", status: "completed" }]);
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PUT",
      body: { action: "complete" },
    });
    const res = await PUT(req as never, params);
    expect(res.status).toBe(400);
  });

  it("returns validation errors when required sections are missing", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockQuery.mockResolvedValue([VISIT]); // all data fields are null/empty
    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PUT",
      body: { action: "complete" },
    });
    const res = await PUT(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details).toContain("Principal meeting is required");
    expect(json.details).toContain("Leadership meetings are required");
    expect(json.details).toContain("At least one classroom observation is required");
  });

  it("completes visit when all required sections are filled", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    const completeVisit = {
      ...VISIT,
      data: {
        principalMeeting: { notes: "met" },
        leadershipMeetings: { notes: "met" },
        classroomObservations: [{ subject: "Physics" }],
        studentDiscussions: { groupDiscussions: [{ notes: "good" }], individualDiscussions: [] },
        staffMeetings: { individualMeetings: [], teamMeeting: { notes: "done" } },
        teacherFeedback: [],
        issueLog: [],
      },
    };
    mockQuery
      .mockResolvedValueOnce([completeVisit]) // fetch
      .mockResolvedValueOnce([]); // update

    const req = jsonRequest("http://localhost/api/pm/visits/10", {
      method: "PUT",
      body: { action: "complete" },
    });
    const res = await PUT(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("completed");
  });
});
