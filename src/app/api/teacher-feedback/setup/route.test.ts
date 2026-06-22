import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/quiz-session-access", () => ({
  canAccessQuizSessionBatches: vi.fn(),
}));
vi.mock("@/lib/teacher-feedback-access", () => ({
  requireTeacherFeedbackAccess: vi.fn(),
}));
vi.mock("@/lib/quiz-backend", () => ({ createFormQuiz: vi.fn() }));
vi.mock("@/lib/teacher-feedback-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teacher-feedback-session")>();
  return {
    ...actual,
    createFeedbackSession: vi.fn(),
  };
});
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { canAccessQuizSessionBatches } from "@/lib/quiz-session-access";
import { requireTeacherFeedbackAccess } from "@/lib/teacher-feedback-access";
import { createFormQuiz } from "@/lib/quiz-backend";
import { createFeedbackSession } from "@/lib/teacher-feedback-session";
import { query } from "@/lib/db";
import { POST } from "./route";
import { jsonRequest, PM_SESSION, NO_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockRequire = vi.mocked(requireTeacherFeedbackAccess);
const mockBatches = vi.mocked(canAccessQuizSessionBatches);
const mockCreateQuiz = vi.mocked(createFormQuiz);
const mockCreateSession = vi.mocked(createFeedbackSession);
const mockQuery = vi.mocked(query);

const PERMISSION = { email: "pm@avantifellows.org", level: 3 } as never;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    schoolCode: "14030",
    parentBatchId: "EnableStudents_11_Photon_Eng_24_E001",
    classBatchIds: ["EnableStudents_11_Photon_Eng_24_E001_A"],
    grade: 11,
    teachers: [
      { id: "1", name: "Manjit Kumar", order: 1 },
      { id: "2", name: "Sanjeet Pal", order: 2 },
    ],
    ...overrides,
  };
}

function req(body: unknown) {
  return jsonRequest("http://localhost/api/teacher-feedback/setup", {
    method: "POST",
    body,
  }) as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSession.mockResolvedValue(PM_SESSION);
  mockRequire.mockResolvedValue({ ok: true, permission: PERMISSION });
  mockBatches.mockResolvedValue(true);
  // ownership check (EXISTS) -> true; subsequent inserts -> []
  mockQuery.mockResolvedValue([{ ok: true }] as never);
  mockCreateQuiz.mockImplementation(async () => ({ id: `quiz_${Math.random().toString(36).slice(2, 8)}` }));
  mockCreateSession.mockImplementation(async (p) => ({
    sessionPk: 100 + p.feedback.teacherOrder,
    sessionId: `${p.group}_${p.quizId}`,
    portalLink: `https://auth.avantifellows.org/?sessionId=${p.group}_${p.quizId}`,
  }));
});

describe("POST /api/teacher-feedback/setup", () => {
  it("401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });

  it("403 when lacking quiz-session edit access", async () => {
    mockRequire.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }) as never,
    });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(403);
  });

  it("400 on missing/invalid fields", async () => {
    expect((await POST(req(validBody({ schoolCode: "" })))).status).toBe(400);
    expect((await POST(req(validBody({ classBatchIds: [] })))).status).toBe(400);
    expect((await POST(req(validBody({ grade: 9 })))).status).toBe(400);
    expect((await POST(req(validBody({ teachers: [] })))).status).toBe(400);
  });

  it("403 when the PM can't access the batches", async () => {
    mockBatches.mockResolvedValue(false);
    const res = await POST(req(validBody()));
    expect(res.status).toBe(403);
  });

  it("400 when the batch doesn't belong to the school", async () => {
    mockQuery.mockResolvedValueOnce([{ ok: false }] as never); // ownership EXISTS -> false
    const res = await POST(req(validBody()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/does not belong/);
  });

  it("creates a quiz + session per teacher and returns 201 with per-teacher results", async () => {
    const res = await POST(req(validBody()));
    expect(res.status).toBe(201);
    const json = await res.json();

    expect(json.createdCount).toBe(2);
    expect(json.failedCount).toBe(0);
    expect(json.cycleLabel).toMatch(/^\w{3} \d{4}$/);
    expect(json.sourceId).toMatch(/^teacher-feedback:v2:14030:\d{4}-\d{2}$/);
    expect(json.group).toBe("EnableStudents");
    expect(json.teachers).toHaveLength(2);
    expect(json.teachers.every((t: { status: string }) => t.status === "created")).toBe(true);

    expect(mockCreateQuiz).toHaveBeenCalledTimes(2);
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    // 1 ownership SELECT + 2 inserts
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("chains last->first: the last teacher gets Finish, earlier teachers point at the next session", async () => {
    await POST(req(validBody()));

    // createFormQuiz is called last-teacher-first. First call = order 2 (last) => Finish + empty next.
    const firstCallArg = mockCreateQuiz.mock.calls[0][0] as { metadata: Record<string, string> };
    expect(firstCallArg.metadata.next_step_text).toBe("Finish");
    expect(firstCallArg.metadata.next_step_url).toBe("");

    // Second call = order 1, should chain into order 2's portal link.
    const secondCallArg = mockCreateQuiz.mock.calls[1][0] as { metadata: Record<string, string> };
    expect(secondCallArg.metadata.next_step_text).toBe("Continue to next teacher feedback");
    expect(secondCallArg.metadata.next_step_url).toContain("?sessionId=EnableStudents_");
  });

  it("partial failure: 207 with one failed teacher, still records a failed row", async () => {
    // Last teacher (processed first) succeeds; first teacher (processed second) fails.
    mockCreateQuiz
      .mockResolvedValueOnce({ id: "quiz_ok" }) // order 2
      .mockRejectedValueOnce(new Error("quiz-backend down")); // order 1

    const res = await POST(req(validBody()));
    expect(res.status).toBe(207);
    const json = await res.json();
    expect(json.createdCount).toBe(1);
    expect(json.failedCount).toBe(1);

    const failed = json.teachers.find((t: { status: string }) => t.status === "failed");
    expect(failed.error).toMatch(/quiz-backend down/);

    // ownership SELECT + 1 success insert + 1 failure insert
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const insertedStatuses = mockQuery.mock.calls
      .map((c) => c[0] as string)
      .filter((sql) => sql.includes("INSERT INTO lms_teacher_feedback"));
    expect(insertedStatuses.length).toBe(2);
  });

  it("defaults the window to +24h when endTime is omitted", async () => {
    await POST(req(validBody({ startTime: "2026-06-22T00:00:00Z" })));
    const sessionArg = mockCreateSession.mock.calls[0][0];
    const start = new Date(sessionArg.startTimeUtc).getTime();
    const end = new Date(sessionArg.endTimeUtc).getTime();
    expect(end - start).toBe(24 * 60 * 60 * 1000);
  });
});
