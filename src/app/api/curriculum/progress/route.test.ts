import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
  PROGRAM_IDS: { COE: 1, NODAL: 2, NVS: 64 },
  getFeatureAccess: vi.fn(),
  getUserPermission: vi.fn(),
  canAccessSchoolSync: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import { GET } from "./route";
import {
  PASSCODE_SESSION,
  TEACHER_SESSION,
} from "../../__test-utils__/api-test-helpers";
import { resetCurriculumSchemaCheckForTests } from "@/lib/curriculum-schema";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockGetUserPermission = vi.mocked(getUserPermission);
const mockGetFeatureAccess = vi.mocked(getFeatureAccess);
const mockCanAccessSchoolSync = vi.mocked(canAccessSchoolSync);

function nextReq(url: string) {
  return new NextRequest(new URL(url, "http://localhost"));
}

describe("GET /api/curriculum/progress", () => {
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
  });

  it("returns backend Curriculum Progress from bounded queries with direct subject total", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ subject_total_time_minutes: "1" }])
      .mockResolvedValueOnce([
        {
          chapter_id: 1,
          topic_id: 101,
          log_id: 10,
          log_date: "2026-02-15",
          duration_minutes: 1,
          total_topics_in_log: 2,
        },
        {
          chapter_id: 2,
          topic_id: 201,
          log_id: 10,
          log_date: "2026-02-15",
          duration_minutes: 1,
          total_topics_in_log: 2,
        },
        {
          chapter_id: 2,
          topic_id: 202,
          log_id: null,
          log_date: null,
          duration_minutes: null,
          total_topics_in_log: null,
        },
      ])
      .mockResolvedValueOnce([
        { chapter_id: 1, completed_at: "2026-02-16T00:00:00.000Z" },
      ]);

    const res = await GET(
      nextReq(
        "/api/curriculum/progress?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      subjectTotalTimeMinutes: 1,
      progress: {
        "1": {
          chapterId: 1,
          completedTopicIds: [101],
          totalTimeMinutes: 1,
          lastTaughtDate: "2026-02-15",
          allTopicsCovered: true,
          isChapterComplete: true,
          chapterCompletedDate: "2026-02-16T00:00:00.000Z",
        },
        "2": {
          chapterId: 2,
          completedTopicIds: [201],
          totalTimeMinutes: 1,
          lastTaughtDate: "2026-02-15",
          allTopicsCovered: false,
          isChapterComplete: false,
          chapterCompletedDate: null,
        },
      },
    });
    expect(mockQuery).toHaveBeenCalledTimes(6);
    expect(mockQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("AND deleted_at IS NULL"),
      ["70705", 1, 3, 4, "jee_main"]
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("AND l.deleted_at IS NULL"),
      ["70705", 1, 3, 4, "jee_main", 11, 1]
    );
  });

  it("includes configured topicless chapters when loading Chapter Completion state", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([{ subject_total_time_minutes: "0" }])
      .mockResolvedValueOnce([
        {
          chapter_id: 3,
          topic_id: null,
          log_id: null,
          log_date: null,
          duration_minutes: null,
          total_topics_in_log: null,
        },
      ])
      .mockResolvedValueOnce([
        { chapter_id: 3, completed_at: "2026-02-17T00:00:00.000Z" },
      ]);

    const res = await GET(
      nextReq(
        "/api/curriculum/progress?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      subjectTotalTimeMinutes: 0,
      progress: {
        "3": {
          chapterId: 3,
          completedTopicIds: [],
          totalTimeMinutes: 0,
          lastTaughtDate: null,
          allTopicsCovered: false,
          isChapterComplete: true,
          chapterCompletedDate: "2026-02-17T00:00:00.000Z",
        },
      },
    });
    expect(mockQuery).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("JOIN topic_curriculum topic_scope"),
      ["70705", 1, 3, 4, "jee_main", 11, 1]
    );
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);

    const res = await GET(
      nextReq(
        "/api/curriculum/progress?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      )
    );

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
