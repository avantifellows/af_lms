import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/bigquery", () => ({
  getBatchOverviewData: vi.fn(),
}));
vi.mock("@/lib/question-analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/question-analytics")>()),
  getCmsTestChapters: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getBatchOverviewData } from "@/lib/bigquery";
import { getCmsTestChapters } from "@/lib/question-analytics";
import { GET } from "./route";
import {
  PMU_GOVT_PERMISSION,
  PMU_MANAGER_PERMISSION,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGetBatchOverview = vi.mocked(getBatchOverviewData);
const mockChapters = vi.mocked(getCmsTestChapters);

beforeEach(() => {
  vi.resetAllMocks();
});

const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };

function makeRequest(grade?: string, extra: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/quiz-analytics/1234/batch-overview");
  if (grade !== undefined) url.searchParams.set("grade", grade);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

describe("GET /api/quiz-analytics/[udise]/batch-overview", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(makeRequest("10"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when access is denied", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    });

    const res = await GET(makeRequest("10"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when grade param is missing", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(makeRequest(), routeParams({ udise: "1234" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "grade is required" });
  });

  it("returns 400 when grade is not a number", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(makeRequest("abc"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "grade must be an integer" });
  });

  it("computes summary correctly (tests_conducted, avg_participation)", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetBatchOverview.mockResolvedValue({
      tests: [
        { session_id: "s1", test_name: "Test 1", start_date: "2026-01-10", student_count: 20, stream_student_count: 20, test_format: "chapter", test_stream: null, test_grade: 11, subjects: ["Physics"] },
        { session_id: "s2", test_name: "Test 2", start_date: "2026-01-20", student_count: 30, stream_student_count: 30, test_format: "full", test_stream: null, test_grade: 12, subjects: [] },
        { session_id: "s3", test_name: "Test 3", start_date: "2026-02-01", student_count: 25, stream_student_count: 25, test_format: null, test_stream: null, test_grade: null, subjects: [] },
      ],
      totalEnrolled: 40,
      enrolledByStream: {},
      streams: ["pcm", "pcb"],
    });

    const res = await GET(makeRequest("10"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.summary.tests_conducted).toBe(3);
    // avg_participation = Math.round((20 + 30 + 25) / 3) = Math.round(25) = 25
    expect(json.summary.avg_participation).toBe(25);
    expect(json.tests).toHaveLength(3);
    expect(json.totalEnrolled).toBe(40);
    expect(json.streams).toEqual(["pcm", "pcb"]);
    expect(mockGetBatchOverview).toHaveBeenCalledWith("1234", 10, undefined, undefined);
  });

  it("forwards stream param (lowercased) to BQ helper", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetBatchOverview.mockResolvedValue({ tests: [], totalEnrolled: 0, enrolledByStream: {}, streams: [] });

    await GET(makeRequest("10", { stream: "PCM", program: "JNV" }), routeParams({ udise: "1234" }));
    expect(mockGetBatchOverview).toHaveBeenCalledWith("1234", 10, "JNV", "pcm");
  });

  it("returns zero avg_participation when no tests", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetBatchOverview.mockResolvedValue({
      tests: [],
      totalEnrolled: 40,
      enrolledByStream: {},
      streams: [],
    });

    const res = await GET(makeRequest("10"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.summary.tests_conducted).toBe(0);
    expect(json.summary.avg_participation).toBe(0);
    expect(json.tests).toHaveLength(0);
  });

  it("returns test list and totalEnrolled", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    const tests = [
      { session_id: "s1", test_name: "Midterm", start_date: "2026-01-15", student_count: 35, stream_student_count: 35, test_format: "full", test_stream: null, test_grade: 12, subjects: [] },
    ];
    mockGetBatchOverview.mockResolvedValue({ tests, totalEnrolled: 50, enrolledByStream: {}, streams: [] });

    const res = await GET(makeRequest("11"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.tests).toEqual(tests);
    expect(json.totalEnrolled).toBe(50);
  });

  it("returns 500 when getBatchOverviewData throws", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetBatchOverview.mockRejectedValue(new Error("BigQuery failed"));

    const res = await GET(makeRequest("10"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to fetch batch overview" });
  });
});

// PMU roles are pinned to JNV NVS (ADR 0007): a missing program becomes
// "JNV NVS", any other program is refused before BigQuery is queried.
describe.each([
  ["PMU Manager", PMU_MANAGER_PERMISSION],
  ["PMU Govt School User", PMU_GOVT_PERMISSION],
])("GET batch-overview as %s", (_label, permission) => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: false, permission });
    mockGetBatchOverview.mockResolvedValue({ tests: [], totalEnrolled: 0, enrolledByStream: {}, streams: [] });
  });

  it("serves JNV NVS data when no program is given", async () => {
    const res = await GET(makeRequest("11"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    expect(mockGetBatchOverview).toHaveBeenCalledWith("1234", 11, "JNV NVS", undefined);
  });

  it("serves program=JNV NVS", async () => {
    const res = await GET(makeRequest("11", { program: "JNV NVS" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    expect(mockGetBatchOverview).toHaveBeenCalledWith("1234", 11, "JNV NVS", undefined);
  });

  it.each(["JNV CoE", "JNV Nodal", "Punjab CoE"])("403s program=%s", async (program) => {
    const res = await GET(makeRequest("11", { program }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(403);
    expect(mockGetBatchOverview).not.toHaveBeenCalled();
  });
});

describe("batch-overview chapter details", () => {
  const chapterTest = {
    session_id: "s1", test_name: "12P24 - Wave Optics - JEE Main", start_date: "2026-10-14",
    student_count: 48, stream_student_count: 48, test_format: "chapter_test", test_stream: "medical",
    test_grade: 12, subjects: ["Physics"], avg_attempt_rate: 45.8, avg_accuracy: 63.1, avg_score: 25.2,
    cms_test_id: "9330", exam: "NEET", chapter: null,
  };
  const fullTest = { ...chapterTest, session_id: "s2", test_format: "major_test", cms_test_id: "14611" };
  const overview = {
    tests: [chapterTest, fullTest], totalEnrolled: 53, enrolledByStream: { medical: 53 }, streams: ["medical"],
  };
  const wave = {
    chapter_code: "12P24", chapter_name: "Wave Optics", subject: "Physics",
    priority_engineering: "High", priority_medical: "Medium", duration_minutes: 60,
  };

  it("adds the CMS chapter, with the stream's priority, to chapter tests only", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetBatchOverview.mockResolvedValue(overview);
    mockChapters.mockResolvedValue(new Map([["9330", wave]]));

    const body = await (await GET(makeRequest("12", { program: "EMRS CoE" }), routeParams({ udise: "1234" }))).json();
    expect(mockChapters).toHaveBeenCalledWith(["9330"]);
    expect(body.tests[0].chapter).toEqual({ code: "12P24", name: "Wave Optics", subject: "Physics", priority: "Medium" });
    expect(body.tests[1].chapter).toBeNull();
  });

  it("skips the lookup for JNV NVS", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetBatchOverview.mockResolvedValue(overview);
    const res = await GET(makeRequest("12", { program: "JNV NVS" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    expect(mockChapters).not.toHaveBeenCalled();
  });

  it("keeps the overview when the chapter lookup fails", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetBatchOverview.mockResolvedValue(overview);
    mockChapters.mockRejectedValue(new Error("BQ outage"));
    const res = await GET(makeRequest("12", { program: "EMRS CoE" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    expect((await res.json()).tests[0].chapter).toBeNull();
  });
});
