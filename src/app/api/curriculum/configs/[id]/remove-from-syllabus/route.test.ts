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

import { POST } from "./route";
import {
  ADMIN_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
  jsonRequest,
  routeParams,
} from "../../../../__test-utils__/api-test-helpers";

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
};

describe("POST /api/curriculum/configs/[id]/remove-from-syllabus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("returns 401, 403, and controlled 503 before mutation", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    expect(
      (
        await POST(
          jsonRequest(
            "http://localhost/api/curriculum/configs/42/remove-from-syllabus",
            { method: "POST" }
          ) as NextRequest,
          routeParams({ id: "42" })
        )
      ).status
    ).toBe(401);

    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect(
      (
        await POST(
          jsonRequest(
            "http://localhost/api/curriculum/configs/42/remove-from-syllabus",
            { method: "POST" }
          ) as NextRequest,
          routeParams({ id: "42" })
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
        await POST(
          jsonRequest(
            "http://localhost/api/curriculum/configs/42/remove-from-syllabus",
            { method: "POST" }
          ) as NextRequest,
          routeParams({ id: "42" })
        )
      ).status
    ).toBe(403);

    mockCheckCurriculumConfigManagementSchema.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });
    const res = await POST(
      jsonRequest("http://localhost/api/curriculum/configs/42/remove-from-syllabus", {
        method: "POST",
        body: { updated_at: "2026-05-30T10:00:00.000Z" },
      }) as NextRequest,
      routeParams({ id: "42" })
    );
    expect(res.status).toBe(503);
  });

  it("returns 409 for stale rows and 422 for already-out-of-syllabus rows", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        failure_reason: "stale",
        config_id: null,
        chapter_id: null,
        chapter_code: null,
        chapter_name: null,
        grade: null,
        subject_id: null,
        subject_name: null,
        exam_track: null,
        is_in_syllabus: null,
        prescribed_minutes: null,
        coverage_sequence: null,
        updated_by_email: null,
        updated_at: null,
      },
    ]);

    const stale = await POST(
      jsonRequest("http://localhost/api/curriculum/configs/42/remove-from-syllabus", {
        method: "POST",
        body: { updated_at: "2026-05-30T10:00:00.000Z" },
      }) as NextRequest,
      routeParams({ id: "42" })
    );
    expect(stale.status).toBe(409);

    mockQuery.mockResolvedValueOnce([
      {
        failure_reason: "already_out_of_syllabus",
        config_id: null,
        chapter_id: null,
        chapter_code: null,
        chapter_name: null,
        grade: null,
        subject_id: null,
        subject_name: null,
        exam_track: null,
        is_in_syllabus: null,
        prescribed_minutes: null,
        coverage_sequence: null,
        updated_by_email: null,
        updated_at: null,
      },
    ]);

    const alreadyOut = await POST(
      jsonRequest("http://localhost/api/curriculum/configs/42/remove-from-syllabus", {
        method: "POST",
        body: { updated_at: "2026-05-30T10:00:00.000Z" },
      }) as NextRequest,
      routeParams({ id: "42" })
    );
    expect(alreadyOut.status).toBe(422);
    await expect(alreadyOut.json()).resolves.toMatchObject({
      fields: {
        is_in_syllabus: "Curriculum Config row is already out of syllabus",
      },
    });
  });

  it("returns the removed row and impact counts for successful admin removals", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          failure_reason: null,
          config_id: "42",
          chapter_id: "7",
          chapter_code: "PHY-01",
          chapter_name: "Motion",
          grade: "11",
          subject_id: "4",
          subject_name: "Physics",
          exam_track: "jee_main",
          is_in_syllabus: false,
          prescribed_minutes: "0",
          coverage_sequence: "3",
          updated_by_email: "admin@avantifellows.org",
          updated_at: "2026-06-01T12:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          expected_summary_rows: "12",
          active_curriculum_logs: "2",
          active_chapter_completions: "5",
          duplicate_coverage_count: "0",
        },
      ]);

    const res = await POST(
      jsonRequest("http://localhost/api/curriculum/configs/42/remove-from-syllabus", {
        method: "POST",
        body: { updated_at: "2026-05-30T10:00:00.000Z" },
      }) as NextRequest,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      row: {
        id: 42,
        isInSyllabus: false,
        prescribedMinutes: 0,
        coverageSequence: 3,
      },
      impact: {
        expectedSummaryRows: 12,
        activeCurriculumLogs: 2,
        activeChapterCompletions: 5,
      },
      warnings: [],
    });
  });
});
