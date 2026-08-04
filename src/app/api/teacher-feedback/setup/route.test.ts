import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/quiz-session-access", () => ({
  canAccessQuizSessionBatches: vi.fn(),
  resolveBatchGroups: vi.fn(),
}));
vi.mock("@/lib/teacher-feedback-batches", () => ({
  getCentreScope: vi.fn(),
  centreOwnsAllBatches: vi.fn(),
}));
vi.mock("@/lib/teacher-feedback-access", () => ({
  authenticateTeacherFeedback: vi.fn(),
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

import {
  canAccessQuizSessionBatches,
  resolveBatchGroups,
} from "@/lib/quiz-session-access";
import {
  centreOwnsAllBatches,
  getCentreScope,
} from "@/lib/teacher-feedback-batches";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { createFeedbackSession } from "@/lib/teacher-feedback-session";
import { publishMessage } from "@/lib/sns";
import { query } from "@/lib/db";
import { POST } from "./route";
import { jsonRequest } from "../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authenticateTeacherFeedback);
const mockBatches = vi.mocked(canAccessQuizSessionBatches);
const mockResolveGroups = vi.mocked(resolveBatchGroups);
const mockCentreScope = vi.mocked(getCentreScope);
const mockCentreOwns = vi.mocked(centreOwnsAllBatches);
const mockCreateSession = vi.mocked(createFeedbackSession);
const mockPublish = vi.mocked(publishMessage);
const mockQuery = vi.mocked(query);

const PERMISSION = { email: "pm@avantifellows.org", level: 3 } as never;
const denied = (status: number) => ({
  ok: false as const,
  response: Response.json({ error: "x" }, { status }) as never,
});

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
  mockAuth.mockResolvedValue({ ok: true, permission: PERMISSION });
  mockBatches.mockResolvedValue(true);
  // group + auth_type come from the batch -> auth_group FK, not the batch_id prefix.
  mockResolveGroups.mockResolvedValue(
    new Map(
      validBody().classBatchIds.map((id) => [
        id,
        { group: "EnableStudents", authType: "ID,DOB" },
      ])
    )
  );
  // Batches are validated against the chosen centre's cohort.
  mockCentreScope.mockResolvedValue({ centreId: 40, schoolId: 408, programId: 1 });
  mockCentreOwns.mockResolvedValue(true);
  // Route's remaining direct SQL: centre name for the record, then the INSERTs.
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM centres c JOIN school")) return [{ name: "JNV Palghar - CoE" }] as never;
    return [] as never;
  });
  mockCreateSession.mockImplementation(async (p) => ({
    sessionPk: 100 + p.feedback.teacherOrder,
  }));
  mockPublish.mockResolvedValue(undefined);
});

describe("POST /api/teacher-feedback/setup", () => {
  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(denied(401));
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });

  it("403 when lacking quiz-session edit access", async () => {
    mockAuth.mockResolvedValue(denied(403));
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

  it("400 when a batch isn't in the chosen centre's cohort", async () => {
    // A school can host a CoE and a Nodal centre, so belonging to the school is
    // not enough — the batch must belong to the selected centre.
    mockCentreOwns.mockResolvedValue(false);
    const res = await POST(req(validBody()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/do not all belong/);
  });

  it("400 when the centre has no programme (fails closed)", async () => {
    // Without a programme there is nothing to distinguish the school's centres,
    // so the route must refuse rather than fall back to all school batches.
    mockCentreScope.mockResolvedValue({ centreId: 16, schoolId: 336, programId: null });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no programme set/i);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("400 when a selected batch has no auth group", async () => {
    // group/auth_type come from the batch -> auth_group FK; without it the
    // session would be invisible on Gurukul and students could not log in.
    mockResolveGroups.mockResolvedValue(new Map());
    const res = await POST(req(validBody()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/auth group/i);
  });

  it("400 when selected batches span different auth groups", async () => {
    // One session carries a single group/auth_type pair.
    mockResolveGroups.mockResolvedValue(
      new Map([
        ["A", { group: "EnableStudents", authType: "ID,DOB" }],
        ["B", { group: "PunjabStudents", authType: "ID" }],
      ])
    );
    const res = await POST(req(validBody({ classBatchIds: ["A", "B"] })));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/same auth group/i);
  });

  it("derives group from the auth_group FK, not the batch_id prefix", async () => {
    // 314 of 1262 production batches have a prefix that is not their auth_group
    // name (e.g. "EMRS-11-25-P01"), so the prefix must not be used.
    mockResolveGroups.mockResolvedValue(
      new Map([["EMRS-11-25-P01", { group: "EMRSStudents", authType: "ID,DOB" }]])
    );
    const res = await POST(req(validBody({ classBatchIds: ["EMRS-11-25-P01"] })));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.group).toBe("EMRSStudents");
    expect(mockCreateSession.mock.calls[0][0].group).toBe("EMRSStudents");
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
    // auth_type comes from the batch's auth_group and is passed to the session
    expect(mockCreateSession.mock.calls[0][0].authType).toBe("ID,DOB");
    // Direct SQL: the centre-name SELECT + one insert per teacher. (Batch scope
    // and auth-group resolution live in their own mocked modules.)
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("records the centre's programme on each row, and no derivable columns", async () => {
    // program_id is what defines the round's cohort (batches are selected by it),
    // so it must be stored rather than re-inferred from the centre later.
    // source_id and centre_name are deliberately NOT columns: the former is
    // derivable and lives on the session's cms_test_id, the latter is joined from
    // `centres` at read time so a renamed centre reads correctly.
    await POST(req(validBody()));

    const inserts = mockQuery.mock.calls.filter((c) =>
      (c[0] as string).includes("INSERT INTO lms_teacher_feedback")
    );
    expect(inserts).toHaveLength(2);

    for (const [sql, params] of inserts) {
      expect(sql).toContain("program_id");
      expect(sql).not.toContain("source_id");
      expect(sql).not.toContain("centre_name");
      // programId from the resolved centre scope, not from the request body.
      expect(params as unknown[]).toContain(1);
    }
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

    // centre-name SELECT + 1 success insert + 1 failure insert
    expect(mockQuery).toHaveBeenCalledTimes(3);
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
