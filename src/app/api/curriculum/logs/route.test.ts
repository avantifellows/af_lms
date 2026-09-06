import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/centre-resolver", () => ({
  validateCentreExamTrackMapping: vi.fn(),
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
import { GET, POST } from "./route";
import {
  PASSCODE_SESSION,
  TEACHER_SESSION,
} from "../../__test-utils__/api-test-helpers";
import { resetCurriculumSchemaCheckForTests } from "@/lib/curriculum-schema";
import { validateCentreExamTrackMapping } from "@/lib/centre-resolver";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const mockGetUserPermission = vi.mocked(getUserPermission);
const mockGetFeatureAccess = vi.mocked(getFeatureAccess);
const mockCanAccessSchoolSync = vi.mocked(canAccessSchoolSync);
const mockValidateCentreExamTrackMapping = vi.mocked(validateCentreExamTrackMapping);

function nextReq(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost"), init);
}

function jsonReq(url: string, body: unknown) {
  return nextReq(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/curriculum/logs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCurriculumSchemaCheckForTests();
    mockSession.mockResolvedValue(TEACHER_SESSION);
    mockGetUserPermission.mockResolvedValue({
      email: "teacher@avantifellows.org",
      level: 1,
      role: "teacher",
      school_codes: ["70705"],
      regions: null,
      program_ids: [1],
      read_only: false,
    });
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mockCanAccessSchoolSync.mockReturnValue(true);
    mockValidateCentreExamTrackMapping.mockResolvedValue({ ok: true });
    mockWithTransaction.mockImplementation(async (fn) => fn({ query: vi.fn() } as never));
  });

  it("rejects a new log when the Exam Track is not mapped to the resolved Centre and Grade", async () => {
    mockValidateCentreExamTrackMapping.mockResolvedValue({
      ok: false,
      error: "No Exam Tracks configured for this Centre and Grade",
    });
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ code: "70705", region: "AHMEDABAD" }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ id: 3 }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "regular",
        log_date: "2026-02-15",
        duration_minutes: 90,
        topic_ids: [101],
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "No Exam Tracks configured for this Centre and Grade",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("lists non-deleted LMS Curriculum Logs with backend-shaped topics and historical editability", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          id: "10",
          log_date: new Date(2026, 1, 15),
          duration_minutes: 90,
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-15T10:00:00.000Z",
          updated_at: "2026-02-15T10:00:00.000Z",
          topic_id: 101,
          topic_name: [{ lang_code: "en", topic: "Motion" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
          topic_currently_in_syllabus: true,
        },
        {
          id: "10",
          log_date: new Date(2026, 1, 15),
          duration_minutes: 90,
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-15T10:00:00.000Z",
          updated_at: "2026-02-15T10:00:00.000Z",
          topic_id: 103,
          topic_name: [{ lang_code: "en", topic: "Acceleration" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
          topic_currently_in_syllabus: true,
        },
        {
          id: 11,
          log_date: "2026-02-14",
          duration_minutes: 60,
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-14T10:00:00.000Z",
          updated_at: "2026-02-14T10:00:00.000Z",
          topic_id: 102,
          topic_name: [{ lang_code: "en", topic: "Old Topic" }],
          chapter_id: 2,
          chapter_name: [{ lang_code: "en", chapter: "Old Chapter" }],
          topic_currently_in_syllabus: false,
        },
        {
          id: 12,
          log_type: "class_cancelled",
          log_date: "2026-02-13",
          duration_minutes: null,
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-13T10:00:00.000Z",
          updated_at: "2026-02-13T10:00:00.000Z",
          topic_id: null,
          topic_name: null,
          chapter_id: null,
          chapter_name: null,
          topic_currently_in_syllabus: null,
          log_chapter_id: 44,
          log_chapter_name: [{ lang_code: "en", chapter: "Old Kinematics" }],
          log_chapter_currently_in_syllabus: false,
        },
      ]);

    const res = await GET(
      nextReq(
        "/api/curriculum/logs?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      logs: [
        {
          id: 10,
          logType: "regular",
          logDate: "2026-02-15",
          durationMinutes: 90,
          programId: 1,
          gradeId: 3,
          subjectId: 4,
          examTrack: "jee_main",
          chapterId: null,
          chapterName: null,
          topics: [
            {
              topicId: 101,
              topicName: "Motion",
              chapterId: 1,
              chapterName: "Kinematics",
            },
            {
              topicId: 103,
              topicName: "Acceleration",
              chapterId: 1,
              chapterName: "Kinematics",
            },
          ],
          isEditable: true,
          createdAt: "2026-02-15T10:00:00.000Z",
          updatedAt: "2026-02-15T10:00:00.000Z",
        },
        expect.objectContaining({ id: 11, isEditable: false }),
        expect.objectContaining({
          id: 12,
          logType: "class_cancelled",
          chapterId: 44,
          isEditable: false,
        }),
      ],
    });
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("AND l.deleted_at IS NULL"),
      ["70705", 1, 3, 4, "jee_main", 1]
    );
    expect(String(mockQuery.mock.calls.at(-1)?.[0])).toContain(
      "END AS log_chapter_currently_in_syllabus"
    );
  });

  it("creates a topic-backed LMS Curriculum Log transactionally", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 12,
            log_date: "2026-02-15",
            duration_minutes: 90,
            program_id: 1,
            grade_id: 3,
            subject_id: 4,
            exam_track: "jee_main",
            inserted_at: "2026-02-15T10:00:00.000Z",
            updated_at: "2026-02-15T10:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          topic_id: 101,
          topic_name: [{ lang_code: "en", topic: "Motion" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 12,
          log_date: "2026-02-15",
          duration_minutes: 90,
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-15T10:00:00.000Z",
          updated_at: "2026-02-15T10:00:00.000Z",
          topic_id: 101,
          topic_name: [{ lang_code: "en", topic: "Motion" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
          topic_currently_in_syllabus: true,
        },
      ]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_date: "2026-02-15",
        duration_minutes: 90,
        topic_ids: [101],
      })
    );

    expect(res.status).toBe(201);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO lms_curriculum_logs"),
      [
        "70705",
        1,
        3,
        4,
        "jee_main",
        "regular",
        "2026-02-15",
        90,
        null,
        "teacher@avantifellows.org",
      ]
    );
    expect(String(clientQuery.mock.calls[0][0])).toContain("inserted_by_email");
    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO lms_curriculum_log_topics"),
      [12, [101]]
    );
    await expect(res.json()).resolves.toMatchObject({
      log: {
        id: 12,
        logDate: "2026-02-15",
        durationMinutes: 90,
        topics: [{ topicId: 101, topicName: "Motion" }],
      },
    });
  });

  it("saves completion-only Chapter Completion deltas without creating an LMS Curriculum Log", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 44, completed_at: "2026-02-15T10:00:00.000Z", completed_by_email: "teacher@avantifellows.org" }] })
      .mockResolvedValueOnce({ rows: [{ chapter_id: 44, completed_at: "2026-02-15T10:00:00.000Z", completed_by_email: "teacher@avantifellows.org" }] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        { chapter_id: 44, is_in_syllabus: true, active_completed_at: null },
      ]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        complete_chapter_ids: [44],
      })
    );

    expect(res.status).toBe(200);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO lms_curriculum_logs"),
      expect.anything()
    );
    await expect(res.json()).resolves.toEqual({
      log: null,
      completions: [
        {
          chapterId: 44,
          active: true,
          completedAt: "2026-02-15T10:00:00.000Z",
          completedByEmail: "teacher@avantifellows.org",
        },
      ],
    });
  });

  it("creates a topic-backed log and Chapter Completion deltas in one transaction", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            chapter_id: 44,
            completed_at: "2026-02-15T10:00:00.000Z",
            completed_by_email: "teacher@avantifellows.org",
          },
        ],
      });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        { chapter_id: 44, is_in_syllabus: true, active_completed_at: null },
      ])
      .mockResolvedValueOnce([
        {
          topic_id: 101,
          topic_name: [{ lang_code: "en", topic: "Motion" }],
          chapter_id: 44,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 12,
          log_date: "2026-02-15",
          duration_minutes: 90,
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-15T10:00:00.000Z",
          updated_at: "2026-02-15T10:00:00.000Z",
          topic_id: 101,
          topic_name: [{ lang_code: "en", topic: "Motion" }],
          chapter_id: 44,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
          topic_currently_in_syllabus: true,
        },
      ]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_date: "2026-02-15",
        duration_minutes: 90,
        topic_ids: [101],
        complete_chapter_ids: [44],
      })
    );

    expect(res.status).toBe(201);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO lms_curriculum_logs"),
      [
        "70705",
        1,
        3,
        4,
        "jee_main",
        "regular",
        "2026-02-15",
        90,
        null,
        "teacher@avantifellows.org",
      ]
    );
    expect(String(clientQuery.mock.calls[0][0])).toContain("inserted_by_email");
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO lms_curriculum_chapter_completions"),
      ["70705", 1, 44, "jee_main", "teacher@avantifellows.org"]
    );
    await expect(res.json()).resolves.toMatchObject({
      log: {
        id: 12,
        topics: [{ topicId: 101, chapterId: 44 }],
      },
      completions: [{ chapterId: 44, active: true }],
    });
  });

  it("creates a Class Cancelled log from a date and one Chapter", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [{ id: 21 }] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ chapter_id: 44 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 21,
          log_date: "2026-02-15",
          duration_minutes: null,
          log_type: "class_cancelled",
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-15T10:00:00.000Z",
          updated_at: "2026-02-15T10:00:00.000Z",
          topic_id: null,
          topic_name: null,
          chapter_id: null,
          chapter_name: null,
          topic_currently_in_syllabus: null,
          log_chapter_id: 44,
          log_chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
          log_chapter_currently_in_syllabus: true,
        },
      ]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "class_cancelled",
        log_date: "2026-02-15",
        chapter_id: 44,
      })
    );

    expect(res.status).toBe(201);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO lms_curriculum_logs"),
      [
        "70705",
        1,
        3,
        4,
        "jee_main",
        "class_cancelled",
        "2026-02-15",
        null,
        44,
        "teacher@avantifellows.org",
      ]
    );
    await expect(res.json()).resolves.toEqual({
      log: {
        id: 21,
        logType: "class_cancelled",
        logDate: "2026-02-15",
        durationMinutes: null,
        programId: 1,
        gradeId: 3,
        subjectId: 4,
        examTrack: "jee_main",
        chapterId: 44,
        chapterName: "Kinematics",
        topics: [],
        isEditable: true,
        createdAt: "2026-02-15T10:00:00.000Z",
        updatedAt: "2026-02-15T10:00:00.000Z",
      },
      completions: [],
    });
  });

  it.each([
    [
      "topics",
      { chapter_id: 44, topic_ids: [101] },
      "Class Cancelled logs cannot include topics",
    ],
    [
      "malformed topics",
      { chapter_id: 44, topic_ids: ["invalid"] },
      "Class Cancelled logs cannot include topics",
    ],
    [
      "a duration",
      { chapter_id: 44, duration_minutes: 60 },
      "Class Cancelled logs cannot have a duration",
    ],
    [
      "a malformed duration",
      { chapter_id: 44, duration_minutes: "invalid" },
      "Class Cancelled logs cannot have a duration",
    ],
    [
      "no Chapter",
      {},
      "Class Cancelled logs require exactly one Chapter",
    ],
  ])("rejects a Class Cancelled log with %s", async (_label, extra, error) => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "class_cancelled",
        log_date: "2026-02-15",
        ...extra,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects a future-dated Class Cancelled log", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "class_cancelled",
        log_date: "2999-01-01",
        chapter_id: 44,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Log date cannot be in the future",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects a Class Cancelled log for a Chapter outside the selected scope", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "class_cancelled",
        log_date: "2026-02-15",
        chapter_id: 999,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Chapter does not belong to the selected Grade, Subject, and Exam Track",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects Chapter Completion changes on a Class Cancelled log", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        { chapter_id: 44, is_in_syllabus: true, active_completed_at: null },
      ]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "class_cancelled",
        log_date: "2026-02-15",
        chapter_id: 44,
        complete_chapter_ids: [44],
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Class Cancelled logs cannot include Chapter Completion changes",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects a second active Class Cancelled log for the same Chapter and date", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ chapter_id: 44 }])
      .mockResolvedValueOnce([{ id: 20 }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "class_cancelled",
        log_date: "2026-02-15",
        chapter_id: 44,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "A Class Cancelled log already exists for this Chapter and date",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("WHERE log_type = 'class_cancelled'"),
      ["70705", 1, 3, 4, "jee_main", 44, "2026-02-15", null]
    );
  });

  it("maps a racing unique-index conflict onto the duplicate Class Cancelled error", async () => {
    const conflict = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });
    mockWithTransaction.mockRejectedValue(conflict);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ chapter_id: 44 }])
      .mockResolvedValueOnce([]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "class_cancelled",
        log_date: "2026-02-15",
        chapter_id: 44,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "A Class Cancelled log already exists for this Chapter and date",
    });
  });

  it("creates a Doubt Solving log from a date, one in-syllabus Chapter, and duration", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [{ id: 22 }] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ chapter_id: 44 }])
      .mockResolvedValueOnce([
        {
          id: 22,
          log_date: "2026-02-15",
          duration_minutes: 75,
          log_type: "doubt_solving",
          program_id: 1,
          grade_id: 3,
          subject_id: 4,
          exam_track: "jee_main",
          inserted_at: "2026-02-15T10:00:00.000Z",
          updated_at: "2026-02-15T10:00:00.000Z",
          topic_id: null,
          topic_name: null,
          chapter_id: null,
          chapter_name: null,
          topic_currently_in_syllabus: null,
          log_chapter_id: 44,
          log_chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
          log_chapter_currently_in_syllabus: true,
        },
      ]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "doubt_solving",
        log_date: "2026-02-15",
        chapter_id: 44,
        duration_minutes: 75,
      })
    );

    expect(res.status).toBe(201);
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO lms_curriculum_logs"),
      [
        "70705",
        1,
        3,
        4,
        "jee_main",
        "doubt_solving",
        "2026-02-15",
        75,
        44,
        "teacher@avantifellows.org",
      ]
    );
    await expect(res.json()).resolves.toMatchObject({
      log: {
        id: 22,
        logType: "doubt_solving",
        durationMinutes: 75,
        chapterId: 44,
        chapterName: "Kinematics",
        topics: [],
      },
    });
  });

  it.each([
    ["topics", { chapter_id: 44, duration_minutes: 60, topic_ids: [101] }, "Doubt Solving logs cannot include topics"],
    ["malformed topics", { chapter_id: 44, duration_minutes: 60, topic_ids: ["invalid"] }, "Doubt Solving logs cannot include topics"],
    ["no Chapter", { duration_minutes: 60 }, "Doubt Solving logs require exactly one Chapter"],
    ["multiple Chapters", { chapter_id: [44, 55], duration_minutes: 60 }, "Doubt Solving logs require exactly one Chapter"],
    ["no duration", { chapter_id: 44 }, "Duration must be greater than 0 and at most 720 minutes"],
    ["zero duration", { chapter_id: 44, duration_minutes: 0 }, "Duration must be greater than 0 and at most 720 minutes"],
    ["over-720 duration", { chapter_id: 44, duration_minutes: 721 }, "Duration must be greater than 0 and at most 720 minutes"],
  ])("rejects a Doubt Solving log with %s", async (_label, extra, error) => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "doubt_solving",
        log_date: "2026-02-15",
        ...extra,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects a future-dated Doubt Solving log", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "doubt_solving",
        log_date: "2999-01-01",
        chapter_id: 44,
        duration_minutes: 60,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Log date cannot be in the future",
    });
  });

  it("rejects a Doubt Solving log for an out-of-syllabus Chapter", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "doubt_solving",
        log_date: "2026-02-15",
        chapter_id: 999,
        duration_minutes: 60,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Chapter does not belong to the selected Grade, Subject, and Exam Track",
    });
  });

  it("rejects Chapter Completion changes on a Doubt Solving log", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        { chapter_id: 44, is_in_syllabus: true, active_completed_at: null },
      ]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "doubt_solving",
        log_date: "2026-02-15",
        chapter_id: 44,
        duration_minutes: 60,
        complete_chapter_ids: [44],
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Doubt Solving logs cannot include Chapter Completion changes",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["Class Cancelled", "class_cancelled", "44"],
    ["Doubt Solving", "doubt_solving", ["invalid"]],
  ])(
    "rejects malformed Chapter Completion fields on a %s log",
    async (_label, logType, completeChapterIds) => {
      mockQuery.mockResolvedValueOnce([]);

      const res = await POST(
        jsonReq("/api/curriculum/logs", {
          school_code: "70705",
          program_id: 1,
          exam_track: "jee_main",
          grade: 11,
          subject: "Physics",
          log_type: logType,
          log_date: "2026-02-15",
          chapter_id: 44,
          duration_minutes: logType === "doubt_solving" ? 60 : undefined,
          complete_chapter_ids: completeChapterIds,
        })
      );

      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toEqual({
        error: "Chapter Completion changes must use arrays of positive integer Chapter IDs",
      });
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockWithTransaction).not.toHaveBeenCalled();
    }
  );

  it("rejects an unknown log type", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_type: "revision",
        log_date: "2026-02-15",
        chapter_id: 44,
        duration_minutes: 60,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Log type must be Regular Class, Class Cancelled, or Doubt Solving",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects creating a Biology JEE Main LMS Curriculum Log", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Biology",
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Biology is not valid with JEE Main",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns a validation error when the Exam Track has no curriculum content", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "cet",
        grade: 11,
        subject: "Physics",
        log_date: "2026-02-15",
        duration_minutes: 60,
        topic_ids: [101],
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Curriculum configuration is not available for CET",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects saves with no topics and no Chapter Completion deltas", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: "Nothing to save" });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects passcode users before querying", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);

    const res = await GET(
      nextReq(
        "/api/curriculum/logs?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      )
    );

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects read-only users before validation", async () => {
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        complete_chapter_ids: [44],
      })
    );

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects completion saves outside the caller's Program scope", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 2,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        complete_chapter_ids: [44],
      })
    );

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects invalid topic-backed create data before opening a transaction", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await POST(
      jsonReq("/api/curriculum/logs", {
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        log_date: "2999-01-01",
        duration_minutes: 721,
        topic_ids: [101],
      })
    );

    expect(res.status).toBe(422);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
