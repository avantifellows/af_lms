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

import { PATCH } from "./route";
import {
  ADMIN_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
  jsonRequest,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
};

describe("PATCH /api/curriculum/configs/[id]", () => {
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
        await PATCH(
          jsonRequest("http://localhost/api/curriculum/configs/42", { method: "PATCH" }) as NextRequest,
          routeParams({ id: "42" })
        )
      ).status
    ).toBe(401);

    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect(
      (
        await PATCH(
          jsonRequest("http://localhost/api/curriculum/configs/42", { method: "PATCH" }) as NextRequest,
          routeParams({ id: "42" })
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
        await PATCH(
          jsonRequest("http://localhost/api/curriculum/configs/42", { method: "PATCH" }) as NextRequest,
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
    const res = await PATCH(
      jsonRequest("http://localhost/api/curriculum/configs/42", { method: "PATCH" }) as NextRequest,
      routeParams({ id: "42" })
    );
    expect(res.status).toBe(503);
  });

  it("returns 422 for immutable identity edits and 409 for stale writes", async () => {
    const invalid = await PATCH(
      jsonRequest("http://localhost/api/curriculum/configs/42", {
        method: "PATCH",
        body: {
          id: 43,
          chapter_id: 7,
          exam_track: "neet",
          prescribed_minutes: 60,
          coverage_sequence: 2,
          is_in_syllabus: true,
          updated_at: "2026-05-30T10:00:00.000Z",
        },
      }) as NextRequest,
      routeParams({ id: "42" })
    );
    expect(invalid.status).toBe(422);
    expect(mockQuery).not.toHaveBeenCalled();

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
    const stale = await PATCH(
      jsonRequest("http://localhost/api/curriculum/configs/42", {
        method: "PATCH",
        body: {
          prescribed_minutes: 60,
          coverage_sequence: 2,
          is_in_syllabus: true,
          updated_at: "2026-05-30T10:00:00.000Z",
        },
      }) as NextRequest,
      routeParams({ id: "42" })
    );
    expect(stale.status).toBe(409);
  });

  it("returns the saved row, impact counts, and warnings for successful admin edits", async () => {
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
          is_in_syllabus: true,
          prescribed_minutes: "0",
          coverage_sequence: "2",
          updated_by_email: "admin@avantifellows.org",
          updated_at: "2026-06-01T12:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          expected_summary_rows: "12",
          active_curriculum_logs: "3",
          active_chapter_completions: "4",
          duplicate_coverage_count: "1",
        },
      ]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/curriculum/configs/42", {
        method: "PATCH",
        body: {
          prescribed_minutes: 0,
          coverage_sequence: 2,
          is_in_syllabus: true,
          updated_at: "2026-05-30T10:00:00.000Z",
        },
      }) as NextRequest,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      row: { id: 42, prescribedMinutes: 0, coverageSequence: 2 },
      impact: {
        expectedSummaryRows: 12,
        activeCurriculumLogs: 3,
        activeChapterCompletions: 4,
      },
      warnings: [
        { code: "duplicate_coverage_sequence" },
        { code: "zero_prescribed_minutes" },
      ],
    });
  });
});
