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
  PROGRAM_IDS: { COE: 1, NODAL: 2 },
}));
vi.mock("./db", () => ({ query: mockQuery }));
vi.mock("./curriculum-schema", () => ({
  checkCurriculumConfigManagementSchema: mockCheckCurriculumConfigManagementSchema,
}));

import {
  createCurriculumConfigRow,
  editCurriculumConfigRow,
  getCurriculumConfigChapterOptions,
  getCurriculumConfigExport,
  getCurriculumConfigImpact,
  normalizeCurriculumConfigEditPayload,
  getCurriculumConfigList,
  mapCurriculumConfigRow,
  normalizeCurriculumConfigListParams,
  removeCurriculumConfigRowFromSyllabus,
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
    {
      label: "read-only admin",
      session: { user: { email: "readonly@avantifellows.org" } },
      permission: { ...adminPermission, read_only: true },
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
        chapterId: null,
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
        chapterId: null,
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
        chapter_id: "89",
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
        chapterId: 89,
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
        lock_token: null,
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
      lockToken: "",
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
        lock_token: "12345",
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
      lockToken: "12345",
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
        chapters: [
          {
            id: 7,
            code: "PHY-01",
            name: "Motion",
            grade: 11,
            subjectName: "Physics",
          },
        ],
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

describe("curriculum config export helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("exports filtered rows as safe CSV while ignoring pagination", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        config_id: "42",
        chapter_id: "7",
        chapter_code: '=PHY-01',
        chapter_name: 'Motion, "fast"',
        grade: "11",
        subject_id: "4",
        subject_name: "Physics",
        exam_track: "jee_main",
        is_in_syllabus: true,
        prescribed_minutes: "90",
        coverage_sequence: "2",
        updated_by_email: null,
        updated_at: null,
      },
      {
        config_id: "43",
        chapter_id: "8",
        chapter_code: "+PHY-02",
        chapter_name: "-Laws",
        grade: "11",
        subject_id: "4",
        subject_name: "@Physics",
        exam_track: "jee_main",
        is_in_syllabus: false,
        prescribed_minutes: "0",
        coverage_sequence: "3",
        updated_by_email: "\tadmin@avantifellows.org",
        updated_at: "\r2026-05-30T10:00:00.000Z",
      },
    ]);

    const result = await getCurriculumConfigExport(
      normalizeCurriculumConfigListParams({
        exam_track: "jee_main",
        grade: "11",
        subject: "4",
        search: " phy ",
        syllabus_status: "all",
        page: "4",
        limit: "10",
        sort: "coverage_sequence",
        dir: "desc",
      }),
      new Date("2026-06-01T08:15:00.000Z")
    );

    expect(result).toEqual({
      ok: true,
      filename: "curriculum-config-2026-06-01.csv",
      csv: [
        "chapter_code,chapter_name,grade,subject,exam_track,is_in_syllabus,prescribed_minutes,prescribed_hours,coverage_sequence,updated_by_email,updated_at",
        "\"'=PHY-01\",\"Motion, \"\"fast\"\"\",11,Physics,jee_main,true,90,1.5,2,,",
        "\"'+PHY-02\",'-Laws,11,'@Physics,jee_main,false,0,0,3,\"'\tadmin@avantifellows.org\",\"'\r2026-05-30T10:00:00.000Z\"",
      ].join("\r\n"),
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "jee_main",
      11,
      "4",
      "%phy%",
      "all",
      null,
    ]);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("ORDER BY coverage_sequence DESC");
    expect(sql).not.toContain("LIMIT $7");
    expect(sql).not.toContain("OFFSET");
  });
});

describe("curriculum config chapter option helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("returns chapter picker rows with topic counts and existing config state", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        chapter_id: "7",
        chapter_code: "PHY-01",
        chapter_name: "Motion",
        grade: "11",
        subject_id: "4",
        subject_name: "Physics",
        topic_count: "0",
        existing_config_id: "42",
        existing_is_in_syllabus: false,
      },
    ]);

    await expect(
      getCurriculumConfigChapterOptions({
        examTrack: "jee_main",
        grade: 11,
        subject: "4",
        search: "motion",
      })
    ).resolves.toEqual({
      ok: true,
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
          existingConfigId: 42,
          configExists: true,
          existingIsInSyllabus: false,
        },
      ],
    });

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("JOIN topic_curriculum tc");
    expect(sql).toContain("tc.curriculum_id = $2");
    expect(sql).toContain("cfg.exam_track = $1");
    expect(sql).toContain("grade = $3::int");
    expect(sql).toContain("subject_id::text = $4::text");
    expect(sql).toContain("LOWER(chapter_name) LIKE $5::text");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "jee_main",
      1,
      11,
      "4",
      "%motion%",
    ]);
  });
});

