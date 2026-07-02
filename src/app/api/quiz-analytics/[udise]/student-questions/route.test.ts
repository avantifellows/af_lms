import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/bigquery", () => ({
  getStudentQuestionLevelData: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getStudentQuestionLevelData } from "@/lib/bigquery";
import { GET } from "./route";
import { routeParams } from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGet = vi.mocked(getStudentQuestionLevelData);

const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/quiz-analytics/[udise]/student-questions", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/student-questions?grade=12&sessionId=s1"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when grade is missing", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/student-questions?sessionId=s1"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when sessionId is missing", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/student-questions?grade=12"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when grade is not an integer", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/student-questions?grade=abc&sessionId=s1"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(400);
  });

  it("returns questions on success and passes program + lowercased stream", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGet.mockResolvedValue([
      {
        enrollment_user_id: "368592",
        chapter_id: "c-kin",
        chapter_name: "Kinematics",
        question_id: "q1",
        position_index: 0,
        status: "correct",
      },
    ]);

    const res = await GET(
      new Request(
        "http://localhost/api/quiz-analytics/1234/student-questions?grade=12&sessionId=s1&program=JNV+CoE&stream=PCM"
      ),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].status).toBe("correct");
    expect(mockGet).toHaveBeenCalledWith("1234", 12, "s1", "JNV CoE", "pcm");
  });

  it("returns 500 when the helper throws", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGet.mockRejectedValue(new Error("BQ outage"));

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/student-questions?grade=12&sessionId=s1"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(500);
  });
});
