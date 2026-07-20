import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/quiz-session-access", () => ({ canAccessQuizSessionSchool: vi.fn() }));
vi.mock("@/lib/teacher-feedback-access", () => ({ authenticateTeacherFeedback: vi.fn() }));
vi.mock("@/lib/teacher-feedback-bq", () => ({ getTeacherFeedbackReport: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { NextRequest } from "next/server";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { getTeacherFeedbackReport } from "@/lib/teacher-feedback-bq";
import { query } from "@/lib/db";
import { GET } from "./route";

const mockAuth = vi.mocked(authenticateTeacherFeedback);
const mockSchool = vi.mocked(canAccessQuizSessionSchool);
const mockReport = vi.mocked(getTeacherFeedbackReport);
const mockQuery = vi.mocked(query);

const PERMISSION = { email: "pm@avantifellows.org", level: 3 } as never;
const denied = (status: number) => ({
  ok: false as const,
  response: Response.json({ error: "x" }, { status }) as never,
});

function req(quizId?: string) {
  const url = quizId
    ? `http://localhost/api/teacher-feedback/report?quiz_id=${quizId}`
    : "http://localhost/api/teacher-feedback/report";
  return new NextRequest(new URL(url));
}

function baseReport(batches: { batch: string; batchName: string; responseCount: number }[]) {
  return {
    quizId: "quiz_x",
    responseCount: 2,
    totalScore: 12,
    maxTotalScore: 28,
    percentage: 42.86,
    parameters: [{ parameter: "Planning", score: 3, maxScore: 4, answeredBy: 2 }],
    comments: [{ role: "liked" as const, text: "friendly" }],
    batches,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ ok: true, permission: PERMISSION });
  mockSchool.mockResolvedValue(true);
});

describe("GET /api/teacher-feedback/report", () => {
  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(denied(401));
    expect((await GET(req("q1"))).status).toBe(401);
  });

  it("403 when lacking view access", async () => {
    mockAuth.mockResolvedValue(denied(403));
    expect((await GET(req("q1"))).status).toBe(403);
  });

  it("400 when quiz_id is missing", async () => {
    expect((await GET(req())).status).toBe(400);
  });

  it("404 when no feedback quiz matches", async () => {
    mockQuery.mockResolvedValueOnce([]); // session/teacher lookup -> empty
    const res = await GET(req("q1"));
    expect(res.status).toBe(404);
  });

  it("403 when the PM can't access the quiz's school", async () => {
    mockQuery.mockResolvedValueOnce([
      { school_code: "34054", teacher_name: "Manjit Kumar", school_id: 5 },
    ]);
    mockSchool.mockResolvedValue(false);
    expect((await GET(req("q1"))).status).toBe(403);
  });

  it("returns the report and resolves batch_id -> readable name", async () => {
    // 1st query: session/teacher lookup. 2nd query: batch names.
    mockQuery
      .mockResolvedValueOnce([
        { school_code: "34054", teacher_name: "Manjit Kumar", school_id: 5 },
      ])
      .mockResolvedValueOnce([
        { batch_id: "EnableStudents_11_25_Engg_C16", name: "CoE JNV Palghar G11 Engineering" },
      ]);
    mockReport.mockResolvedValue(
      baseReport([
        { batch: "EnableStudents_11_25_Engg_C16", batchName: "EnableStudents_11_25_Engg_C16", responseCount: 2 },
      ])
    );

    const res = await GET(req("q1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teacherName).toBe("Manjit Kumar");
    expect(body.batches[0].batchName).toBe("CoE JNV Palghar G11 Engineering");
    expect(body.parameters[0].answeredBy).toBe(2);
  });

  it("falls back to the batch_id when no name is found", async () => {
    mockQuery
      .mockResolvedValueOnce([
        { school_code: "34054", teacher_name: "Manjit Kumar", school_id: 5 },
      ])
      .mockResolvedValueOnce([]); // no batch name rows
    mockReport.mockResolvedValue(
      baseReport([{ batch: "UNKNOWN_BATCH", batchName: "UNKNOWN_BATCH", responseCount: 1 }])
    );

    const res = await GET(req("q1"));
    const body = await res.json();
    expect(body.batches[0].batchName).toBe("UNKNOWN_BATCH");
  });

  it("skips the name lookup when there are no batches", async () => {
    mockQuery.mockResolvedValueOnce([
      { school_code: "34054", teacher_name: "Manjit Kumar", school_id: 5 },
    ]);
    mockReport.mockResolvedValue(baseReport([]));

    const res = await GET(req("q1"));
    expect(res.status).toBe(200);
    // Only the session/teacher lookup ran — no second (batch-name) query.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("500 when the report computation throws", async () => {
    mockQuery.mockResolvedValueOnce([
      { school_code: "34054", teacher_name: "Manjit Kumar", school_id: 5 },
    ]);
    mockReport.mockRejectedValue(new Error("BQ down"));
    expect((await GET(req("q1"))).status).toBe(500);
  });
});
