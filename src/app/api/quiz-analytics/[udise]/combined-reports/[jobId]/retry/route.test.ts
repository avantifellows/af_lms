import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/reporting-service", () => ({
  getCombinedReportJob: vi.fn(),
  retryCombinedReportJob: vi.fn(),
  ReportingServiceError: class ReportingServiceError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
      super(`reporting ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));
vi.mock("@/lib/bigquery", () => ({ isSessionOnlyForProgram: vi.fn() }));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import {
  getCombinedReportJob,
  retryCombinedReportJob,
} from "@/lib/reporting-service";
import { isSessionOnlyForProgram } from "@/lib/bigquery";
import { POST } from "./route";
import {
  PMU_GOVT_PERMISSION,
  PMU_MANAGER_PERMISSION,
  jsonRequest,
  routeParams,
} from "../../../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGet = vi.mocked(getCombinedReportJob);
const mockRetry = vi.mocked(retryCombinedReportJob);
const mockSessionPin = vi.mocked(isSessionOnlyForProgram);

const SCHOOL = { id: "1", code: "34054", name: "JNV Palghar", region: "West" };
const URL =
  "http://localhost/api/quiz-analytics/27361106702/combined-reports/job-1/retry";
const PARAMS = routeParams({ udise: "27361106702", jobId: "job-1" });

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: false });
});

describe("POST combined-reports/[jobId]/retry", () => {
  it("asks auth for edit rights — a retry re-enqueues work", async () => {
    mockGet.mockResolvedValue({ school_code: SCHOOL.code } as never);
    mockRetry.mockResolvedValue({ job_id: "job-1", status: "queued" } as never);

    const res = await POST(jsonRequest(URL, { method: "POST" }), PARAMS);
    expect(res.status).toBe(200);
    expect(mockAuth).toHaveBeenCalledWith("27361106702", { requireEdit: true });
    expect(mockRetry).toHaveBeenCalledWith("job-1");
  });

  it("returns the auth response and does nothing when auth refuses", async () => {
    const { NextResponse } = await import("next/server");
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { error: "Read-only access cannot perform this action" },
        { status: 403 },
      ),
    });

    const res = await POST(jsonRequest(URL, { method: "POST" }), PARAMS);
    expect(res.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it("404s when the job belongs to another school", async () => {
    mockGet.mockResolvedValue({ school_code: "99999" } as never);

    const res = await POST(jsonRequest(URL, { method: "POST" }), PARAMS);
    expect(res.status).toBe(404);
    expect(mockRetry).not.toHaveBeenCalled();
  });
});

// PMU roles are pinned to JNV NVS (ADR 0007): a job for any other test at the
// School is out of scope, so it 404s like another School's job.
describe.each([
  ["PMU Manager", PMU_MANAGER_PERMISSION],
  ["PMU Govt School User", PMU_GOVT_PERMISSION],
])("POST combined-reports/[jobId]/retry as %s", (_label, permission) => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: false, permission });
    mockRetry.mockResolvedValue({ job_id: "job-1", status: "queued" } as never);
  });

  it("retries a job for a JNV NVS test", async () => {
    mockGet.mockResolvedValue({ school_code: SCHOOL.code, session_id: "nvs-session" } as never);
    mockSessionPin.mockResolvedValue(true);

    const res = await POST(jsonRequest(URL, { method: "POST" }), PARAMS);
    expect(res.status).toBe(200);
    expect(mockSessionPin).toHaveBeenCalledWith("27361106702", "nvs-session", "JNV NVS");
    expect(mockRetry).toHaveBeenCalledWith("job-1");
  });

  it("404s and does not retry a job for a non-NVS test", async () => {
    mockGet.mockResolvedValue({ school_code: SCHOOL.code, session_id: "coe-session" } as never);
    mockSessionPin.mockResolvedValue(false);

    const res = await POST(jsonRequest(URL, { method: "POST" }), PARAMS);
    expect(res.status).toBe(404);
    expect(mockRetry).not.toHaveBeenCalled();
  });
});

describe("POST combined-reports/[jobId]/retry as another role", () => {
  it("retries a non-NVS job without a session lookup", async () => {
    mockAuth.mockResolvedValue({
      authorized: true,
      school: SCHOOL,
      readOnly: false,
      permission: {
        email: "pm@avantifellows.org",
        level: 3,
        role: "program_manager",
        school_codes: null,
        regions: null,
        program_ids: [1],
        read_only: false,
      },
    });
    mockGet.mockResolvedValue({ school_code: SCHOOL.code, session_id: "coe-session" } as never);
    mockSessionPin.mockResolvedValue(false);
    mockRetry.mockResolvedValue({ job_id: "job-1", status: "queued" } as never);

    const res = await POST(jsonRequest(URL, { method: "POST" }), PARAMS);
    expect(res.status).toBe(200);
    expect(mockSessionPin).not.toHaveBeenCalled();
    expect(mockRetry).toHaveBeenCalledWith("job-1");
  });
});
