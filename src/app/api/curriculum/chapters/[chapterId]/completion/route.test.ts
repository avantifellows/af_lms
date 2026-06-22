import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/permissions", () => {
  const getUserPermission = vi.fn();
  return {
    PROGRAM_IDS: { COE: 1, NODAL: 2, NVS: 64 },
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
} from "../../../../__test-utils__/api-test-helpers";
import { resetCurriculumSchemaCheckForTests } from "@/lib/curriculum-schema";
import { PUT } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const mockGetUserPermission = vi.mocked(getUserPermission);
const mockGetFeatureAccess = vi.mocked(getFeatureAccess);
const mockCanAccessSchoolSync = vi.mocked(canAccessSchoolSync);

function jsonReq(body: unknown) {
  return new NextRequest(
    new URL("/api/curriculum/chapters/44/completion", "http://localhost"),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
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

describe("PUT /api/curriculum/chapters/[chapterId]/completion", () => {
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

  it("marks one in-syllabus chapter complete without creating an LMS Curriculum Log", async () => {
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
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        { chapter_id: 44, is_in_syllabus: true, active_completed_at: null },
      ]);

    const res = await PUT(
      jsonReq({
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        completed: true,
      }),
      routeParams({ chapterId: "44" })
    );

    expect(res.status).toBe(200);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO lms_curriculum_chapter_completions"),
      ["70705", 1, 44, "jee_main", "teacher@avantifellows.org"]
    );
    expect(
      clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO lms_curriculum_logs")
      )
    ).toBe(false);
    await expect(res.json()).resolves.toEqual({
      chapterId: 44,
      active: true,
      completedAt: "2026-02-15T10:00:00.000Z",
      completedByEmail: "teacher@avantifellows.org",
    });
  });

  it("allows unmarking an out-of-syllabus chapter with no active completion", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        { chapter_id: 44, is_in_syllabus: false, active_completed_at: null },
      ]);

    const res = await PUT(
      jsonReq({
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        completed: false,
      }),
      routeParams({ chapterId: "44" })
    );

    expect(res.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE lms_curriculum_chapter_completions"),
      ["70705", 1, 44, "jee_main", "teacher@avantifellows.org"]
    );
    await expect(res.json()).resolves.toEqual({
      chapterId: 44,
      active: false,
      completedAt: null,
      completedByEmail: null,
    });
  });

  it("rejects a path chapter outside the selected Grade and Subject", async () => {
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: vi.fn() } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([]);

    const res = await PUT(
      jsonReq({
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        completed: true,
      }),
      routeParams({ chapterId: "44" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Chapter does not belong to the selected Grade and Subject",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects passcode users before mutating Chapter Completion", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);

    const res = await PUT(
      jsonReq({
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        completed: true,
      }),
      routeParams({ chapterId: "44" })
    );

    expect(res.status).toBe(403);
    expect(mockGetUserPermission).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects users without Curriculum edit access", async () => {
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await PUT(
      jsonReq({
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        completed: true,
      }),
      routeParams({ chapterId: "44" })
    );

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-program completion mutations", async () => {
    mockGetUserPermission.mockResolvedValue({
      ...teacherPermission,
      program_ids: [2],
    });
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ code: "70705", region: "North" }])
      .mockResolvedValueOnce([{ id: 2, name: "JNV Nodal" }]);

    const res = await PUT(
      jsonReq({
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        completed: true,
      }),
      routeParams({ chapterId: "44" })
    );

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects marking an out-of-syllabus chapter complete", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        { chapter_id: 44, is_in_syllabus: false, active_completed_at: null },
      ]);

    const res = await PUT(
      jsonReq({
        school_code: "70705",
        program_id: 1,
        exam_track: "jee_main",
        grade: 11,
        subject: "Physics",
        completed: true,
      }),
      routeParams({ chapterId: "44" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Chapter is not in syllabus for the selected Exam Track",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
