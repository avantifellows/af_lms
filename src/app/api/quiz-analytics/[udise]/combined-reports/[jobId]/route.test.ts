import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/reporting-service", () => ({
  getCombinedReportJob: vi.fn(),
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
import { getCombinedReportJob } from "@/lib/reporting-service";
import { isSessionOnlyForProgram } from "@/lib/bigquery";
import { GET } from "./route";
import {
  PMU_GOVT_PERMISSION,
  PMU_MANAGER_PERMISSION,
  routeParams,
} from "../../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGet = vi.mocked(getCombinedReportJob);
const mockSessionPin = vi.mocked(isSessionOnlyForProgram);

const SCHOOL = { id: "1", code: "34054", name: "JNV Palghar", region: "West" };
const URL = "http://localhost/api/quiz-analytics/27361106702/combined-reports/job-1";
const PARAMS = routeParams({ udise: "27361106702", jobId: "job-1" });

const PM_PERMISSION = {
  email: "pm@avantifellows.org",
  level: 3 as const,
  role: "program_manager" as const,
  school_codes: null,
  regions: null,
  program_ids: [1],
  read_only: false,
};

function job(sessionId: string, schoolCode = SCHOOL.code) {
  return {
    job_id: "job-1",
    session_id: sessionId,
    school_code: schoolCode,
    status: "done",
    download_url: "https://signed.example/report.pdf",
  } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({
    authorized: true,
    school: SCHOOL,
    readOnly: false,
    permission: PM_PERMISSION,
  });
});

describe("GET combined-reports/[jobId]", () => {
  it("returns the auth response when auth refuses", async () => {
    const { NextResponse } = await import("next/server");
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    });

    const res = await GET(new Request(URL), PARAMS);
    expect(res.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("404s when the job belongs to another school", async () => {
    mockGet.mockResolvedValue(job("coe-session", "99999"));

    const res = await GET(new Request(URL), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns a non-NVS job to another role without a session lookup", async () => {
    mockGet.mockResolvedValue(job("coe-session"));
    mockSessionPin.mockResolvedValue(false);

    const res = await GET(new Request(URL), PARAMS);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ job_id: "job-1" });
    expect(mockSessionPin).not.toHaveBeenCalled();
  });
});

// PMU roles are pinned to JNV NVS (ADR 0007): a job for any other test at the
// School is out of scope, so it 404s like another School's job and its signed
// download link never leaves the server.
describe.each([
  ["PMU Manager", PMU_MANAGER_PERMISSION],
  ["PMU Govt School User", PMU_GOVT_PERMISSION],
])("GET combined-reports/[jobId] as %s", (_label, permission) => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: false, permission });
  });

  it("returns a job for a JNV NVS test", async () => {
    mockGet.mockResolvedValue(job("nvs-session"));
    mockSessionPin.mockResolvedValue(true);

    const res = await GET(new Request(URL), PARAMS);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ job_id: "job-1" });
    expect(mockSessionPin).toHaveBeenCalledWith("27361106702", "nvs-session", "JNV NVS");
  });

  it("404s a job for a non-NVS test without its download link", async () => {
    mockGet.mockResolvedValue(job("coe-session"));
    mockSessionPin.mockResolvedValue(false);

    const res = await GET(new Request(URL), PARAMS);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).not.toHaveProperty("download_url");
  });

  it("502s (fails closed) when the session lookup fails", async () => {
    mockGet.mockResolvedValue(job("nvs-session"));
    mockSessionPin.mockRejectedValue(new Error("bq down"));

    const res = await GET(new Request(URL), PARAMS);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).not.toHaveProperty("download_url");
  });
});
