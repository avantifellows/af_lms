import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  const getUserPermission = vi.fn();
  return {
    ...actual,
    getFeatureAccess: vi.fn(),
    getUserPermission,
    getResolvedPermission: getUserPermission,
    canAccessSchoolSync: vi.fn(),
  };
});

import { getServerSession } from "next-auth";
import { query, withTransaction } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import {
  PASSCODE_SESSION,
  TEACHER_SESSION,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";
import { resetCurriculumSchemaCheckForTests } from "@/lib/curriculum-schema";
import { DELETE, PATCH } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const mockGetUserPermission = vi.mocked(getUserPermission);
const mockGetFeatureAccess = vi.mocked(getFeatureAccess);
const mockCanAccessSchoolSync = vi.mocked(canAccessSchoolSync);

function jsonReq(body: unknown) {
  return new NextRequest(
    new URL("/api/curriculum/logs/12", "http://localhost"),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function deleteReq() {
  return new NextRequest(
    new URL("/api/curriculum/logs/12", "http://localhost"),
    { method: "DELETE" }
  );
}

const teacherPermission = {
  email: "teacher@avantifellows.org",
  level: 1 as const,
  role: "teacher" as const,
  school_codes: ["70705"],
  regions: null,
  program_ids: [1],
  read_only: false,
};

const editableLogRow = {
  id: 12,
  school_code: "70705",
  program_id: 1,
  grade_id: 3,
  subject_id: 4,
  exam_track: "jee_main",
  log_type: "regular",
  is_editable: true,
  is_currently_mapped: true,
};

const cancelledLogRow = {
  ...editableLogRow,
  log_type: "class_cancelled",
};

const doubtSolvingLogRow = {
  ...editableLogRow,
  log_type: "doubt_solving",
};

const updatedLogRows = [
  {
    id: 12,
    log_date: "2026-02-16",
    duration_minutes: 120,
    program_id: 1,
    grade_id: 3,
    subject_id: 4,
    exam_track: "jee_main",
    inserted_at: "2026-02-15T10:00:00.000Z",
    updated_at: "2026-02-16T10:00:00.000Z",
    topic_id: 102,
    topic_name: [{ lang_code: "en", topic: "Projectile Motion" }],
    chapter_id: 1,
    chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
    topic_currently_in_syllabus: true,
  },
];

describe("PATCH /api/curriculum/logs/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCurriculumSchemaCheckForTests();
    mockSession.mockResolvedValue(TEACHER_SESSION);
    mockGetUserPermission.mockResolvedValue(teacherPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mockCanAccessSchoolSync.mockReturnValue(true);
  });

  it("edits one LMS Curriculum Log by replacing its full topic set in a transaction", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          topic_id: 102,
          topic_name: [{ lang_code: "en", topic: "Projectile Motion" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
        },
      ])
      .mockResolvedValueOnce(updatedLogRows);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(200);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("UPDATE lms_curriculum_logs"),
      [12, "2026-02-16", 120, "teacher@avantifellows.org"]
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("DELETE FROM lms_curriculum_log_topics"),
      [12]
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO lms_curriculum_log_topics"),
      [12, [102]]
    );
    await expect(res.json()).resolves.toMatchObject({
      log: {
        id: 12,
        logDate: "2026-02-16",
        durationMinutes: 120,
        topics: [{ topicId: 102, topicName: "Projectile Motion" }],
        isEditable: true,
      },
    });
  });

  it("edits a Class Cancelled log's date and Chapter", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cancelledLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ chapter_id: 55 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 12,
          log_type: "class_cancelled",
          log_date: "2026-02-16",
          duration_minutes: null,
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-15T10:00:00.000Z",
          updated_at: "2026-02-16T10:00:00.000Z",
          topic_id: null,
          topic_name: null,
          chapter_id: null,
          chapter_name: null,
          topic_currently_in_syllabus: null,
          log_chapter_id: 55,
          log_chapter_name: [{ lang_code: "en", chapter: "Laws of Motion" }],
        },
      ]);

    const res = await PATCH(
      jsonReq({ log_date: "2026-02-16", chapter_id: 55 }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("UPDATE lms_curriculum_logs"),
      [12, "2026-02-16", null, 55, "teacher@avantifellows.org"]
    );
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("lms_curriculum_log_topics"),
      expect.anything()
    );
    await expect(res.json()).resolves.toMatchObject({
      log: {
        id: 12,
        logType: "class_cancelled",
        logDate: "2026-02-16",
        durationMinutes: null,
        chapterId: 55,
        chapterName: "Laws of Motion",
        topics: [],
      },
    });
  });

  it("edits a Doubt Solving log's date, Chapter, and duration", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([doubtSolvingLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ chapter_id: 55 }])
      .mockResolvedValueOnce([
        {
          id: 12,
          log_type: "doubt_solving",
          log_date: "2026-02-16",
          duration_minutes: 90,
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-15T10:00:00.000Z",
          updated_at: "2026-02-16T10:00:00.000Z",
          topic_id: null,
          topic_name: null,
          chapter_id: null,
          chapter_name: null,
          topic_currently_in_syllabus: null,
          log_chapter_id: 55,
          log_chapter_name: [{ lang_code: "en", chapter: "Laws of Motion" }],
        },
      ]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        chapter_id: 55,
        duration_minutes: 90,
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE lms_curriculum_logs"),
      [12, "2026-02-16", 90, 55, "teacher@avantifellows.org"]
    );
    await expect(res.json()).resolves.toMatchObject({
      log: {
        logType: "doubt_solving",
        logDate: "2026-02-16",
        durationMinutes: 90,
        chapterId: 55,
        topics: [],
      },
    });
  });

  it.each([
    ["topics", { chapter_id: 55, duration_minutes: 60, topic_ids: [102] }, "Doubt Solving logs cannot include topics"],
    ["malformed topics", { chapter_id: 55, duration_minutes: 60, topic_ids: ["invalid"] }, "Doubt Solving logs cannot include topics"],
    ["no Chapter", { duration_minutes: 60 }, "Doubt Solving logs require exactly one Chapter"],
    ["no duration", { chapter_id: 55 }, "Duration must be greater than 0 and at most 720 minutes"],
    ["zero duration", { chapter_id: 55, duration_minutes: 0 }, "Duration must be greater than 0 and at most 720 minutes"],
    ["over-720 duration", { chapter_id: 55, duration_minutes: 721 }, "Duration must be greater than 0 and at most 720 minutes"],
    ["a future date", { log_date: "2999-01-01", chapter_id: 55, duration_minutes: 60 }, "Log date cannot be in the future"],
  ])("rejects editing a Doubt Solving log with %s", async (_label, extra, error) => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([doubtSolvingLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({ log_date: "2026-02-16", ...extra }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects editing a Doubt Solving log to an out-of-syllabus Chapter", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([doubtSolvingLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonReq({ log_date: "2026-02-16", chapter_id: 999, duration_minutes: 60 }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Chapter does not belong to the LMS Curriculum Log scope",
    });
  });

  it("rejects changing a log's type", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cancelledLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_type: "regular",
        log_date: "2026-02-16",
        duration_minutes: 60,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error:
        "LMS Curriculum Log type cannot be changed — delete the log and create it again",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      "topics",
      { chapter_id: 55, topic_ids: [102] },
      "Class Cancelled logs cannot include topics",
    ],
    [
      "malformed topics",
      { chapter_id: 55, topic_ids: ["invalid"] },
      "Class Cancelled logs cannot include topics",
    ],
    [
      "a duration",
      { chapter_id: 55, duration_minutes: 60 },
      "Class Cancelled logs cannot have a duration",
    ],
    ["no Chapter", {}, "Class Cancelled logs require exactly one Chapter"],
  ])(
    "rejects editing a Class Cancelled log with %s",
    async (_label, extra, error) => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([cancelledLogRow])
        .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
        .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

      const res = await PATCH(
        jsonReq({ log_date: "2026-02-16", ...extra }),
        routeParams({ id: "12" })
      );

      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toEqual({ error });
      expect(mockWithTransaction).not.toHaveBeenCalled();
    }
  );

  it("rejects a Class Cancelled edit that duplicates another active log", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cancelledLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ chapter_id: 55 }])
      .mockResolvedValueOnce([{ id: 33 }]);

    const res = await PATCH(
      jsonReq({ log_date: "2026-02-16", chapter_id: 55 }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "A Class Cancelled log already exists for this Chapter and date",
    });
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("WHERE log_type = 'class_cancelled'"),
      ["70705", 1, 3, 4, "jee_main", 55, "2026-02-16", 12]
    );
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects a Chapter on a Regular Class edit", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
        chapter_id: 55,
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Regular Class logs derive their Chapters from topics",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects scope fields and Chapter Completion deltas in edit requests", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
        school_code: "70705",
        complete_chapter_ids: [1],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error:
        "Only log_date, duration_minutes, topic_ids, and chapter_id can be updated",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("requires at least one replacement topic", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "At least one topic is required",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects edits to historical LMS Curriculum Logs", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...editableLogRow, is_editable: false }])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Historical LMS Curriculum Logs are not editable",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects edits after the stored Track mapping is removed", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...editableLogRow, is_currently_mapped: false },
      ])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error:
        "Historical LMS Curriculum Logs are read-only after their Centre Exam Track mapping is removed",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects users without Curriculum edit access before loading the log", async () => {
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects passcode users before loading the log", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(403);
    expect(mockGetUserPermission).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-school log ID edits by the stored row scope", async () => {
    mockCanAccessSchoolSync.mockReturnValue(false);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-program log ID edits by the stored row Program", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [2] }])
      .mockResolvedValueOnce([{ id: 2, name: "JNV Nodal" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects duration bounds and future IST dates before opening a transaction", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2999-01-01",
        duration_minutes: 721,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Log date cannot be in the future",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects updating a Biology JEE Advanced LMS Curriculum Log", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...editableLogRow,
          subject_id: 3,
          exam_track: "jee_advanced",
        },
      ])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Biology is not valid with JEE Advanced",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects replacement topics outside the loaded log Exam Track and scope", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [999],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Topics do not belong to the LMS Curriculum Log scope",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns not found for missing or deleted logs", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "LMS Curriculum Log not found",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("lets the transaction helper roll back a failed replacement and does not read an updated log", async () => {
    mockWithTransaction.mockRejectedValue(new Error("insert failed"));
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          topic_id: 102,
          topic_name: [{ lang_code: "en", topic: "Projectile Motion" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
        },
      ]);

    await expect(
      PATCH(
        jsonReq({
          log_date: "2026-02-16",
          duration_minutes: 120,
          topic_ids: [102],
        }),
        routeParams({ id: "12" })
      )
    ).rejects.toThrow("insert failed");

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("does not rewrite topic rows if the log is concurrently soft-deleted before update", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          topic_id: 102,
          topic_name: [{ lang_code: "en", topic: "Projectile Motion" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
        },
      ]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "LMS Curriculum Log not found",
    });
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM lms_curriculum_log_topics"),
      expect.anything()
    );
  });
});

