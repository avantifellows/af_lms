import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/bigquery", () => ({
  getAvailableGrades: vi.fn(),
  getAvailablePrograms: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getAvailableGrades, getAvailablePrograms } from "@/lib/bigquery";
import { GET } from "./route";
import { routeParams } from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGetGrades = vi.mocked(getAvailableGrades);
const mockGetPrograms = vi.mocked(getAvailablePrograms);

beforeEach(() => {
  vi.resetAllMocks();
  mockGetPrograms.mockResolvedValue([]);
});

const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };

describe("GET /api/quiz-analytics/[udise]/grades", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when access is denied", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Access denied" });
  });

  it("returns 404 when school not found", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "School not found" }, { status: 404 }),
    });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/9999/grades"),
      routeParams({ udise: "9999" })
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "School not found" });
  });

  it("returns grades and programs on success", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetGrades.mockResolvedValue([9, 10, 11]);
    mockGetPrograms.mockResolvedValue(["JNV CoE", "JNV Nodal"]);

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      grades: [9, 10, 11],
      programs: ["JNV CoE", "JNV Nodal"],
    });
    expect(mockGetGrades).toHaveBeenCalledWith("1234", undefined);
    expect(mockGetPrograms).toHaveBeenCalledWith("1234");
  });

  it("passes program param to getAvailableGrades", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetGrades.mockResolvedValue([10]);
    mockGetPrograms.mockResolvedValue(["JNV CoE"]);

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades?program=JNV+CoE"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    expect(mockGetGrades).toHaveBeenCalledWith("1234", "JNV CoE");
  });

  it("returns empty grades array when none exist", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetGrades.mockResolvedValue([]);
    mockGetPrograms.mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ grades: [], programs: [] });
  });
});
