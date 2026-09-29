import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/reporting-service", () => ({
  submitCombinedReport: vi.fn(),
  listCombinedReportJobs: vi.fn(),
  ReportingServiceError: class extends Error {},
}));
vi.mock("@/lib/combined-report-eligibility", async (importOriginal) => {
  // Keep the real evaluator + messages; only the DB lookup is stubbed.
  const actual = await importOriginal<
    typeof import("@/lib/combined-report-eligibility")
  >();
  return { ...actual, getSessionWindow: vi.fn() };
});
vi.mock("@/lib/school-students", () => ({
  getSchoolRoster: vi.fn(),
  filterActiveRosterStudents: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import {
  submitCombinedReport,
  listCombinedReportJobs,
} from "@/lib/reporting-service";
import type { CombinedReportJob } from "@/lib/reporting-service";
import { getSessionWindow } from "@/lib/combined-report-eligibility";
import {
  getSchoolRoster,
  filterActiveRosterStudents,
} from "@/lib/school-students";
import { GET, POST } from "./route";
import {
  PMU_GOVT_PERMISSION,
  PMU_MANAGER_PERMISSION,
  jsonRequest,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockList = vi.mocked(listCombinedReportJobs);
const mockSubmit = vi.mocked(submitCombinedReport);
const mockWindow = vi.mocked(getSessionWindow);
const mockRoster = vi.mocked(getSchoolRoster);
const mockFilter = vi.mocked(filterActiveRosterStudents);

const SCHOOL = { id: "1", code: "34054", name: "JNV Palghar", region: "West" };
const URL_BASE =
  "http://localhost/api/quiz-analytics/27361106702/combined-reports";
const SESSION = "EnableStudents_abc";

const ENDED = { endTimeUtcIso: "2026-06-23T18:03:00.000Z", hasEnded: true };
const OPEN = { endTimeUtcIso: "2026-12-31T18:03:00.000Z", hasEnded: false };

/** Only `status` drives the gate; the rest is filler to satisfy the job type. */
function job(status: CombinedReportJob["status"]): CombinedReportJob {
  return {
    job_id: `job-${status}`,
    session_id: SESSION,
    school_code: SCHOOL.code,
    test_name: null,
    status,
    student_count: 1,
    matched_count: 1,
    missing_count: 0,
    error: null,
    download_url: null,
    created_at: "2026-06-24T00:00:00.000Z",
    updated_at: "2026-06-24T00:00:00.000Z",
    retry_count: 0,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: false });
  // Roster shapes are incidental to the gate; cast to keep the fixture small.
  mockRoster.mockResolvedValue({
    students: [{ user_id: 1, student_id: "S1", apaar_id: null }],
  } as unknown as Awaited<ReturnType<typeof getSchoolRoster>>);
  mockFilter.mockReturnValue([
    { user_id: 1, student_id: "S1", apaar_id: null },
  ] as unknown as ReturnType<typeof filterActiveRosterStudents>);
});

function postBody() {
  return jsonRequest(URL_BASE, {
    method: "POST",
    body: { session_id: SESSION, grade: 12 },
  });
}

describe("GET combined-reports", () => {
  it("reports can_generate false with read_only for a read-only caller, even when the test is eligible", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: true });
    mockList.mockResolvedValue([]);
    mockWindow.mockResolvedValue(ENDED);

    const res = await GET(
      new Request(`${URL_BASE}?session_id=${SESSION}`),
      routeParams({ udise: "27361106702" }),
    );
    // Listing still works (read-only means view, not none); only the verdict changes.
    await expect(res.json()).resolves.toMatchObject({
      jobs: [],
      can_generate: false,
      blocked_reason: "read_only",
      blocked_message: expect.stringMatching(/read-only/i),
    });
  });

  it("reports can_generate false with a reason while the session is open", async () => {
    mockList.mockResolvedValue([]);
    mockWindow.mockResolvedValue(OPEN);

    const res = await GET(
      new Request(`${URL_BASE}?session_id=${SESSION}`),
      routeParams({ udise: "27361106702" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.can_generate).toBe(false);
    expect(body.blocked_reason).toBe("session_not_ended");
    expect(body.session_end_time).toBe(OPEN.endTimeUtcIso);
    expect(body.blocked_message).toMatch(/still open/i);
  });

  it("reports can_generate true once ended with no prior jobs", async () => {
    mockList.mockResolvedValue([]);
    mockWindow.mockResolvedValue(ENDED);

    const res = await GET(
      new Request(`${URL_BASE}?session_id=${SESSION}`),
      routeParams({ udise: "27361106702" }),
    );
    const body = await res.json();
    expect(body.can_generate).toBe(true);
    expect(body.blocked_reason).toBeNull();
  });

  it("reports already_generated when a done job exists", async () => {
    mockList.mockResolvedValue([job("done")]);
    mockWindow.mockResolvedValue(ENDED);

    const res = await GET(
      new Request(`${URL_BASE}?session_id=${SESSION}`),
      routeParams({ udise: "27361106702" }),
    );
    const body = await res.json();
    expect(body.can_generate).toBe(false);
    expect(body.blocked_reason).toBe("already_generated");
  });
});

describe("POST combined-reports gating", () => {
  it("409s and does not submit while the session is still open", async () => {
    mockWindow.mockResolvedValue(OPEN);
    mockList.mockResolvedValue([]);

    const res = await POST(postBody(), routeParams({ udise: "27361106702" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("session_not_ended");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("409s and does not submit when a report was already generated", async () => {
    mockWindow.mockResolvedValue(ENDED);
    mockList.mockResolvedValue([job("done")]);

    const res = await POST(postBody(), routeParams({ udise: "27361106702" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("already_generated");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("409s while a job is still in flight", async () => {
    mockWindow.mockResolvedValue(ENDED);
    mockList.mockResolvedValue([job("processing")]);

    const res = await POST(postBody(), routeParams({ udise: "27361106702" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("job_in_progress");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("submits once ended with no blocking job", async () => {
    mockWindow.mockResolvedValue(ENDED);
    mockList.mockResolvedValue([]);
    mockSubmit.mockResolvedValue({ job_id: "j1", status: "queued" });

    const res = await POST(postBody(), routeParams({ udise: "27361106702" }));
    expect(res.status).toBe(202);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it("still submits when previous jobs all errored", async () => {
    mockWindow.mockResolvedValue(ENDED);
    mockList.mockResolvedValue([job("errored")]);
    mockSubmit.mockResolvedValue({ job_id: "j2", status: "queued" });

    const res = await POST(postBody(), routeParams({ udise: "27361106702" }));
    expect(res.status).toBe(202);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it("asks auth for edit rights — read-only callers must 403 before any work", async () => {
    mockWindow.mockResolvedValue(ENDED);
    mockList.mockResolvedValue([]);
    mockSubmit.mockResolvedValue({ job_id: "j1", status: "queued" });

    await POST(postBody(), routeParams({ udise: "27361106702" }));
    expect(mockAuth).toHaveBeenCalledWith("27361106702", { requireEdit: true });
  });

  it("keeps auth ahead of the gate", async () => {
    const { NextResponse } = await import("next/server");
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    });

    const res = await POST(postBody(), routeParams({ udise: "27361106702" }));
    expect(res.status).toBe(403);
    expect(mockWindow).not.toHaveBeenCalled();
  });
});

// PMU roles are pinned to JNV NVS (ADR 0007): the report cohort defaults to
// "JNV NVS" and any other program is refused before any work.
describe.each([
  ["PMU Manager", PMU_MANAGER_PERMISSION],
  ["PMU Govt School User", PMU_GOVT_PERMISSION],
])("combined-reports as %s", (_label, permission) => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: false, permission });
    mockWindow.mockResolvedValue(ENDED);
    mockList.mockResolvedValue([]);
    mockSubmit.mockResolvedValue({ job_id: "j1", status: "queued" });
  });

  function pmuPost(program?: string) {
    return jsonRequest(URL_BASE, {
      method: "POST",
      body: { session_id: SESSION, grade: 12, ...(program ? { program } : {}) },
    });
  }

  it("POST builds the JNV NVS cohort when no program is given", async () => {
    const res = await POST(pmuPost(), routeParams({ udise: "27361106702" }));
    expect(res.status).toBe(202);
    expect(mockFilter).toHaveBeenCalledWith(expect.anything(), {
      grade: 12,
      program: "JNV NVS",
      stream: undefined,
    });
  });

  it("POST accepts program=JNV NVS", async () => {
    const res = await POST(pmuPost("JNV NVS"), routeParams({ udise: "27361106702" }));
    expect(res.status).toBe(202);
    expect(mockFilter).toHaveBeenCalledWith(expect.anything(), {
      grade: 12,
      program: "JNV NVS",
      stream: undefined,
    });
  });

  it("POST still asks auth for edit rights", async () => {
    await POST(pmuPost(), routeParams({ udise: "27361106702" }));
    expect(mockAuth).toHaveBeenCalledWith("27361106702", { requireEdit: true });
  });

  it.each(["JNV CoE", "JNV Nodal", "Punjab CoE"])("POST 403s program=%s", async (program) => {
    const res = await POST(pmuPost(program), routeParams({ udise: "27361106702" }));
    expect(res.status).toBe(403);
    expect(mockWindow).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("GET lists jobs when no program is given", async () => {
    const res = await GET(
      new Request(`${URL_BASE}?session_id=${SESSION}`),
      routeParams({ udise: "27361106702" })
    );
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(SESSION, SCHOOL.code);
  });

  it.each(["JNV CoE", "JNV Nodal"])("GET 403s program=%s", async (program) => {
    const res = await GET(
      new Request(`${URL_BASE}?session_id=${SESSION}&program=${encodeURIComponent(program)}`),
      routeParams({ udise: "27361106702" })
    );
    expect(res.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });
});
