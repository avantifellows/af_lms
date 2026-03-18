import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/bigquery", () => ({
  getBatchOverviewData: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getBatchOverviewData } from "@/lib/bigquery";
import { GET } from "./route";
import { routeParams } from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGetBatchOverview = vi.mocked(getBatchOverviewData);

beforeEach(() => {
  vi.resetAllMocks();
});

const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };

function makeRequest(grade?: string) {
  const url = new URL("http://localhost/api/quiz-analytics/1234/batch-overview");
  if (grade !== undefined) url.searchParams.set("grade", grade);
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
    await expect(res.json()).resolves.toEqual({ error: "grade must be a number" });
  });

  it("computes summary correctly (tests_conducted, avg_participation)", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetBatchOverview.mockResolvedValue({
      tests: [
        { session_id: "s1", test_name: "Test 1", start_date: "2026-01-10", student_count: 20, test_format: "chapter" },
        { session_id: "s2", test_name: "Test 2", start_date: "2026-01-20", student_count: 30, test_format: "full" },
        { session_id: "s3", test_name: "Test 3", start_date: "2026-02-01", student_count: 25, test_format: null },
      ],
      totalEnrolled: 40,
    });

    const res = await GET(makeRequest("10"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.summary.tests_conducted).toBe(3);
    // avg_participation = Math.round((20 + 30 + 25) / 3) = Math.round(25) = 25
    expect(json.summary.avg_participation).toBe(25);
    expect(json.tests).toHaveLength(3);
    expect(json.totalEnrolled).toBe(40);
    expect(mockGetBatchOverview).toHaveBeenCalledWith("1234", 10);
  });

  it("returns zero avg_participation when no tests", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetBatchOverview.mockResolvedValue({
      tests: [],
      totalEnrolled: 40,
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
      { session_id: "s1", test_name: "Midterm", start_date: "2026-01-15", student_count: 35, test_format: "full" },
    ];
    mockGetBatchOverview.mockResolvedValue({ tests, totalEnrolled: 50 });

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
