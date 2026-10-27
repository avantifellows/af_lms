import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/student-support", () => ({
  getScoreJourney: vi.fn(),
  getStudentReport: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getScoreJourney, getStudentReport } from "@/lib/student-support";
import { GET } from "./route";
import { GET as GET_REPORT } from "../student-report/route";
import { PMU_MANAGER_PERMISSION, routeParams } from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockJourney = vi.mocked(getScoreJourney);
const mockReport = vi.mocked(getStudentReport);

const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };

function request(path: string, params: Record<string, string>) {
  const url = new URL(`http://localhost/api/quiz-analytics/1234/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL } as never);
});

describe("GET /api/quiz-analytics/[udise]/student-support", () => {
  it("passes an auth failure through", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(request("student-support", { grade: "12", program: "JNV CoE" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(401);
  });

  it("requires a program, so an NVS-only School can't skip the NVS check", async () => {
    const res = await GET(request("student-support", { grade: "12" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(400);
    expect(mockJourney).not.toHaveBeenCalled();
  });

  it("refuses JNV NVS", async () => {
    const res = await GET(request("student-support", { grade: "12", program: "JNV NVS" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(403);
    expect(mockJourney).not.toHaveBeenCalled();
  });

  it("refuses a PMU role, which is pinned to NVS", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, permission: PMU_MANAGER_PERMISSION } as never);
    const res = await GET(request("student-support", { grade: "12" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(403);
  });

  it("requires an integer grade", async () => {
    const res = await GET(request("student-support", { grade: "x", program: "JNV CoE" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(400);
  });

  it("returns the journey for a physical program, with the stream lowercased", async () => {
    mockJourney.mockResolvedValue({ tests: [], students: [] });
    const res = await GET(
      request("student-support", { grade: "12", program: "JNV CoE", stream: "Engineering" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    expect(mockJourney).toHaveBeenCalledWith("1234", 12, "JNV CoE", "engineering", undefined);
  });

  it("answers 500 when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockJourney.mockRejectedValue(new Error("bq down"));
    const res = await GET(request("student-support", { grade: "12", program: "JNV CoE" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/quiz-analytics/[udise]/student-report", () => {
  it("requires a numeric student id", async () => {
    const res = await GET_REPORT(
      request("student-report", { grade: "12", program: "JNV CoE", student: "abc" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(400);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("refuses JNV NVS", async () => {
    const res = await GET_REPORT(
      request("student-report", { grade: "12", program: "JNV NVS", student: "5" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(403);
  });

  it("answers 404 for a student outside this School and grade", async () => {
    mockReport.mockResolvedValue(null);
    const res = await GET_REPORT(
      request("student-report", { grade: "12", program: "JNV CoE", student: "5" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(404);
    expect(mockReport).toHaveBeenCalledWith("1234", 12, "JNV CoE", "5");
  });

  it("returns the report", async () => {
    mockReport.mockResolvedValue({ student: {} as never, chapters: [], tests: [] });
    const res = await GET_REPORT(
      request("student-report", { grade: "12", program: "JNV CoE", student: "5" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
  });
});
