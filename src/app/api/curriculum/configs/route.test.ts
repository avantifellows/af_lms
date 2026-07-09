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
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mockGetUserPermission,
  PROGRAM_IDS: { COE: 1, NODAL: 2 },
  COE_NODAL_PROGRAM_IDS: [1, 2, 74, 94, 78],
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/curriculum-schema", () => ({
  checkCurriculumConfigManagementSchema: mockCheckCurriculumConfigManagementSchema,
}));

import { GET, POST } from "./route";
import {
  ADMIN_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
} from "../../__test-utils__/api-test-helpers";

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

describe("GET /api/curriculum/configs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("returns 401 for unauthenticated users", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET(nextReq("/api/curriculum/configs"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for passcode and non-admin Google users", async () => {
    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect((await GET(nextReq("/api/curriculum/configs"))).status).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_manager",
    });
    expect((await GET(nextReq("/api/curriculum/configs"))).status).toBe(403);
  });

  it("returns controlled 503 when config-management schema is unavailable", async () => {
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });

    const res = await GET(nextReq("/api/curriculum/configs"));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });
  });

  it("returns admin list results with normalized filters and pagination", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          grades: [11, 12],
          subjects: [{ id: 4, name: [{ lang_code: "en", subject: "Physics" }] }],
          exam_tracks: ["jee_main", "neet"],
          chapters: [
            {
              id: 7,
              code: "PHY-01",
              name: [{ lang_code: "en", chapter: "Motion" }],
              grade: 11,
              subjectName: [{ lang_code: "en", subject: "Physics" }],
            },
          ],
        },
      ])
      .mockResolvedValueOnce([{ total_count: "1" }])
      .mockResolvedValueOnce([
        {
          config_id: "42",
          chapter_id: "7",
          chapter_code: "PHY-01",
          chapter_name: [{ lang_code: "en", chapter: "Motion" }],
          grade: "11",
          subject_id: "4",
          subject_name: [{ lang_code: "en", subject: "Physics" }],
          exam_track: "jee_main",
          is_in_syllabus: true,
          prescribed_minutes: "90",
          coverage_sequence: "2",
          updated_by_email: null,
          updated_at: null,
        },
      ]);

    const res = await GET(
      nextReq(
        "/api/curriculum/configs?exam_track=bad&grade=abc&subject=&search=Motion&chapter_id=7&syllabus_status=all&page=2&limit=10&sort=unknown&dir=desc&school=LMS75&program=2"
      )
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      filters: {
        examTrack: "jee_main",
        grade: null,
        subject: null,
        search: "Motion",
        chapterId: 7,
        syllabusStatus: "all",
      },
      pagination: {
        page: 1,
        limit: 10,
        totalRows: 1,
        totalPages: 1,
      },
      sort: { sort: "curriculum", dir: "desc" },
      filterOptions: {
        grades: [11, 12],
        subjects: [{ id: 4, name: "Physics" }],
        examTracks: ["jee_main", "neet"],
        chapters: [{ id: 7, code: "PHY-01", name: "Motion", grade: 11, subjectName: "Physics" }],
      },
      rows: [{ id: 42, updatedByEmail: "", updatedAt: "" }],
    });
    expect(json.filters).not.toHaveProperty("school");
    expect(json.filters).not.toHaveProperty("program");
  });
});

describe("POST /api/curriculum/configs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("returns 401, 403, and controlled 503 before admin create", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    expect(
      (
        await POST(
          new NextRequest("http://localhost/api/curriculum/configs", {
            method: "POST",
          })
        )
      ).status
    ).toBe(401);

    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect(
      (
        await POST(
          new NextRequest("http://localhost/api/curriculum/configs", {
            method: "POST",
          })
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
          new NextRequest("http://localhost/api/curriculum/configs", {
            method: "POST",
          })
        )
      ).status
    ).toBe(403);

    mockCheckCurriculumConfigManagementSchema.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });
    const unavailable = await POST(
      new NextRequest("http://localhost/api/curriculum/configs", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(unavailable.status).toBe(503);
  });

  it("returns 422 for invalid create values and 409 for duplicate chapter track pairs", async () => {
    const invalid = await POST(
      new NextRequest("http://localhost/api/curriculum/configs", {
        method: "POST",
        body: JSON.stringify({
          chapter_id: 7,
          exam_track: "jee_main",
          is_in_syllabus: false,
          prescribed_minutes: 60,
          coverage_sequence: 2,
        }),
      })
    );
    expect(invalid.status).toBe(422);
    expect(mockQuery).not.toHaveBeenCalled();

    mockQuery.mockResolvedValueOnce([
      {
        failure_reason: "duplicate",
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
    const duplicate = await POST(
      new NextRequest("http://localhost/api/curriculum/configs", {
        method: "POST",
        body: JSON.stringify({
          chapter_id: 7,
          exam_track: "jee_main",
          is_in_syllabus: true,
          prescribed_minutes: 60,
          coverage_sequence: 2,
        }),
      })
    );
    expect(duplicate.status).toBe(409);
  });

  it("returns the created row, impact counts, and warnings for successful admin creates", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          failure_reason: null,
          config_id: "50",
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

    const res = await POST(
      new NextRequest("http://localhost/api/curriculum/configs", {
        method: "POST",
        body: JSON.stringify({
          chapter_id: 7,
          exam_track: "jee_main",
          is_in_syllabus: true,
          prescribed_minutes: 0,
          coverage_sequence: 2,
        }),
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      row: { id: 50, prescribedMinutes: 0, coverageSequence: 2 },
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
