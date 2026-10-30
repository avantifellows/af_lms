import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/student-support-notes", () => ({
  getMentorNoteCounts: vi.fn(),
  getMentorNotes: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getSession } from "@/lib/session";
import { getMentorNoteCounts, getMentorNotes } from "@/lib/student-support-notes";
import { GET } from "./route";
import { getRequest, routeParams } from "../../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockSession = vi.mocked(getSession);
const mockCounts = vi.mocked(getMentorNoteCounts);
const mockNotes = vi.mocked(getMentorNotes);

const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };
const SESSION = { user: { email: "t@avantifellows.org" } } as never;

const request = (params: Record<string, string>) =>
  getRequest("http://localhost/api/quiz-analytics/1234/student-support/notes", params);

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL } as never);
  mockSession.mockResolvedValue(SESSION);
});

describe("GET /api/quiz-analytics/[udise]/student-support/notes", () => {
  it("passes an auth failure through", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(request({ grade: "12", program: "JNV CoE" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(401);
    expect(mockCounts).not.toHaveBeenCalled();
  });

  it("refuses JNV NVS", async () => {
    const res = await GET(request({ grade: "12", program: "JNV NVS" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(403);
  });

  it("returns the grade's counts for the School's code", async () => {
    mockCounts.mockResolvedValue({ "101": 2 });
    const res = await GET(request({ grade: "12", program: "JNV CoE" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ counts: { "101": 2 } });
    expect(mockCounts).toHaveBeenCalledWith(SESSION, "70705", "JNV CoE", 12);
  });

  it("refuses a program outside the caller's programs", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, permission: { role: "teacher", program_ids: [1] } } as never);
    const res = await GET(request({ grade: "12", program: "Punjab CoE" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(403);
    expect(mockCounts).not.toHaveBeenCalled();
  });

  it("requires a numeric student id", async () => {
    const res = await GET(request({ grade: "12", program: "JNV CoE", student: "x" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(400);
  });

  it("answers 404 when the viewer may not read the student's notes", async () => {
    mockNotes.mockResolvedValue(null);
    const res = await GET(request({ grade: "12", program: "JNV CoE", student: "101" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(404);
    expect(mockNotes).toHaveBeenCalledWith(SESSION, "70705", "JNV CoE", "101");
  });

  it("returns the student's interactions", async () => {
    mockNotes.mockResolvedValue([{ title: "Phase 1", date: null, mentor: null, answers: [] }]);
    const res = await GET(request({ grade: "12", program: "JNV CoE", student: "101" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(200);
    expect((await res.json()).interactions).toHaveLength(1);
  });

  it("answers 500 when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockCounts.mockRejectedValue(new Error("pg down"));
    const res = await GET(request({ grade: "12", program: "JNV CoE" }), routeParams({ udise: "1234" }));
    expect(res.status).toBe(500);
  });
});
