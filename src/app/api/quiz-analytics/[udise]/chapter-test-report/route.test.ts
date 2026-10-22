import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/bigquery", () => ({
  isSessionOnlyForProgram: vi.fn(),
}));
vi.mock("@/lib/question-analytics", () => ({
  getChapterTestReport: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { isSessionOnlyForProgram } from "@/lib/bigquery";
import { getChapterTestReport } from "@/lib/question-analytics";
import { GET } from "./route";
import {
  PMU_GOVT_PERMISSION,
  PMU_MANAGER_PERMISSION,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockReport = vi.mocked(getChapterTestReport);
const mockSessionPin = vi.mocked(isSessionOnlyForProgram);

const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };
const BASE = "http://localhost/api/quiz-analytics/1234/chapter-test-report";

const REPORT = {
  test: { session_id: "s1", test_name: "12P24 - Wave Optics - JEE Main" },
  overview: { students: 48 },
  gender: [],
  questions: [],
  comparison: [],
} as unknown as Awaited<ReturnType<typeof getChapterTestReport>>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/quiz-analytics/[udise]/chapter-test-report", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(new Request(`${BASE}?grade=12&sessionId=s1`), routeParams({ udise: "1234" }));
    expect(res.status).toBe(401);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("returns 400 without a session", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    const res = await GET(new Request(`${BASE}?grade=12`), routeParams({ udise: "1234" }));
    expect(res.status).toBe(400);
  });

  it("refuses JNV NVS before reading any data", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    const res = await GET(
      new Request(`${BASE}?grade=12&sessionId=s1&program=JNV+NVS`),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(403);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("returns the report, passing program and lower-cased stream", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockReport.mockResolvedValue(REPORT);
    const res = await GET(
      new Request(`${BASE}?grade=12&sessionId=s1&program=EMRS+CoE&stream=Engineering`),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REPORT);
    expect(mockReport).toHaveBeenCalledWith({
      udise: "1234",
      grade: 12,
      sessionId: "s1",
      program: "EMRS CoE",
      stream: "engineering",
    });
  });

  it("returns 404 when the session has no results", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockReport.mockResolvedValue(null);
    const res = await GET(new Request(`${BASE}?grade=12&sessionId=s1`), routeParams({ udise: "1234" }));
    expect(res.status).toBe(404);
  });

  it("returns 500 when BigQuery fails", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockReport.mockRejectedValue(new Error("BQ outage"));
    const res = await GET(new Request(`${BASE}?grade=12&sessionId=s1`), routeParams({ udise: "1234" }));
    expect(res.status).toBe(500);
  });
});

// PMU roles are pinned to JNV NVS, and this report is physical-centres only.
describe.each([
  ["PMU Manager", PMU_MANAGER_PERMISSION],
  ["PMU Govt School User", PMU_GOVT_PERMISSION],
])("GET chapter-test-report as %s", (_label, permission) => {
  it("is refused without reading the report", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: false, permission });
    mockSessionPin.mockResolvedValue(true);
    const res = await GET(new Request(`${BASE}?grade=12&sessionId=s1`), routeParams({ udise: "1234" }));
    expect(res.status).toBe(403);
    expect(mockReport).not.toHaveBeenCalled();
  });
});
