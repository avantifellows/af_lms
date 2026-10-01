import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { TestDeepDiveData } from "@/types/quiz";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/dynamodb", () => ({
  getTestDeepDiveFromDynamo: vi.fn(),
}));
vi.mock("@/lib/bigquery", () => ({
  getStudentTimeSpentData: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getTestDeepDiveFromDynamo } from "@/lib/dynamodb";
import { getStudentTimeSpentData } from "@/lib/bigquery";
import { GET } from "./route";
import { routeParams } from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGetDeepDive = vi.mocked(getTestDeepDiveFromDynamo);
const mockGetTimeSpent = vi.mocked(getStudentTimeSpentData);

beforeEach(() => {
  vi.resetAllMocks();
});

const SCHOOL = { id: "42", code: "70705", name: "Test School", region: "North" };

function makeRequest(params?: {
  grade?: string;
  sessionId?: string;
  program?: string;
  stream?: string;
}) {
  const url = new URL("http://localhost/api/quiz-analytics/1234/test-deep-dive");
  if (params?.grade !== undefined) url.searchParams.set("grade", params.grade);
  if (params?.sessionId !== undefined) url.searchParams.set("sessionId", params.sessionId);
  if (params?.program !== undefined) url.searchParams.set("program", params.program);
  if (params?.stream !== undefined) url.searchParams.set("stream", params.stream);
  return new Request(url.toString());
}

describe("GET /api/quiz-analytics/[udise]/test-deep-dive", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(
      makeRequest({ grade: "10", sessionId: "s1" }),
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
      makeRequest({ grade: "10", sessionId: "s1" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when grade is missing", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(
      makeRequest({ sessionId: "s1" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "grade and sessionId are required" });
  });

  it("returns 400 when sessionId is missing", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(
      makeRequest({ grade: "10" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "grade and sessionId are required" });
  });

  it("returns 400 when both grade and sessionId are missing", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(
      makeRequest(),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "grade and sessionId are required" });
  });

  it("returns 400 when grade is not a number", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const res = await GET(
      makeRequest({ grade: "abc", sessionId: "s1" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "grade must be an integer" });
  });

  it("returns 404 when no results found", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetDeepDive.mockResolvedValue(null);

    const res = await GET(
      makeRequest({ grade: "10", sessionId: "s1" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "No results available for this test yet. Please check back in a few hours." });
    expect(mockGetDeepDive).toHaveBeenCalledWith("42", "Test School", 10, "s1", undefined, undefined);
  });

  it("returns full TestDeepDiveData on success", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });

    const deepDiveData: TestDeepDiveData = {
      summary: {
        test_name: "Midterm Exam",
        start_date: "2026-01-15",
        students_appeared: 30,
        avg_score: 72.5,
        min_score: 40,
        max_score: 95,
        avg_accuracy: 0.75,
        avg_attempt_rate: 0.9,
      },
      subjects: [
        { subject: "Math", avg_score: 68, avg_accuracy: 0.7, avg_attempt_rate: 0.85, total_questions: 20 },
        { subject: "Science", avg_score: 77, avg_accuracy: 0.8, avg_attempt_rate: 0.95, total_questions: 15 },
      ],
      chapters: [
        { subject: "Math", chapter_name: "Algebra", chapter_id: "chap-algebra", avg_score: 70, accuracy: 0.72, attempt_rate: 0.88, questions: 10, avg_time: 45 },
        { subject: "Science", chapter_name: "Physics", chapter_id: "chap-physics", avg_score: 80, accuracy: 0.82, attempt_rate: 0.96, questions: 8, avg_time: null },
      ],
      students: [
        {
          student_name: "Alice",
          enrollment_user_id: "368592",
          gender: "F",
          category: "SC",
          academic_level: null,
          qualification_status: null,
          marks_scored: 85,
          max_marks: 100,
          percentage: 85,
          accuracy: 0.88,
          attempt_rate: 0.95,
          subject_scores: [
            { subject: "Math", percentage: 80, marks_scored: 16, max_marks: 20, accuracy: 0.82, attempt_rate: 0.9 },
          ],
        },
      ],
    };

    mockGetDeepDive.mockResolvedValue(deepDiveData);

    const res = await GET(
      makeRequest({ grade: "10", sessionId: "sess-123" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.summary.test_name).toBe("Midterm Exam");
    expect(json.summary.students_appeared).toBe(30);
    expect(json.subjects).toHaveLength(2);
    expect(json.chapters).toHaveLength(2);
    expect(json.students).toHaveLength(1);
    expect(json.students[0].student_name).toBe("Alice");
    expect(mockGetDeepDive).toHaveBeenCalledWith("42", "Test School", 10, "sess-123", undefined, undefined);
  });

  it("returns 500 when getTestDeepDiveFromDynamo throws", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetDeepDive.mockRejectedValue(new Error("DynamoDB timeout"));

    const res = await GET(
      makeRequest({ grade: "10", sessionId: "s1" }),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to fetch test deep dive data" });
  });

  describe("JNV NVS time spent", () => {
    function nvsDeepDive(): TestDeepDiveData {
      const subject = (name: string) => ({
        subject: name,
        percentage: 50,
        marks_scored: 10,
        max_marks: 20,
        accuracy: 0.5,
        attempt_rate: 0.8,
      });
      const student = (name: string, id: string | null) => ({
        student_name: name,
        enrollment_user_id: id,
        gender: "F",
        category: "GEN",
        academic_level: null,
        qualification_status: null,
        marks_scored: 20,
        max_marks: 40,
        percentage: 50,
        accuracy: 0.5,
        attempt_rate: 0.8,
        has_quiz_ended: true,
        subject_scores: [subject("Physics"), subject("Chemistry")],
      });
      return {
        summary: {
          test_name: "NVS Mandated Test 1",
          start_date: "2026-08-01",
          students_appeared: 3,
          students_submitted: 3,
          avg_score: 50,
          min_score: 50,
          max_score: 50,
          avg_marks: 20,
          min_marks: 20,
          max_marks: 20,
          total_marks: 40,
          avg_accuracy: 0.5,
          avg_attempt_rate: 0.8,
        },
        subjects: [],
        chapters: [],
        students: [
          student("Asha", "368592"),
          student("Unmatched", "999999"),
          student("No Id", null),
        ],
      };
    }

    it("merges overall and per-subject time onto matching students, null otherwise", async () => {
      mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
      mockGetDeepDive.mockResolvedValue(nvsDeepDive());
      mockGetTimeSpent.mockResolvedValue(
        new Map([
          [
            "368592",
            { overall: 1530, bySection: new Map([["physics", 600], ["chemistry", null]]) },
          ],
        ])
      );

      const res = await GET(
        makeRequest({ grade: "11", sessionId: "s1", program: "JNV NVS", stream: "Engineering" }),
        routeParams({ udise: "1234" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(mockGetTimeSpent).toHaveBeenCalledWith("1234", 11, "s1", "JNV NVS", "engineering");
      const [asha, unmatched, noId] = json.students;
      expect(asha.time_spent_seconds).toBe(1530);
      expect(asha.subject_scores[0].time_spent_seconds).toBe(600);
      expect(asha.subject_scores[1].time_spent_seconds).toBeNull();
      for (const s of [unmatched, noId]) {
        expect(s.time_spent_seconds).toBeNull();
        expect(s.subject_scores[0].time_spent_seconds).toBeNull();
        expect(s.subject_scores[1].time_spent_seconds).toBeNull();
      }
    });

    it("still returns 200 with null times when the BigQuery lookup rejects", async () => {
      mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
      mockGetDeepDive.mockResolvedValue(nvsDeepDive());
      mockGetTimeSpent.mockRejectedValue(new Error("BQ down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await GET(
        makeRequest({ grade: "11", sessionId: "s1", program: "JNV NVS" }),
        routeParams({ udise: "1234" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.students[0].time_spent_seconds).toBeNull();
      expect(json.students[0].subject_scores[0].time_spent_seconds).toBeNull();

      // Logged without any student identifier or name.
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain("368592");
      expect(logged).not.toContain("Asha");
      errorSpy.mockRestore();
    });

    it("still returns 500 when DynamoDB fails", async () => {
      mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
      mockGetDeepDive.mockRejectedValue(new Error("DynamoDB timeout"));
      mockGetTimeSpent.mockResolvedValue(new Map());
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await GET(
        makeRequest({ grade: "11", sessionId: "s1", program: "JNV NVS" }),
        routeParams({ udise: "1234" })
      );
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: "Failed to fetch test deep dive data" });
    });

    it("still returns 404 when DynamoDB has no results", async () => {
      mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
      mockGetDeepDive.mockResolvedValue(null);
      mockGetTimeSpent.mockResolvedValue(new Map());

      const res = await GET(
        makeRequest({ grade: "11", sessionId: "s1", program: "JNV NVS" }),
        routeParams({ udise: "1234" })
      );
      expect(res.status).toBe(404);
    });

    it("never calls the time lookup for a non-NVS program and adds no time values", async () => {
      mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
      mockGetDeepDive.mockResolvedValue(nvsDeepDive());

      const res = await GET(
        makeRequest({ grade: "11", sessionId: "s1", program: "JNV CoE" }),
        routeParams({ udise: "1234" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(mockGetTimeSpent).not.toHaveBeenCalled();
      expect(json.students[0]).not.toHaveProperty("time_spent_seconds");
      expect(json.students[0].subject_scores[0]).not.toHaveProperty("time_spent_seconds");
    });
  });
});
