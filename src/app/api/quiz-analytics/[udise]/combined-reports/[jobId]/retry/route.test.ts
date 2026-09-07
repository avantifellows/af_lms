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

import { authorizeSchoolAccess } from "@/lib/api-auth";
import {
  getCombinedReportJob,
  retryCombinedReportJob,
} from "@/lib/reporting-service";
import { POST } from "./route";
import {
  jsonRequest,
  routeParams,
} from "../../../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGet = vi.mocked(getCombinedReportJob);
const mockRetry = vi.mocked(retryCombinedReportJob);

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
