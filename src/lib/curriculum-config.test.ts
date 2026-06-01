import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetUserPermission,
  mockQuery,
  mockCheckCurriculumConfigManagementSchema,
} = vi.hoisted(() => ({
  mockGetUserPermission: vi.fn(),
  mockQuery: vi.fn(),
  mockCheckCurriculumConfigManagementSchema: vi.fn(),
}));

vi.mock("./permissions", () => ({
  getUserPermission: mockGetUserPermission,
}));
vi.mock("./db", () => ({ query: mockQuery }));
vi.mock("./curriculum-schema", () => ({
  checkCurriculumConfigManagementSchema: mockCheckCurriculumConfigManagementSchema,
}));

import {
  getCurriculumConfigList,
  mapCurriculumConfigRow,
  normalizeCurriculumConfigListParams,
  requireCurriculumConfigAdmin,
} from "./curriculum-config";

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
};

describe("curriculum config admin guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it.each([
    {
      label: "no session",
      session: null,
      permission: null,
      expected: { ok: false, status: 401, error: "Unauthorized" },
    },
    {
      label: "passcode user",
      session: {
        user: { email: "passcode-70705@school.local" },
        isPasscodeUser: true,
      },
      permission: null,
      expected: { ok: false, status: 403, error: "Forbidden" },
    },
    {
      label: "PM",
      session: { user: { email: "pm@avantifellows.org" } },
      permission: { ...adminPermission, role: "program_manager" },
      expected: { ok: false, status: 403, error: "Forbidden" },
    },
    {
      label: "Program Admin",
      session: { user: { email: "program-admin@avantifellows.org" } },
      permission: { ...adminPermission, role: "program_admin" },
      expected: { ok: false, status: 403, error: "Forbidden" },
    },
    {
      label: "teacher",
      session: { user: { email: "teacher@avantifellows.org" } },
      permission: { ...adminPermission, role: "teacher" },
      expected: { ok: false, status: 403, error: "Forbidden" },
    },
    {
      label: "no permission",
      session: { user: { email: "missing@avantifellows.org" } },
      permission: null,
      expected: { ok: false, status: 403, error: "Forbidden" },
    },
  ])("denies $label", async ({ session, permission, expected }) => {
    mockGetUserPermission.mockResolvedValue(permission);

    await expect(requireCurriculumConfigAdmin(session)).resolves.toEqual(expected);
  });

  it("allows Google-authenticated admins", async () => {
    mockGetUserPermission.mockResolvedValue(adminPermission);

    await expect(
      requireCurriculumConfigAdmin({
        user: { email: "admin@avantifellows.org" },
      })
    ).resolves.toEqual({
      ok: true,
      email: "admin@avantifellows.org",
      permission: adminPermission,
    });
  });
});

describe("curriculum config list helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("normalizes default, invalid, and supported list filters safely", () => {
    expect(normalizeCurriculumConfigListParams({})).toEqual({
      filters: {
        examTrack: "jee_main",
        grade: null,
        subject: null,
        search: "",
        syllabusStatus: "in_syllabus",
      },
      page: 1,
      limit: 50,
      sort: "curriculum",
      dir: "asc",
    });

    expect(
      normalizeCurriculumConfigListParams({
        exam_track: "bad",
        grade: "NaN",
        subject: " ",
        search: "  Work & Energy  ",
        syllabus_status: "deleted",
        page: "0",
        limit: "999",
        sort: "drop table",
        dir: "sideways",
      })
    ).toEqual({
      filters: {
        examTrack: "jee_main",
        grade: null,
        subject: null,
        search: "Work & Energy",
        syllabusStatus: "in_syllabus",
      },
      page: 1,
      limit: 50,
      sort: "curriculum",
      dir: "asc",
    });

    expect(
      normalizeCurriculumConfigListParams({
        exam_track: "neet",
        grade: "12",
        subject: "Biology",
        syllabus_status: "all",
        page: "3",
        limit: "100",
        sort: "updated_at",
        dir: "desc",
      })
    ).toMatchObject({
      filters: {
        examTrack: "neet",
        grade: 12,
        subject: "Biology",
        syllabusStatus: "all",
      },
      page: 3,
      limit: 100,
      sort: "updated_at",
      dir: "desc",
    });
  });

  it("maps config rows with stable ids, display fields, and blank audit values", () => {
    expect(
      mapCurriculumConfigRow({
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
      })
    ).toEqual({
      id: 42,
      chapterId: 7,
      chapterCode: "PHY-01",
      chapterName: "Motion",
      grade: 11,
      subjectId: 4,
      subjectName: "Physics",
      examTrack: "jee_main",
      isInSyllabus: true,
      syllabusStatus: "in_syllabus",
      prescribedMinutes: 90,
      prescribedHours: 1.5,
      prescribedHoursLabel: "1h 30m",
      coverageSequence: 2,
      updatedByEmail: "",
      updatedAt: "",
    });
  });

  it("maps plain localized SQL name strings without falling back to codes", () => {
    expect(
      mapCurriculumConfigRow({
        config_id: 1,
        chapter_id: 90007501,
        chapter_code: "LMS75-PH01",
        chapter_name: "Fixture Alpha Physics",
        grade: 11,
        subject_id: 4,
        subject_name: "Physics",
        exam_track: "jee_main",
        is_in_syllabus: true,
        prescribed_minutes: 90,
        coverage_sequence: 1,
        updated_by_email: "e2e@avantifellows.org",
        updated_at: "2026-06-01T17:46:24.000Z",
      })
    ).toMatchObject({
      chapterName: "Fixture Alpha Physics",
      subjectName: "Physics",
    });
  });

  it("returns filtered config rows, options, pagination, and deterministic list SQL", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          grades: [11, 12],
          subjects: [{ id: 4, name: [{ lang_code: "en", subject: "Physics" }] }],
          exam_tracks: ["jee_main", "neet"],
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
          updated_by_email: "admin@avantifellows.org",
          updated_at: "2026-05-30T10:00:00.000Z",
        },
      ]);

    await expect(
      getCurriculumConfigList(
        normalizeCurriculumConfigListParams({
          search: "motion",
          page: "2",
          limit: "10",
        })
      )
    ).resolves.toMatchObject({
      ok: true,
      totalRowCount: 1,
      currentPage: 1,
      totalPages: 1,
      filterOptions: {
        grades: [11, 12],
        subjects: [{ id: 4, name: "Physics" }],
        examTracks: ["jee_main", "neet"],
        syllabusStatuses: ["in_syllabus", "out_of_syllabus", "all"],
      },
      rows: [
        {
          id: 42,
          chapterId: 7,
          chapterCode: "PHY-01",
          chapterName: "Motion",
          examTrack: "jee_main",
          prescribedHoursLabel: "1h 30m",
        },
      ],
    });

    const rowsSql = mockQuery.mock.calls[2][0] as string;
    expect(rowsSql).toContain(
      "ORDER BY exam_track ASC, grade ASC, subject_name ASC, coverage_sequence ASC, chapter_code ASC, chapter_name ASC"
    );
    expect(rowsSql).not.toContain("school_code");
    expect(rowsSql).not.toContain("program_id");
  });

  it("returns config-management schema unavailable results without querying rows", async () => {
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });

    await expect(
      getCurriculumConfigList(normalizeCurriculumConfigListParams({}))
    ).resolves.toEqual({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