describe("curriculum config create helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("creates a unique config row with admin audit fields and no log/completion mutation", async () => {
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
          prescribed_minutes: "90",
          coverage_sequence: "2",
          updated_by_email: "admin@avantifellows.org",
          updated_at: "2026-06-01T12:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          expected_summary_rows: "12",
          active_curriculum_logs: "0",
          active_chapter_completions: "0",
          duplicate_coverage_count: "1",
        },
      ]);

    await expect(
      createCurriculumConfigRow({
        adminEmail: "admin@avantifellows.org",
        body: {
          chapter_id: 7,
          exam_track: "jee_main",
          is_in_syllabus: true,
          prescribed_minutes: 90,
          coverage_sequence: 2,
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      row: {
        id: 50,
        chapterId: 7,
        examTrack: "jee_main",
        prescribedMinutes: 90,
        coverageSequence: 2,
        updatedByEmail: "admin@avantifellows.org",
      },
      impact: {
        expectedSummaryRows: 12,
        activeCurriculumLogs: 0,
        activeChapterCompletions: 0,
      },
      warnings: [{ code: "duplicate_coverage_sequence" }],
    });

    const insertSql = mockQuery.mock.calls[0][0] as string;
    expect(insertSql).toContain("INSERT INTO lms_chapter_exam_configs");
    expect(insertSql).toContain("inserted_by_email");
    expect(insertSql).toContain("updated_by_email");
    expect(insertSql).toContain("NOW() AT TIME ZONE 'UTC'");
    expect(insertSql).not.toMatch(/UPDATE\s+lms_curriculum_logs/i);
    expect(insertSql).not.toMatch(/UPDATE\s+lms_curriculum_chapter_completions/i);
    expect(mockQuery.mock.calls[0][1]).toEqual([
      7,
      "jee_main",
      true,
      90,
      2,
      "admin@avantifellows.org",
    ]);
  });

  it("maps database unique-constraint races to duplicate conflicts", async () => {
    mockQuery.mockRejectedValueOnce({ code: "23505" });

    await expect(
      createCurriculumConfigRow({
        adminEmail: "admin@avantifellows.org",
        body: {
          chapter_id: 7,
          exam_track: "jee_main",
          is_in_syllabus: true,
          prescribed_minutes: 90,
          coverage_sequence: 2,
        },
      })
    ).resolves.toEqual({
      ok: false,
      status: 409,
      error: "LMS Chapter Exam Config already exists for this chapter and Exam Track",
    });
  });
});

describe("curriculum config edit helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("rejects immutable identity and unknown edit payload fields before mutation", () => {
    expect(
      normalizeCurriculumConfigEditPayload({
        id: 42,
        chapter_id: 7,
        exam_track: "neet",
        prescribed_minutes: 90,
        coverage_sequence: 3,
        is_in_syllabus: true,
        updated_at: "2026-05-30T10:00:00.000Z",
        extra: "nope",
      })
    ).toEqual({
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config edit payload",
      fields: {
        chapter_id: "Chapter identity is read-only",
        exam_track: "Exam Track is read-only",
        extra: "Field is not editable",
        id: "Config id is read-only",
      },
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns field-level validation errors for invalid editable values", () => {
    expect(
      normalizeCurriculumConfigEditPayload({
        prescribed_minutes: -1,
        coverage_sequence: 0,
        is_in_syllabus: "false",
        updated_at: "",
      })
    ).toEqual({
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config edit payload",
      fields: {
        coverage_sequence: "Coverage order must be positive",
        is_in_syllabus: "Syllabus status is required",
        prescribed_minutes: "Prescribed minutes must be zero or greater",
        updated_at: "Last-seen updated_at is required",
      },
    });

    expect(
      normalizeCurriculumConfigEditPayload({
        prescribed_minutes: 45,
        coverage_sequence: 2,
        is_in_syllabus: false,
        updated_at: "2026-05-30T10:00:00.000Z",
      })
    ).toEqual({
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config edit payload",
      fields: {
        prescribed_minutes:
          "Out-of-syllabus rows must have zero prescribed minutes",
      },
    });
  });

  it("returns impact counts with log-topic chapter joins and soft-delete filters", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        expected_summary_rows: "12",
        active_curriculum_logs: "3",
        active_chapter_completions: "4",
        duplicate_coverage_count: "1",
      },
    ]);

    await expect(
      getCurriculumConfigImpact({
        chapterId: 7,
        examTrack: "jee_main",
        configId: 42,
        isInSyllabus: true,
        prescribedMinutes: 0,
        coverageSequence: 2,
      })
    ).resolves.toEqual({
      ok: true,
      counts: {
        expectedSummaryRows: 12,
        activeCurriculumLogs: 3,
        activeChapterCompletions: 4,
      },
      warnings: [
        {
          code: "duplicate_coverage_sequence",
          message:
            "Another in-syllabus row in the same Grade, Subject, and Exam Track already uses this coverage order.",
        },
        {
          code: "zero_prescribed_minutes",
          message:
            "This in-syllabus row has zero prescribed minutes and will still appear in Curriculum Summary.",
        },
      ],
    });

    const impactSql = mockQuery.mock.calls[0][0] as string;
    expect(impactSql).toContain("JOIN lms_curriculum_log_topics lclt");
    expect(impactSql).toContain("lclt.curriculum_log_id = l.id");
    expect(impactSql).toContain("JOIN topic t ON t.id = lclt.topic_id");
    expect(impactSql).toContain("t.chapter_id = $1");
    expect(impactSql).toContain("l.deleted_at IS NULL");
    expect(impactSql).toContain("cc.deleted_at IS NULL");
    expect(impactSql).not.toContain("l.chapter_id");
  });

  it("updates an existing config row with optimistic concurrency and audit fields only", async () => {
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
          prescribed_minutes: "120",
          coverage_sequence: "3",
          updated_by_email: "admin@avantifellows.org",
          updated_at: "2026-06-01T12:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          expected_summary_rows: "12",
          active_curriculum_logs: "0",
          active_chapter_completions: "0",
          duplicate_coverage_count: "0",
        },
      ]);

    await expect(
      editCurriculumConfigRow({
        id: 42,
        adminEmail: "admin@avantifellows.org",
        body: {
          prescribed_minutes: 120,
          coverage_sequence: 3,
          is_in_syllabus: true,
          updated_at: "2026-05-30T10:00:00.000Z",
          lock_token: "9001",
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      row: {
        id: 42,
        prescribedMinutes: 120,
        coverageSequence: 3,
        updatedByEmail: "admin@avantifellows.org",
      },
      warnings: [],
    });

    const updateSql = mockQuery.mock.calls[0][0] as string;
    expect(updateSql).toContain("UPDATE lms_chapter_exam_configs cfg");
    expect(updateSql).toContain("cfg.xmin::text = $5");
    expect(updateSql).toContain("updated_by_email = $6");
    expect(updateSql).toContain("updated_at = (NOW() AT TIME ZONE 'UTC')");
    expect(updateSql).not.toMatch(/UPDATE\s+lms_curriculum_logs/i);
    expect(updateSql).not.toMatch(/UPDATE\s+lms_curriculum_chapter_completions/i);
    expect(mockQuery.mock.calls[0][1]).toEqual([
      42,
      true,
      120,
      3,
      "9001",
      "admin@avantifellows.org",
    ]);
  });

  it("returns conflict for stale writes and rejects normal in-syllabus removal", async () => {
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

    await expect(
      editCurriculumConfigRow({
        id: 42,
        adminEmail: "admin@avantifellows.org",
        body: {
          prescribed_minutes: 120,
          coverage_sequence: 3,
          is_in_syllabus: true,
          updated_at: "2026-05-30T10:00:00.000Z",
        },
      })
    ).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Curriculum Config row is stale",
    });

    mockQuery.mockResolvedValueOnce([
      {
        failure_reason: "removal_not_allowed",
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

    await expect(
      editCurriculumConfigRow({
        id: 42,
        adminEmail: "admin@avantifellows.org",
        body: {
          prescribed_minutes: 0,
          coverage_sequence: 3,
          is_in_syllabus: false,
          updated_at: "2026-05-30T10:00:00.000Z",
        },
      })
    ).resolves.toEqual({
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config edit payload",
      fields: {
        is_in_syllabus:
          "Use the dedicated remove-from-syllabus flow for in-syllabus rows",
      },
    });
  });
});

