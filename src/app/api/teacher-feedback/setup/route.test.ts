import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/quiz-session-access", () => ({
  canAccessQuizSessionBatches: vi.fn(),
}));
vi.mock("@/lib/teacher-feedback-access", () => ({
  requireTeacherFeedbackAccess: vi.fn(),
}));
vi.mock("@/lib/teacher-feedback-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teacher-feedback-session")>();
  return {
    ...actual,
    createFeedbackSession: vi.fn(),
  };
});
vi.mock("@/lib/sns", () => ({ publishMessage: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { canAccessQuizSessionBatches } from "@/lib/quiz-session-access";
import { requireTeacherFeedbackAccess } from "@/lib/teacher-feedback-access";
import { createFeedbackSession } from "@/lib/teacher-feedback-session";
import { publishMessage } from "@/lib/sns";
import { query } from "@/lib/db";
import { POST } from "./route";
import { jsonRequest, PM_SESSION, NO_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockRequire = vi.mocked(requireTeacherFeedbackAccess);
const mockBatches = vi.mocked(canAccessQuizSessionBatches);
const mockCreateSession = vi.mocked(createFeedbackSession);
const mockPublish = vi.mocked(publishMessage);
const mockQuery = vi.mocked(query);

const PERMISSION = { email: "pm@avantifellows.org", level: 3 } as never;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    schoolCode: "14030",
    centreId: 40,
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
  // Route runs: batch-ownership (EXISTS -> .ok), centre-ownership (-> .name),
  // auth_group lookup (-> .auth_type), then INSERTs. Return the right shape per
  // query; inserts get [].
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM centres c JOIN school")) return [{ name: "JNV Palghar - CoE" }] as never;
    if (sql.includes("FROM auth_group")) return [{ auth_type: "ID,DOB" }] as never;
    if (sql.includes("SELECT EXISTS")) return [{ ok: true }] as never;
    return [] as never;
  });
  mockCreateSession.mockImplementation(async (p) => ({
    sessionPk: 100 + p.feedback.teacherOrder,
  }));
  mockPublish.mockResolvedValue(undefined);
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
    expect((await POST(req(validBody({ teachers: [] })))).status).toBe(400);
  });

  it("403 when the PM can't access the batches", async () => {
    mockBatches.mockResolvedValue(false);
    const res = await POST(req(validBody()));
    expect(res.status).toBe(403);
  });

  it("accepts a stringy centreId (pg returns bigint ids as strings)", async () => {
    // The client may echo back "40" (string) from the centres API.
    const res = await POST(req(validBody({ centreId: "40" })));
    expect(res.status).toBe(201);
  });

  it("400 when the batch doesn't belong to the school", async () => {
    mockQuery.mockResolvedValueOnce([{ ok: false }] as never); // ownership EXISTS -> false
    const res = await POST(req(validBody()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/do not belong/);
  });

  it("creates a session per teacher, publishes SNS db_id, returns 201", async () => {
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

    // No quiz creation in the LMS anymore — the Lambda builds it. One session +
    // one SNS db_id per teacher.
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenCalledWith({ action: "db_id", id: 101 });
    // auth_type derived from the group and passed to the session
    expect(mockCreateSession.mock.calls[0][0].authType).toBe("ID,DOB");
    // batch-ownership + centre-ownership + auth_group SELECTs + 2 inserts
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("does not chain — each session is created independently (no next_step_url)", async () => {
    await POST(req(validBody()));
    // Sessions are created in given order, none carrying a next_step_url.
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    for (const call of mockCreateSession.mock.calls) {
      expect(call[0]).not.toHaveProperty("nextStepUrl");
    }
  });

  it("partial failure: 207 with one failed teacher, still records a failed row", async () => {
    // First teacher (order 1) succeeds; second (order 2) fails on session create.
    mockCreateSession
      .mockResolvedValueOnce({ sessionPk: 101 })
      .mockRejectedValueOnce(new Error("db-service down"));

    const res = await POST(req(validBody()));
    expect(res.status).toBe(207);
    const json = await res.json();
    expect(json.createdCount).toBe(1);
    expect(json.failedCount).toBe(1);

    const failed = json.teachers.find((t: { status: string }) => t.status === "failed");
    expect(failed.error).toMatch(/db-service down/);

    // batch-ownership + centre-ownership + auth_group SELECTs + 1 success + 1 failure insert
    expect(mockQuery).toHaveBeenCalledTimes(5);
    const insertedStatuses = mockQuery.mock.calls
      .map((c) => c[0] as string)
      .filter((sql) => sql.includes("INSERT INTO lms_teacher_feedback"));
    expect(insertedStatuses.length).toBe(2);
    // SNS only published for the successful teacher.
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it("defaults the window to +24h when endTime is omitted", async () => {
    await POST(req(validBody({ startTime: "2026-06-22T00:00:00Z" })));
    const sessionArg = mockCreateSession.mock.calls[0][0];
    const start = new Date(sessionArg.startTimeUtc).getTime();
    const end = new Date(sessionArg.endTimeUtc).getTime();
    expect(end - start).toBe(24 * 60 * 60 * 1000);
  });
});
