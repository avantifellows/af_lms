import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockQuery,
  mockCheckCurriculumConfigManagementSchema,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockQuery: vi.fn(),
  mockCheckCurriculumConfigManagementSchema: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    getUserPermission: mockGetUserPermission,
  };
});
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/curriculum-schema", () => ({
  checkCurriculumConfigManagementSchema: mockCheckCurriculumConfigManagementSchema,
}));

import { GET } from "./route";
import {
  ADMIN_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
} from "../../../__test-utils__/api-test-helpers";

function nextReq(url: string) {
  return new NextRequest(new URL(url, "http://localhost"));
}

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
};

describe("GET /api/curriculum/configs/chapter-options", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("returns 401, 403, and controlled 503 before admin chapter options", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    expect(
      (
        await GET(
          nextReq("/api/curriculum/configs/chapter-options?exam_track=jee_main")
        )
      ).status
    ).toBe(401);

    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect(
      (
        await GET(
          nextReq("/api/curriculum/configs/chapter-options?exam_track=jee_main")
        )
      ).status
    ).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_manager",
    });
    expect(
      (
        await GET(
          nextReq("/api/curriculum/configs/chapter-options?exam_track=jee_main")
        )
      ).status
    ).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_admin",
    });
    expect(
      (
        await GET(
          nextReq("/api/curriculum/configs/chapter-options?exam_track=jee_main")
        )
      ).status
    ).toBe(403);

    mockCheckCurriculumConfigManagementSchema.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });
    const unavailable = await GET(
      nextReq("/api/curriculum/configs/chapter-options?exam_track=jee_main")
    );
    expect(unavailable.status).toBe(503);
  });

  it("returns filtered admin chapter options with topicless warning data", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        chapter_id: "7",
        chapter_code: "PHY-01",
        chapter_name: "Motion",
        grade: "11",
        subject_id: "4",
        subject_name: "Physics",
        topic_count: "0",
        existing_config_id: null,
        existing_is_in_syllabus: null,
      },
    ]);

    const res = await GET(
      nextReq(
        "/api/curriculum/configs/chapter-options?exam_track=jee_main&grade=11&subject=4&search=motion"
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      options: [
        {
          chapterId: 7,
          chapterCode: "PHY-01",
          chapterName: "Motion",
          grade: 11,
          subjectId: 4,
          subjectName: "Physics",
          topicCount: 0,
          hasTopics: false,
          topicWarning: "This chapter has no topics.",
          existingConfigId: null,
          configExists: false,
          existingIsInSyllabus: null,
        },
      ],
      filters: {
        examTrack: "jee_main",
        grade: 11,
        subject: "4",
        search: "motion",
      },
    });
  });
});
