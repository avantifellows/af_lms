import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/bigquery", () => ({
  getCumulativeALData: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getCumulativeALData } from "@/lib/bigquery";
import { GET } from "./route";
import {
  PMU_GOVT_PERMISSION,
  PMU_MANAGER_PERMISSION,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGet = vi.mocked(getCumulativeALData);

beforeEach(() => {
  vi.resetAllMocks();
});

const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };

function makeRequest(grade?: string, extra: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/quiz-analytics/1234/cumulative-als");
  if (grade !== undefined) url.searchParams.set("grade", grade);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

describe("GET /api/quiz-analytics/[udise]/cumulative-als", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(makeRequest("11"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when grade is missing", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(makeRequest(), routeParams({ udise: "1234" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "grade is required" });
  });

  it("returns 400 when grade is not an integer", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(makeRequest("abc"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(400);
  });

  it("forwards stream and program (lowercased stream) to BQ helper", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGet.mockResolvedValue({ students: [], tests: [] });

    await GET(
      makeRequest("12", { stream: "PCM", program: "JNV" }),
      routeParams({ udise: "1234" })
    );
    // 5th arg (testGrade) is undefined when the param is absent.
    expect(mockGet).toHaveBeenCalledWith("1234", 12, "JNV", "pcm", undefined);
  });

  it("forwards the testGrade param to the BQ helper", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGet.mockResolvedValue({ students: [], tests: [] });

    await GET(
      makeRequest("12", { testGrade: "11" }),
      routeParams({ udise: "1234" })
    );
    expect(mockGet).toHaveBeenCalledWith("1234", 12, undefined, undefined, 11);
  });

  it("returns the BQ helper's {students, tests} payload directly", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    const payload = {
      students: [
        {
          student_id: "s1",
          student_name: "Asha",
          stream: "PCM",
          total_major_tests: 2,
          academic_level: "M1",
          progression: [
            { session_id: "t1", academic_level: "M2", marks_scored: 120, max_marks_possible: 300 },
            { session_id: "t2", academic_level: "M1", marks_scored: 210, max_marks_possible: 300 },
          ],
        },
      ],
      tests: [
        { session_id: "t1", test_name: "T1", start_date: "2025-01-10", stream: "pcm" },
        { session_id: "t2", test_name: "T2", start_date: "2025-02-10", stream: "pcm" },
      ],
    };
    mockGet.mockResolvedValue(payload);

    const res = await GET(makeRequest("11"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(payload);
  });

  it("returns 500 when BQ helper throws", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGet.mockRejectedValue(new Error("BQ failed"));

    const res = await GET(makeRequest("11"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(500);
  });
});

// PMU roles are pinned to JNV NVS (ADR 0007): a missing program becomes
// "JNV NVS", any other program is refused before any data is read.
describe.each([
  ["PMU Manager", PMU_MANAGER_PERMISSION],
  ["PMU Govt School User", PMU_GOVT_PERMISSION],
])("GET cumulative-als as %s", (_label, permission) => {
  function pmuRequest(program?: string) {
    const url = new URL("http://localhost/api/quiz-analytics/1234/cumulative-als");
    url.searchParams.set("grade", "11");
    url.searchParams.set("sessionId", "s1");
    if (program !== undefined) url.searchParams.set("program", program);
    return new Request(url.toString());
  }

  beforeEach(() => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: false, permission });
    mockGet.mockResolvedValue([] as never);
  });

  it("serves JNV NVS data when no program is given", async () => {
    const res = await GET(pmuRequest(), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith("1234", 11, "JNV NVS", undefined, undefined);
  });

  it("serves program=JNV NVS", async () => {
    const res = await GET(pmuRequest("JNV NVS"), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith("1234", 11, "JNV NVS", undefined, undefined);
  });

  it.each(["JNV CoE", "JNV Nodal", "Punjab CoE"])("403s program=%s", async (program) => {
    const res = await GET(pmuRequest(program), routeParams({ udise: "1234" }));
    expect(res.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
