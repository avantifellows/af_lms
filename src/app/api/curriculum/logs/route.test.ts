import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/permissions", () => ({
  PROGRAM_IDS: { COE: 1, NODAL: 2, NVS: 64 },
  getFeatureAccess: vi.fn(),
  getUserPermission: vi.fn(),
  canAccessSchoolSync: vi.fn(),
}));

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

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const mockGetUserPermission = vi.mocked(getUserPermission);
const mockGetFeatureAccess = vi.mocked(getFeatureAccess);
const mockCanAccessSchoolSync = vi.mocked(canAccessSchoolSync);

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
    mockWithTransaction.mockImplementation(async (fn) => fn({ query: vi.fn() } as never));
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
          id: 10,
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
          logDate: "2026-02-15",
          durationMinutes: 90,
          programId: 1,
          gradeId: 3,
          subjectId: 4,
          examTrack: "jee_main",
          topics: [
            {
              topicId: 101,
              topicName: "Motion",
              chapterId: 1,
              chapterName: "Kinematics",
            },
          ],
          isEditable: true,
          createdAt: "2026-02-15T10:00:00.000Z",
          updatedAt: "2026-02-15T10:00:00.000Z",
        },
        expect.objectContaining({ id: 11, isEditable: false }),
      ],
    });
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("AND l.deleted_at IS NULL"),
      ["70705", 1, 3, 4, "jee_main"]
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
      ["70705", 1, 3, 4, "jee_main", "2026-02-15", 90, "teacher@avantifellows.org"]
    );
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
      ["70705", 1, 3, 4, "jee_main", "2026-02-15", 90, "teacher@avantifellows.org"]
    );
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
