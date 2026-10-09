import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/quiz-session-access", () => ({ canAccessQuizSessionSchool: vi.fn() }));
vi.mock("@/lib/teacher-feedback-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teacher-feedback-access")>();
  // requireCentreScope stays real: it is a pure permission check, and stubbing it
  // would make these suites pass regardless of whether the routes enforce it.
  return { ...actual, authenticateTeacherFeedback: vi.fn() };
});
vi.mock("@/lib/teacher-feedback-bq", () => ({
  buildTeacherFeedbackReport: vi.fn(),
  fetchFeedbackRows: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/teacher-feedback-history", () => ({
  getGenders: vi.fn(),
  getRoundContext: vi.fn(),
  getTeacherRounds: vi.fn(),
  scoreRounds: vi.fn(),
}));

import { NextRequest } from "next/server";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { buildTeacherFeedbackReport, fetchFeedbackRows } from "@/lib/teacher-feedback-bq";
import { query } from "@/lib/db";
import { getGenders, getRoundContext, getTeacherRounds, scoreRounds } from "@/lib/teacher-feedback-history";
import { GET } from "./route";

const mockAuth = vi.mocked(authenticateTeacherFeedback);
const mockSchool = vi.mocked(canAccessQuizSessionSchool);
const mockReport = vi.mocked(buildTeacherFeedbackReport);
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

function baseReport() {
  return {
    quizId: "quiz_x",
    responseCount: 2,
    totalScore: 12,
    maxTotalScore: 28,
    percentage: 42.86,
    parameters: [
      { parameter: "Planning", score: 3, maxScore: 4, percentage: 75, answeredBy: 2, questions: [] },
    ],
    comments: [{ role: "liked" as const, text: "friendly" }],
    nothingCounts: { liked: 0, improve: 0 },
    byGender: {},
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

  it("returns the report with its round and the teacher's history", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        school_code: "34054",
        teacher_name: "Manjit Kumar",
        teacher_id: "42",
        school_id: 5,
        centre_id: null,
        summary: { liked: [{ text: "Clear", students: 9 }], improve: [] },
        summary_generated_at: "2026-09-19 03:00:00",
        closed: true,
      },
    ]);
    mockReport.mockResolvedValue(baseReport());
    vi.mocked(getRoundContext).mockResolvedValue({ cycleLabel: "Sep 2026", batchNames: ["2027 Engg"] } as never);
    vi.mocked(getTeacherRounds).mockResolvedValue([{ quizId: "q0" }, { quizId: "q1" }] as never);
    const rows = new Map([["q1", ["row"]]]);
    vi.mocked(fetchFeedbackRows).mockResolvedValue(rows as never);
    vi.mocked(scoreRounds).mockReturnValue([{ cycleLabel: "Aug 2026", percentage: 60 }] as never);

    const res = await GET(req("q1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teacherName).toBe("Manjit Kumar");
    expect(body.parameters[0].answeredBy).toBe(2);
    expect(body.percentage).toBe(42.86);
    expect(body.round).toEqual({ cycleLabel: "Sep 2026", batchNames: ["2027 Engg"] });
    expect(body.history).toEqual([{ cycleLabel: "Aug 2026", percentage: 60 }]);
    expect(body.summary).toEqual({ liked: [{ text: "Clear", students: 9 }], improve: [] });
    expect(body.summaryGeneratedAt).toBe("2026-09-19 03:00:00");
    expect(body.roundClosed).toBe(true);
    // One BigQuery scan covers the report and the teacher's other rounds.
    expect(fetchFeedbackRows).toHaveBeenCalledTimes(1);
    expect(fetchFeedbackRows).toHaveBeenCalledWith(["q1", "q0"]);
    expect(mockReport).toHaveBeenCalledWith("q1", ["row"], getGenders);
    expect(scoreRounds).toHaveBeenCalledWith([{ quizId: "q0" }, { quizId: "q1" }], rows);
    expect(getTeacherRounds).toHaveBeenCalledWith({
      schoolCode: "34054",
      centreId: null,
      teacherId: "42",
      teacherName: "Manjit Kumar",
    });
  });

  it("500 when the report computation throws", async () => {
    mockQuery.mockResolvedValueOnce([
      { school_code: "34054", teacher_name: "Manjit Kumar", school_id: 5 },
    ]);
    vi.mocked(getTeacherRounds).mockResolvedValue([]);
    vi.mocked(fetchFeedbackRows).mockRejectedValue(new Error("BQ down"));
    expect((await GET(req("q1"))).status).toBe(500);
  });

  it("403 when the caller is confined to a different centre", async () => {
    mockAuth.mockResolvedValue({
      ok: true,
      permission: { email: "pm@avantifellows.org", level: 1, scope: { centres: new Set([99]) } } as never,
    });
    mockQuery.mockResolvedValueOnce([
      { school_code: "34054", teacher_name: "Manjit Kumar", teacher_id: "42", school_id: 5, centre_id: "7" },
    ]);

    expect((await GET(req("q1"))).status).toBe(403);
    expect(fetchFeedbackRows).not.toHaveBeenCalled();
  });
});