describe("curriculum config remove-from-syllabus helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("removes an in-syllabus row with optimistic concurrency, forced zero minutes, preserved order, and audit fields", async () => {
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

    await expect(
      removeCurriculumConfigRowFromSyllabus({
        id: 42,
        adminEmail: "admin@avantifellows.org",
        body: { updated_at: "2026-05-30T10:00:00.000Z", lock_token: "9001" },
      })
    ).resolves.toMatchObject({
      ok: true,
      row: {
        id: 42,
        isInSyllabus: false,
        prescribedMinutes: 0,
        coverageSequence: 3,
        updatedByEmail: "admin@avantifellows.org",
      },
      impact: {
        expectedSummaryRows: 12,
        activeCurriculumLogs: 2,
        activeChapterCompletions: 5,
      },
    });

    const updateSql = mockQuery.mock.calls[0][0] as string;
    expect(updateSql).toContain("UPDATE lms_chapter_exam_configs cfg");
    expect(updateSql).toContain("prescribed_minutes = 0");
    expect(updateSql).not.toContain("coverage_sequence =");
    expect(updateSql).toContain("cfg.id = $1");
    expect(updateSql).toContain("cfg.xmin::text = $2");
    expect(updateSql).toContain("updated_by_email = $3");
    expect(updateSql).toContain("updated_at = (NOW() AT TIME ZONE 'UTC')");
    expect(updateSql).not.toMatch(/UPDATE\s+lms_curriculum_logs/i);
    expect(updateSql).not.toMatch(/UPDATE\s+lms_curriculum_chapter_completions/i);
    expect(mockQuery.mock.calls[0][1]).toEqual([
      42,
      "9001",
      "admin@avantifellows.org",
    ]);
  });

  it("returns a clear validation response when the row is already out of syllabus", async () => {
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

    await expect(
      removeCurriculumConfigRowFromSyllabus({
        id: 42,
        adminEmail: "admin@avantifellows.org",
        body: { updated_at: "2026-05-30T10:00:00.000Z" },
      })
    ).resolves.toEqual({
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config remove payload",
      fields: {
        is_in_syllabus: "Curriculum Config row is already out of syllabus",
      },
    });
  });
});