describe("DELETE /api/curriculum/logs/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCurriculumSchemaCheckForTests();
    mockSession.mockResolvedValue(TEACHER_SESSION);
    mockGetUserPermission.mockResolvedValue(teacherPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mockCanAccessSchoolSync.mockReturnValue(true);
  });

  it("soft-deletes one LMS Curriculum Log after verifying the stored row scope", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(200);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET deleted_at = (NOW() AT TIME ZONE 'UTC')"),
      [12, "teacher@avantifellows.org"]
    );
    await expect(res.json()).resolves.toEqual({ deleted: true });
  });

  it("soft-deletes a topicless Class Cancelled log", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cancelledLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET deleted_at = (NOW() AT TIME ZONE 'UTC')"),
      [12, "teacher@avantifellows.org"]
    );
    await expect(res.json()).resolves.toEqual({ deleted: true });
  });

  it("soft-deletes a Doubt Solving log", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([doubtSolvingLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET deleted_at = (NOW() AT TIME ZONE 'UTC')"),
      [12, "teacher@avantifellows.org"]
    );
  });

  it("rejects deletes after the stored Track mapping is removed", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...editableLogRow, is_currently_mapped: false },
      ])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error:
        "Historical LMS Curriculum Logs are read-only after their Centre Exam Track mapping is removed",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects users without Curriculum edit access before loading the log", async () => {
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects passcode users before loading the log", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(403);
    expect(mockGetUserPermission).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-school deletes by the stored row scope", async () => {
    mockCanAccessSchoolSync.mockReturnValue(false);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-program deletes by the stored row Program", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [2] }])
      .mockResolvedValueOnce([{ id: 2, name: "JNV Nodal" }]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns not found for missing or already-deleted logs", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "LMS Curriculum Log not found",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
