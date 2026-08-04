import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./permissions")>();
  return {
    ...actual,
    canAccessSchoolSync: vi.fn(),
  };
});

import { query } from "./db";
import { canAccessSchoolSync } from "./permissions";
import {
  markChapterComplete,
  unmarkChapterComplete,
  validateChapterCompletionDeltas,
} from "./curriculum-chapter-completion";
import type { UserPermission } from "./permissions";

const mockQuery = vi.mocked(query);
const mockCanAccessSchoolSync = vi.mocked(canAccessSchoolSync);

const permission: UserPermission = {
  email: "teacher@avantifellows.org",
  level: 1,
  role: "teacher",
  school_codes: ["70705"],
  regions: null,
  program_ids: [1],
  read_only: false,
};

describe("curriculum-chapter-completion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCanAccessSchoolSync.mockReturnValue(true);
  });

  it("validates mark and unmark deltas against scope, chapter membership, and config", async () => {
    mockQuery
      .mockResolvedValueOnce([{ code: "70705", region: "AHMEDABAD", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        { chapter_id: 44, is_in_syllabus: true, active_completed_at: null },
        {
          chapter_id: 45,
          is_in_syllabus: false,
          active_completed_at: "2026-02-15T10:00:00.000Z",
        },
      ]);

    const result = await validateChapterCompletionDeltas({
      schoolCode: "70705",
      programId: 1,
      examTrack: "jee_main",
      grade: 11,
      subject: "Physics",
      completeChapterIds: [44],
      uncompleteChapterIds: [45],
      permission,
    });

    expect(result).toMatchObject({
      ok: true,
      examTrack: "jee_main",
      gradeId: 3,
      subjectId: 4,
      completeChapterIds: [44],
      uncompleteChapterIds: [45],
    });
  });

  it("rejects marking out-of-syllabus chapters complete", async () => {
    mockQuery
      .mockResolvedValueOnce([{ code: "70705", region: "AHMEDABAD", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        { chapter_id: 44, is_in_syllabus: false, active_completed_at: null },
      ]);

    const result = await validateChapterCompletionDeltas({
      schoolCode: "70705",
      programId: 1,
      examTrack: "jee_main",
      grade: 11,
      subject: "Physics",
      completeChapterIds: [44],
      uncompleteChapterIds: [],
      permission,
    });

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "Chapter is not in syllabus for the selected Exam Track",
    });
  });

  it("marks Chapter Completion with conflict-safe insert and re-read", async () => {
    const clientQuery = vi.fn()
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

    const result = await markChapterComplete(
      { query: clientQuery } as never,
      {
        schoolCode: "70705",
        programId: 1,
        chapterId: 44,
        examTrack: "jee_main",
        actorEmail: "teacher@avantifellows.org",
      }
    );

    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("ON CONFLICT (school_code, program_id, chapter_id, exam_track)"),
      ["70705", 1, 44, "jee_main", "teacher@avantifellows.org"]
    );
    expect(result).toEqual({
      chapterId: 44,
      active: true,
      completedAt: "2026-02-15T10:00:00.000Z",
      completedByEmail: "teacher@avantifellows.org",
    });
  });

  it("unmarks active Chapter Completion with a soft delete", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await unmarkChapterComplete(
      { query: clientQuery } as never,
      {
        schoolCode: "70705",
        programId: 1,
        chapterId: 44,
        examTrack: "jee_main",
        actorEmail: "teacher@avantifellows.org",
      }
    );

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET deleted_at = (NOW() AT TIME ZONE 'UTC')"),
      ["70705", 1, 44, "jee_main", "teacher@avantifellows.org"]
    );
    expect(result).toEqual({
      chapterId: 44,
      active: false,
      completedAt: null,
      completedByEmail: null,
    });
  });
});
