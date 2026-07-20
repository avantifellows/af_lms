import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/quiz-session-access", () => ({ canAccessQuizSessionSchool: vi.fn() }));
vi.mock("@/lib/teacher-feedback-access", () => ({ authenticateTeacherFeedback: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { NextRequest } from "next/server";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { query } from "@/lib/db";
import { GET } from "./route";

const mockAuth = vi.mocked(authenticateTeacherFeedback);
const mockSchool = vi.mocked(canAccessQuizSessionSchool);
const mockQuery = vi.mocked(query);

const PERMISSION = { email: "pm@avantifellows.org", level: 3 } as never;
const denied = (status: number) => ({
  ok: false as const,
  response: Response.json({ error: "x" }, { status }) as never,
});

function req(code?: string) {
  const url = code
    ? `http://localhost/api/teacher-feedback/cycles?school_code=${code}`
    : "http://localhost/api/teacher-feedback/cycles";
  return new NextRequest(new URL(url));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ ok: true, permission: PERMISSION });
  mockSchool.mockResolvedValue(true);
});

describe("GET /api/teacher-feedback/cycles", () => {
  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(denied(401));
    expect((await GET(req("34054"))).status).toBe(401);
  });

  it("400 when school_code missing", async () => {
    expect((await GET(req())).status).toBe(400);
  });

  it("404 when school not found", async () => {
    mockQuery.mockResolvedValueOnce([] as never);
    expect((await GET(req("99999"))).status).toBe(404);
  });

  it("groups rows into cycles by setup_run_id with per-teacher links", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 408 }] as never) // school
      .mockResolvedValueOnce([
        {
          setup_run_id: "run-1", cycle_label: "Jun 2026", centre_name: "JNV Palghar - CoE",          batch_class_ids: ["EnableStudents_TP_2027_engg_C024"],
          teacher_name: "Manjit Kumar", teacher_order: 2, teacher_id: "AF836",
          session_pk: 6, status: "created",
          start_time: "2026-06-22 00:00:00", end_time: "2026-06-23 00:00:00",
          created_by: "pm@avantifellows.org", inserted_at: "2026-06-22 10:00:00",
        },
        {
          setup_run_id: "run-1", cycle_label: "Jun 2026", centre_name: "JNV Palghar - CoE",          batch_class_ids: ["EnableStudents_TP_2027_engg_C024"],
          teacher_name: "Sanjeet Pal", teacher_order: 1, teacher_id: "AF400",
          session_pk: 5, status: "created",
          start_time: "2026-06-22 00:00:00", end_time: "2026-06-23 00:00:00",
          created_by: "pm@avantifellows.org", inserted_at: "2026-06-22 10:00:00",
        },
      ] as never)
      .mockResolvedValueOnce([
        { batch_id: "EnableStudents_TP_2027_engg_C024", name: "CoE JNV Palghar 2027 Engineering" },
      ] as never) // batch name resolution
      .mockResolvedValueOnce([
        // session rows (links filled by the Lambda). id is a STRING here on
        // purpose: session.id is a bigint, which node-pg returns as a string,
        // while lms_teacher_feedback.session_pk is an integer (number). The route
        // must coerce to match — this guards that key-type regression.
        { id: "5", platform_id: "quiz_s", portal_link: "https://staging-auth.avantifellows.org/?sessionId=EnableStudents_quiz_s", meta_data: { admin_testing_link: "https://staging-quiz/form/quiz_s" } },
        { id: "6", platform_id: "quiz_m", portal_link: "https://staging-auth.avantifellows.org/?sessionId=EnableStudents_quiz_m", meta_data: {} },
      ] as never);

    const res = await GET(req("34054"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cycles).toHaveLength(1);
    const cycle = json.cycles[0];
    expect(cycle.setupRunId).toBe("run-1");
    expect(cycle.cycleLabel).toBe("Jun 2026");
    expect(cycle.batchClassNames).toEqual(["CoE JNV Palghar 2027 Engineering"]);
    expect(cycle.teachers).toHaveLength(2);
    // sorted by teacher_order; links resolved from the session row by session_pk
    expect(cycle.teachers[0].teacherName).toBe("Sanjeet Pal");
    expect(cycle.teachers[0].quizId).toBe("quiz_s");
    expect(cycle.teachers[0].portalLink).toContain("?sessionId=EnableStudents_quiz_s");
    expect(cycle.teachers[0].adminTestingLink).toContain("/form/quiz_s");
  });

  it("returns empty cycles when none exist", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 408 }] as never)
      .mockResolvedValueOnce([] as never);
    const json = await (await GET(req("34054"))).json();
    expect(json.cycles).toEqual([]);
  });
});
