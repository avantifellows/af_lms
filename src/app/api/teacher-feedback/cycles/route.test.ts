import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/quiz-session-access", () => ({ canAccessQuizSessionSchool: vi.fn() }));
vi.mock("@/lib/teacher-feedback-access", () => ({ requireTeacherFeedbackAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { requireTeacherFeedbackAccess } from "@/lib/teacher-feedback-access";
import { query } from "@/lib/db";
import { GET } from "./route";
import { PM_SESSION, NO_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockRequire = vi.mocked(requireTeacherFeedbackAccess);
const mockSchool = vi.mocked(canAccessQuizSessionSchool);
const mockQuery = vi.mocked(query);

const PERMISSION = { email: "pm@avantifellows.org", level: 3 } as never;

function req(code?: string) {
  const url = code
    ? `http://localhost/api/teacher-feedback/cycles?school_code=${code}`
    : "http://localhost/api/teacher-feedback/cycles";
  return new NextRequest(new URL(url));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSession.mockResolvedValue(PM_SESSION);
  mockRequire.mockResolvedValue({ ok: true, permission: PERMISSION });
  mockSchool.mockResolvedValue(true);
});

describe("GET /api/teacher-feedback/cycles", () => {
  it("401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
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
          setup_run_id: "run-1", cycle_label: "Jun 2026", batch_parent_id: "EN-TP-2027-engg-C01",
          batch_class_ids: ["EnableStudents_TP_2027_engg_C024"], grade: 11,
          teacher_name: "Manjit Kumar", teacher_order: 2, teacher_id: "AF836",
          quiz_id: "quiz_m", session_id: "EnableStudents_quiz_m", status: "created",
          start_time: "2026-06-22 00:00:00", end_time: "2026-06-23 00:00:00",
          created_by: "pm@avantifellows.org", inserted_at: "2026-06-22 10:00:00",
        },
        {
          setup_run_id: "run-1", cycle_label: "Jun 2026", batch_parent_id: "EN-TP-2027-engg-C01",
          batch_class_ids: ["EnableStudents_TP_2027_engg_C024"], grade: 11,
          teacher_name: "Sanjeet Pal", teacher_order: 1, teacher_id: "AF400",
          quiz_id: "quiz_s", session_id: "EnableStudents_quiz_s", status: "created",
          start_time: "2026-06-22 00:00:00", end_time: "2026-06-23 00:00:00",
          created_by: "pm@avantifellows.org", inserted_at: "2026-06-22 10:00:00",
        },
      ] as never);

    const res = await GET(req("34054"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cycles).toHaveLength(1);
    const cycle = json.cycles[0];
    expect(cycle.setupRunId).toBe("run-1");
    expect(cycle.cycleLabel).toBe("Jun 2026");
    expect(cycle.teachers).toHaveLength(2);
    // sorted by teacher_order
    expect(cycle.teachers[0].teacherName).toBe("Sanjeet Pal");
    expect(cycle.teachers[0].portalLink).toContain("?sessionId=EnableStudents_quiz_s");
  });

  it("returns empty cycles when none exist", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 408 }] as never)
      .mockResolvedValueOnce([] as never);
    const json = await (await GET(req("34054"))).json();
    expect(json.cycles).toEqual([]);
  });
});
