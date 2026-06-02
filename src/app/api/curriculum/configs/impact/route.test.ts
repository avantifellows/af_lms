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

describe("GET /api/curriculum/configs/impact", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("returns 401, 403, and controlled 503 before returning admin impact counts", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    expect(
      (await GET(nextReq("/api/curriculum/configs/impact?chapter_id=7&exam_track=jee_main"))).status
    ).toBe(401);

    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect(
      (await GET(nextReq("/api/curriculum/configs/impact?chapter_id=7&exam_track=jee_main"))).status
    ).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_manager",
    });
    expect(
      (await GET(nextReq("/api/curriculum/configs/impact?chapter_id=7&exam_track=jee_main"))).status
    ).toBe(403);

    mockCheckCurriculumConfigManagementSchema.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });
    const unavailable = await GET(
      nextReq("/api/curriculum/configs/impact?chapter_id=7&exam_track=jee_main")
    );
    expect(unavailable.status).toBe(503);

    mockQuery.mockResolvedValueOnce([
      {
        expected_summary_rows: "12",
        active_curriculum_logs: "3",
        active_chapter_completions: "4",
        duplicate_coverage_count: "0",
      },
    ]);
    const res = await GET(
      nextReq("/api/curriculum/configs/impact?chapter_id=7&exam_track=jee_main")
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      counts: {
        expectedSummaryRows: 12,
        activeCurriculumLogs: 3,
        activeChapterCompletions: 4,
      },
      warnings: [],
    });
  });
});
