import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ canAccessSchool: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/bigquery", () => ({
  getQuizResults: vi.fn(),
  getQuizSubjectResults: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { canAccessSchool } from "@/lib/permissions";
import { query } from "@/lib/db";
import { getQuizResults, getQuizSubjectResults } from "@/lib/bigquery";
import { POST } from "./route";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
  ADMIN_SESSION,
  PASSCODE_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockCanAccess = vi.mocked(canAccessSchool);
const mockQuery = vi.mocked(query);
const mockGetQuizResults = vi.mocked(getQuizResults);
const mockGetSubjectResults = vi.mocked(getQuizSubjectResults);

const params = routeParams({ udise: "1234567890" });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/quiz-analytics/[udise]", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/quiz-analytics/1234567890", {
      method: "POST",
      body: { quizId: "Q1" },
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(401);
  });

  it("returns 400 when quizId is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const req = jsonRequest("http://localhost/api/quiz-analytics/1234567890", {
      method: "POST",
      body: {},
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(400);
  });

  it("returns 404 when school not found", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([]);
    const req = jsonRequest("http://localhost/api/quiz-analytics/1234567890", {
      method: "POST",
      body: { quizId: "Q1" },
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(404);
  });

  it("returns 403 for passcode user with wrong school", async () => {
    mockSession.mockResolvedValue({ ...PASSCODE_SESSION, schoolCode: "99999" });
    mockQuery.mockResolvedValue([{ id: "1", code: "70705", region: "North" }]);

    const req = jsonRequest("http://localhost/api/quiz-analytics/1234567890", {
      method: "POST",
      body: { quizId: "Q1" },
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 403 when email user lacks school access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([{ id: "1", code: "70705", region: "North" }]);
    mockCanAccess.mockResolvedValue(false);

    const req = jsonRequest("http://localhost/api/quiz-analytics/1234567890", {
      method: "POST",
      body: { quizId: "Q1" },
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns null summary when no results found", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([{ id: "1", code: "70705", region: "North" }]);
    mockCanAccess.mockResolvedValue(true);
    mockGetQuizResults.mockResolvedValue([]);
    mockGetSubjectResults.mockResolvedValue([]);

    const req = jsonRequest("http://localhost/api/quiz-analytics/1234567890", {
      method: "POST",
      body: { quizId: "Q1" },
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary).toBeNull();
  });

  it("returns full summary with score distribution", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([{ id: "1", code: "70705", region: "North" }]);
    mockCanAccess.mockResolvedValue(true);

    const overallResults = [
      {
        student_full_name: "Student A",
        attendance_status: "Present",
        total_marks_obtained: 80,
        total_marks: 100,
        percentage_score: 80,
      },
      {
        student_full_name: "Student B",
        attendance_status: "Present",
        total_marks_obtained: 40,
        total_marks: 100,
        percentage_score: 40,
      },
      {
        student_full_name: "Student C",
        attendance_status: "Absent",
        total_marks_obtained: null,
        total_marks: null,
        percentage_score: null,
      },
    ];
    const subjectResults = [
      { subject_name: "Physics", subject_marks_obtained: 30, subject_total_marks: 50 },
      { subject_name: "Physics", subject_marks_obtained: 20, subject_total_marks: 50 },
      { subject_name: "Chemistry", subject_marks_obtained: 40, subject_total_marks: 50 },
    ];

    mockGetQuizResults.mockResolvedValue(overallResults as never);
    mockGetSubjectResults.mockResolvedValue(subjectResults as never);

    const req = jsonRequest("http://localhost/api/quiz-analytics/1234567890", {
      method: "POST",
      body: { quizId: "Q1" },
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary.total_students).toBe(3);
    expect(json.summary.present_count).toBe(2);
    expect(json.summary.absent_count).toBe(1);
    expect(json.summary.score_distribution).toHaveLength(5);
    expect(json.summary.subject_scores).toHaveLength(2);
    expect(json.summary.student_results).toHaveLength(3);
    // Student A (80%) should be first, Student B (40%) second
    expect(json.summary.student_results[0].student_name).toBe("Student A");
  });

  it("allows passcode user with matching school code", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);
    mockQuery.mockResolvedValue([{ id: "1", code: "70705", region: "North" }]);
    mockGetQuizResults.mockResolvedValue([]);
    mockGetSubjectResults.mockResolvedValue([]);

    const req = jsonRequest("http://localhost/api/quiz-analytics/1234567890", {
      method: "POST",
      body: { quizId: "Q1" },
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(200);
  });

  it("returns 500 on BigQuery error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([{ id: "1", code: "70705", region: "North" }]);
    mockCanAccess.mockResolvedValue(true);
    mockGetQuizResults.mockRejectedValue(new Error("BQ error"));
    mockGetSubjectResults.mockRejectedValue(new Error("BQ error"));

    const req = jsonRequest("http://localhost/api/quiz-analytics/1234567890", {
      method: "POST",
      body: { quizId: "Q1" },
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(500);
  });
});
