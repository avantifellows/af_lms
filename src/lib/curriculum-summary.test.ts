import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserPermission } from "./permissions";

const { mockQuery, mockCheckCurriculumSchema } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCheckCurriculumSchema: vi.fn(),
}));

vi.mock("./db", () => ({ query: mockQuery }));
vi.mock("./curriculum-schema", () => ({
  checkCurriculumSchema: mockCheckCurriculumSchema,
}));

import {
  buildCommonQueryParams,
  getCurriculumSummary,
  normalizeCurriculumSummaryPageSize,
  normalizeCurriculumSummarySearchParams,
  normalizeCurriculumSummarySort,
} from "./curriculum-summary";

const pmPermission: UserPermission = {
  email: "pm@avantifellows.org",
  level: 3,
  role: "program_manager",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
};

function guardRows(estimatedRows = 1) {
  return [{ estimated_rows: estimatedRows }];
}

describe("curriculum summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCurriculumSchema.mockResolvedValue({ ok: true });
  });

  it("normalizes page size to supported values and defaults to 20", () => {
    expect(normalizeCurriculumSummaryPageSize()).toBe(20);
    expect(normalizeCurriculumSummaryPageSize("20")).toBe(20);
    expect(normalizeCurriculumSummaryPageSize("50")).toBe(50);
    expect(normalizeCurriculumSummaryPageSize("999")).toBe(20);
    expect(normalizeCurriculumSummaryPageSize("abc")).toBe(20);
  });

  it("returns scoped expected rows and filter options with zero placeholder metrics", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          schools: [
            {
              code: "70705",
              name: "JNV Bhavnagar",
              region: "West",
              state: "Gujarat",
              district: "Bhavnagar",
            },
          ],
          programs: [{ id: 1, name: "JNV CoE" }],
          grades: [11],
          subjects: [{ id: 4, name: "Physics" }],
          exam_tracks: ["jee_main"],
          regions: ["West"],
          states: ["Gujarat"],
          districts: ["Bhavnagar"],
        },
      ])
      .mockResolvedValueOnce(guardRows())
      .mockResolvedValueOnce([
        {
          total_rows: 1,
          flagged_rows: 0,
          completed_chapters: 0,
          total_configured_chapters: 0,
          prescribed_chapters: 0,
          actual_minutes: 0,
          prescribed_minutes: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          total_count: 1,
          school_code: "70705",
          school_name: "JNV Bhavnagar",
          region: "West",
          state: "Gujarat",
          district: "Bhavnagar",
          program_id: 1,
          program_name: "JNV CoE",
          grade: 11,
          subject_id: 4,
          subject_name: "Physics",
          exam_track: "jee_main",
          completed_chapters: 0,
          total_configured_chapters: 0,
          prescribed_chapters: 0,
          actual_minutes: 0,
          prescribed_minutes: 0,
          delta_percent: null,
          flagged: false,
          flag_reasons: [],
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams({}, "2026-05-30"),
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(result).toMatchObject({
      ok: true,
      totalRowCount: 1,
      currentPage: 1,
      totalPages: 1,
      stats: {
        totalRows: 1,
        flaggedRows: 0,
        avgCompletionPercent: null,
        avgPrescribedPercent: null,
        actualMinutes: 0,
        prescribedMinutes: 0,
      },
      filterOptions: {
        schools: [{ code: "70705", name: "JNV Bhavnagar" }],
        programs: [{ id: 1, name: "JNV CoE" }],
        grades: [11],
        subjects: [{ id: 4, name: "Physics" }],
        examTracks: ["jee_main"],
        regions: ["West"],
        states: ["Gujarat"],
        districts: ["Bhavnagar"],
      },
      rows: [
        {
          rowKey: "70705:1:11:4:jee_main",
          schoolCode: "70705",
          schoolName: "JNV Bhavnagar",
          programId: 1,
          programName: "JNV CoE",
          grade: 11,
          subjectId: 4,
          subjectName: "Physics",
          examTrack: "jee_main",
          completedChapters: 0,
          totalConfiguredChapters: 0,
          prescribedChapters: 0,
          actualMinutes: 0,
          prescribedMinutes: 0,
          deltaPercent: null,
          flagged: false,
          flagReasons: [],
        },
      ],
    });
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("returns computed metrics and weighted stats for the full filtered set before pagination", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          schools: [],
          programs: [],
          grades: [],
          subjects: [],
          exam_tracks: [],
          regions: [],
          states: [],
          districts: [],
        },
      ])
      .mockResolvedValueOnce(guardRows(2))
      .mockResolvedValueOnce([
        {
          total_rows: 2,
          flagged_rows: 1,
          completed_chapters: 2,
          total_configured_chapters: 6,
          prescribed_chapters: 5,
          actual_minutes: 90,
          prescribed_minutes: 360,
        },
      ])
      .mockResolvedValueOnce([
        {
          total_count: 2,
          school_code: "70705",
          school_name: "JNV Bhavnagar",
          region: "West",
          state: "Gujarat",
          district: "Bhavnagar",
          program_id: 1,
          program_name: "JNV CoE",
          grade: 11,
          subject_id: 4,
          subject_name: "Physics",
          exam_track: "jee_main",
          completed_chapters: 2,
          total_configured_chapters: 2,
          prescribed_chapters: 2,
          actual_minutes: 90,
          prescribed_minutes: 180,
          delta_percent: -50,
          flagged: true,
          flag_reasons: ["under_prescribed_hours"],
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams({}, "2026-05-30"),
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 1,
      todayIstDate: "2026-05-30",
    });

    expect(result).toMatchObject({
      ok: true,
      totalRowCount: 2,
      totalPages: 2,
      stats: {
        totalRows: 2,
        flaggedRows: 1,
        avgCompletionPercent: 33.33333333333333,
        avgPrescribedPercent: 83.33333333333334,
        actualMinutes: 90,
        prescribedMinutes: 360,
      },
      rows: [
        {
          completedChapters: 2,
          totalConfiguredChapters: 2,
          prescribedChapters: 2,
          actualMinutes: 90,
          prescribedMinutes: 180,
          deltaPercent: -50,
          flagged: true,
          flagReasons: ["under_prescribed_hours"],
        },
      ],
    });
  });

  it("keeps zero-prescribed delta blank while surfacing actual-time flag reasons", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          schools: [],
          programs: [],
          grades: [],
          subjects: [],
          exam_tracks: [],
          regions: [],
          states: [],
          districts: [],
        },
      ])
      .mockResolvedValueOnce(guardRows(0))
      .mockResolvedValueOnce([
        {
          total_rows: 1,
          flagged_rows: 1,
          completed_chapters: 0,
          total_configured_chapters: 1,
          prescribed_chapters: 0,
          actual_minutes: 45,
          prescribed_minutes: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          total_count: 1,
          school_code: "70705",
          school_name: "JNV Bhavnagar",
          region: "West",
          state: "Gujarat",
          district: "Bhavnagar",
          program_id: 1,
          program_name: "JNV CoE",
          grade: 11,
          subject_id: 4,
          subject_name: "Physics",
          exam_track: "jee_main",
          completed_chapters: 0,
          total_configured_chapters: 1,
          prescribed_chapters: 0,
          actual_minutes: 45,
          prescribed_minutes: 0,
          delta_percent: null,
          flagged: true,
          flag_reasons: ["actual_time_on_zero_prescribed_minutes"],
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams({}, "2026-05-30"),
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(result).toMatchObject({
      ok: true,
      rows: [
        {
          actualMinutes: 45,
          prescribedMinutes: 0,
          deltaPercent: null,
          flagged: true,
          flagReasons: ["actual_time_on_zero_prescribed_minutes"],
        },
      ],
    });
  });

  it("ignores malformed list and date filters while preserving well-formed values", () => {
    const filters = normalizeCurriculumSummarySearchParams(
      {
        schools: "70705,bad code",
        programs: "1,abc,999",
        grades: "11,nope",
        subjects: "4,-1",
        exam_tracks: "jee_main,stream",
        from: "2026-02-31",
        to: "2026-05-15",
        flagged: "true",
      },
      "2026-05-30"
    );

    expect(filters).toMatchObject({
      schools: ["70705"],
      programs: [1, 999],
      grades: [11],
      subjects: [4],
      examTracks: ["jee_main"],
      preset: "custom",
      from: undefined,
      to: "2026-05-15",
      flagged: true,
      forceEmpty: false,
    });
  });

  it("treats all-date preset as unbounded even when stale date inputs are submitted", () => {
    const filters = normalizeCurriculumSummarySearchParams(
      {
        preset: "all",
        from: "2026-05-01",
        to: "2026-05-30",
      },
      "2026-05-30"
    );

    expect(filters).toMatchObject({
      preset: "all",
      from: undefined,
      to: undefined,
      forceEmpty: false,
    });
  });

  it("normalizes supported sort keys with a safe deterministic default", () => {
    expect(normalizeCurriculumSummarySort(undefined, undefined)).toEqual({
      sort: "flagged",
      dir: "desc",
    });
    expect(normalizeCurriculumSummarySort("completed", "asc")).toEqual({
      sort: "completed",
      dir: "asc",
    });
    expect(normalizeCurriculumSummarySort("prescribed", "desc")).toEqual({
      sort: "prescribed",
      dir: "desc",
    });
    expect(normalizeCurriculumSummarySort("delta", "desc")).toEqual({
      sort: "delta",
      dir: "desc",
    });
    expect(normalizeCurriculumSummarySort("actual", "asc")).toEqual({
      sort: "actual",
      dir: "asc",
    });
    expect(normalizeCurriculumSummarySort("flagged", "asc")).toEqual({
      sort: "flagged",
      dir: "asc",
    });
    expect(
      normalizeCurriculumSummarySort("delta; DROP TABLE school", "asc; DROP")
    ).toEqual({
      sort: "flagged",
      dir: "desc",
    });
    expect(normalizeCurriculumSummarySort("toString", "asc")).toEqual({
      sort: "flagged",
      dir: "asc",
    });
  });

  it("keeps dashboard filter options independent from their own active filters", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          schools: [],
          programs: [],
          grades: [],
          subjects: [],
          exam_tracks: [],
          regions: ["West"],
          states: ["Gujarat"],
          districts: ["Bhavnagar"],
        },
      ])
      .mockResolvedValueOnce(guardRows(0))
      .mockResolvedValueOnce([
        {
          total_rows: 0,
          flagged_rows: 0,
          completed_chapters: 0,
          total_configured_chapters: 0,
          prescribed_chapters: 0,
          actual_minutes: 0,
          prescribed_minutes: 0,
        },
      ])
      .mockResolvedValueOnce([]);

    await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: {
        ...normalizeCurriculumSummarySearchParams(
          { schools: "OUT_OF_SCOPE" },
          "2026-05-30"
        ),
      },
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    const optionsSql = String(mockQuery.mock.calls[0][0]).toLowerCase();
    expect(optionsSql).toContain("from school_options");
    expect(optionsSql).toContain("from program_options");
    expect(optionsSql).toContain("from grade_options");
    expect(optionsSql).toContain("from subject_options");
    expect(optionsSql).toContain("from exam_track_options");
    expect(optionsSql).toContain("from geo_options");
    expect(optionsSql).toContain("subject_filter_option_rows as");
    expect(optionsSql).toContain("exam_track_filter_option_rows as");
    expect(optionsSql).toContain("where ($9::int[] is null or grade = any($9::int[]))");
    expect(optionsSql).toContain(
      "where ($10::int[] is null or subject_id = any($10::int[]))"
    );
    expect(optionsSql).not.toContain("left join filtered_rows on true");
  });

  it("defaults to the current academic year using the injected IST date", () => {
    expect(
      normalizeCurriculumSummarySearchParams({}, "2026-05-30")
    ).toMatchObject({
      preset: "current_academic_year",
      from: "2026-04-01",
      to: "2026-05-30",
    });

    expect(
      normalizeCurriculumSummarySearchParams({}, "2026-02-15")
    ).toMatchObject({
      preset: "current_academic_year",
      from: "2025-04-01",
      to: "2026-02-15",
    });
  });

  it("preserves an invalid custom range and skips the expected-row query", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        schools: [],
        programs: [],
        grades: [],
        subjects: [],
        exam_tracks: [],
        regions: [],
        states: [],
        districts: [],
      },
    ]);

    const result = await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams(
        { from: "2026-05-30", to: "2026-04-01" },
        "2026-05-30"
      ),
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(result).toMatchObject({
      ok: true,
      activeFilters: {
        preset: "custom",
        from: "2026-05-30",
        to: "2026-04-01",
        forceEmpty: true,
      },
      rows: [],
      totalRowCount: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      stats: {
        totalRows: 0,
        flaggedRows: 0,
        avgCompletionPercent: null,
        avgPrescribedPercent: null,
        actualMinutes: 0,
        prescribedMinutes: 0,
      },
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("uses bulk summary SQL without active-student dependencies", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        schools: [],
        programs: [],
        grades: [],
        subjects: [],
        exam_tracks: [],
        regions: [],
        states: [],
        districts: [],
      },
    ]).mockResolvedValueOnce(guardRows(0)).mockResolvedValueOnce([
      {
        total_rows: 0,
        flagged_rows: 0,
        completed_chapters: 0,
        total_configured_chapters: 0,
        prescribed_chapters: 0,
        actual_minutes: 0,
        prescribed_minutes: 0,
      },
    ]).mockResolvedValueOnce([]);

    await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams(
        { from: "2026-05-01", to: "2026-05-30" },
        "2026-05-30"
      ),
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    const combinedSql = mockQuery.mock.calls
      .map(([sql]) => String(sql).toLowerCase())
      .join("\n");
    expect(combinedSql).toContain("cross join configured_rows");
    expect(combinedSql).toContain("join program p on p.id = any($4::int[])");
    expect(combinedSql).toContain("from school_options");
    expect(combinedSql).toContain("from program_options");
    expect(combinedSql).not.toContain("ss.program_ids");
    expect(combinedSql).toContain("lms_curriculum_logs");
    expect(combinedSql).toContain("l.log_date");
    expect(combinedSql).toContain("l.deleted_at is null");
    expect(combinedSql).toContain("lms_curriculum_chapter_completions");
    expect(combinedSql).toContain("cc.deleted_at is null");
    expect(combinedSql).toContain("mr.delta_percent < -10");
    expect(combinedSql).toContain("mr.delta_percent > 10");
    expect(combinedSql).not.toContain("group_user");
    expect(combinedSql).not.toContain("student");
  });

  it("passes date filters and Only flagged into the computed summary queries", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        schools: [],
        programs: [],
        grades: [],
        subjects: [],
        exam_tracks: [],
        regions: [],
        states: [],
        districts: [],
      },
    ]).mockResolvedValueOnce(guardRows(0)).mockResolvedValueOnce([
      {
        total_rows: 0,
        flagged_rows: 0,
        completed_chapters: 0,
        total_configured_chapters: 0,
        prescribed_chapters: 0,
        actual_minutes: 0,
        prescribed_minutes: 0,
      },
    ]).mockResolvedValueOnce([]);

    await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams(
        { from: "2026-05-01", to: "2026-05-30", flagged: "true" },
        "2026-05-30"
      ),
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    const statsCall = mockQuery.mock.calls[2];
    const rowsCall = mockQuery.mock.calls[3];
    expect(statsCall[1].slice(14)).toEqual(["2026-05-01", "2026-05-30", true]);
    expect(rowsCall[1].slice(14, 17)).toEqual([
      "2026-05-01",
      "2026-05-30",
      true,
    ]);
    expect(String(rowsCall[0])).toContain(
      "WHERE ($17::boolean = false OR CARDINALITY(cr.flag_reasons) > 0)"
    );
  });

  it("uses deterministic default sorting before the page slice", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        schools: [],
        programs: [],
        grades: [],
        subjects: [],
        exam_tracks: [],
        regions: [],
        states: [],
        districts: [],
      },
    ]).mockResolvedValueOnce(guardRows(20)).mockResolvedValueOnce([
      {
        total_rows: 20,
        flagged_rows: 2,
        completed_chapters: 0,
        total_configured_chapters: 0,
        prescribed_chapters: 0,
        actual_minutes: 0,
        prescribed_minutes: 0,
      },
    ]).mockResolvedValueOnce([]);

    await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams({}, "2026-05-30"),
      sort: "flagged",
      dir: "desc",
      page: 2,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    const rowsSql = String(mockQuery.mock.calls[3][0]).replace(/\s+/g, " ");
    expect(rowsSql).toContain(
      "ORDER BY flagged DESC, flag_priority ASC, delta_percent ASC NULLS LAST, school_name ASC, program_order ASC, grade ASC, subject_name ASC, exam_track ASC, school_code ASC"
    );
    expect(rowsSql.indexOf("ORDER BY")).toBeLessThan(rowsSql.indexOf("LIMIT $18 OFFSET $19"));
    expect(mockQuery.mock.calls[3][1].slice(-2)).toEqual([10, 10]);
  });

  it("orders manual delta sorts with null delta values last", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        schools: [],
        programs: [],
        grades: [],
        subjects: [],
        exam_tracks: [],
        regions: [],
        states: [],
        districts: [],
      },
    ]).mockResolvedValueOnce(guardRows(2)).mockResolvedValueOnce([
      {
        total_rows: 2,
        flagged_rows: 0,
        completed_chapters: 0,
        total_configured_chapters: 0,
        prescribed_chapters: 0,
        actual_minutes: 0,
        prescribed_minutes: 0,
      },
    ]).mockResolvedValueOnce([]);

    await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams({}, "2026-05-30"),
      sort: "delta",
      dir: "desc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(String(mockQuery.mock.calls[3][0]).replace(/\s+/g, " ")).toContain(
      "ORDER BY delta_percent DESC NULLS LAST, school_name ASC"
    );
  });

  it("stops before detailed summary queries when the expected row guard trips", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          schools: [],
          programs: [],
          grades: [],
          subjects: [],
          exam_tracks: [],
          regions: [],
          states: [],
          districts: [],
        },
      ])
      .mockResolvedValueOnce(guardRows(10001));

    const result = await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams({}, "2026-05-30"),
      sort: "flagged",
      dir: "desc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(result).toMatchObject({
      ok: true,
      rowCountGuardTripped: true,
      estimatedRowCount: 10001,
      rows: [],
      totalRowCount: 0,
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(String(mockQuery.mock.calls[1][0])).toContain("LIMIT 10001");
  });

  it("clamps requested pages before querying the paginated rows", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          schools: [],
          programs: [],
          grades: [],
          subjects: [],
          exam_tracks: [],
          regions: [],
          states: [],
          districts: [],
        },
      ])
      .mockResolvedValueOnce(guardRows(11))
      .mockResolvedValueOnce([
        {
          total_rows: 11,
          flagged_rows: 0,
          completed_chapters: 0,
          total_configured_chapters: 0,
          prescribed_chapters: 0,
          actual_minutes: 0,
          prescribed_minutes: 0,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams({}, "2026-05-30"),
      sort: "school",
      dir: "asc",
      page: 99,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(result).toMatchObject({
      ok: true,
      currentPage: 2,
      totalPages: 2,
    });
    expect(mockQuery.mock.calls[3][1].slice(-2)).toEqual([10, 10]);
  });

  it("loads chapter rows only for the current page top-level rows", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          schools: [],
          programs: [],
          grades: [],
          subjects: [],
          exam_tracks: [],
          regions: [],
          states: [],
          districts: [],
        },
      ])
      .mockResolvedValueOnce(guardRows(12))
      .mockResolvedValueOnce([
        {
          total_rows: 12,
          flagged_rows: 0,
          completed_chapters: 0,
          total_configured_chapters: 0,
          prescribed_chapters: 0,
          actual_minutes: 0,
          prescribed_minutes: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          total_count: 12,
          school_code: "70705",
          school_name: "JNV Bhavnagar",
          region: "West",
          state: "Gujarat",
          district: "Bhavnagar",
          program_id: 1,
          program_name: "JNV CoE",
          grade: 11,
          subject_id: 4,
          subject_name: "Physics",
          exam_track: "jee_main",
          completed_chapters: 0,
          total_configured_chapters: 2,
          prescribed_chapters: 1,
          actual_minutes: 95,
          prescribed_minutes: 90,
          delta_percent: 5.5555555556,
          flagged: false,
          flag_reasons: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          parent_row_key: "70705:1:11:4:jee_main",
          chapter_id: 44,
          chapter_code: "11P1",
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
          coverage_sequence: 2,
          completed_count: 1,
          prescribed_count: 1,
          actual_minutes: 95,
          prescribed_minutes: 90,
          delta_percent: 5.5555555556,
          flagged: false,
          flag_reasons: [],
        },
      ]);

    const result = await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams({}, "2026-05-30"),
      sort: "school",
      dir: "asc",
      page: 2,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(result).toMatchObject({
      ok: true,
      chapterRowsByParentKey: {
        "70705:1:11:4:jee_main": [
          {
            parentRowKey: "70705:1:11:4:jee_main",
            chapterId: 44,
            chapterCode: "11P1",
            chapterName: "Kinematics",
            coverageSequence: 2,
            completedCount: 1,
            prescribedCount: 1,
            actualMinutes: 95,
            prescribedMinutes: 90,
            deltaPercent: 5.5555555556,
            flagged: false,
            flagReasons: [],
          },
        ],
      },
    });
    expect(mockQuery).toHaveBeenCalledTimes(5);
    const chapterSql = String(mockQuery.mock.calls[4][0]).replace(/\s+/g, " ");
    expect(chapterSql).toContain("current_page_rows AS");
    expect(chapterSql.indexOf("LIMIT $18 OFFSET $19")).toBeLessThan(
      chapterSql.lastIndexOf("JOIN lms_chapter_exam_configs cfg")
    );
    expect(chapterSql).toContain("cfg.is_in_syllabus = true");
    expect(chapterSql).toContain(
      "ROUND( duration_minutes::numeric * (topics_in_chapter_for_log::numeric / NULLIF(total_topics_in_log, 0)::numeric) )"
    );
    expect(chapterSql).toContain("cc.deleted_at IS NULL");
    expect(chapterSql).toContain("cmr.delta_percent < -10");
    expect(chapterSql).toContain("cmr.delta_percent > 10");
    expect(chapterSql).toContain("cmr.prescribed_minutes > 0 AND cmr.completed_count = 0");
    expect(chapterSql).toContain("cmr.prescribed_minutes = 0 AND cmr.actual_minutes > 0");
    expect(chapterSql).toContain(
      "ORDER BY page_row_order ASC, coverage_sequence ASC NULLS LAST, chapter_code ASC, chapter_sort_name ASC, chapter_id ASC"
    );
    expect(mockQuery.mock.calls[4][1].slice(-2)).toEqual([10, 10]);
  });
});

describe("buildCommonQueryParams (seat-aware scope)", () => {
  const emptyFilters = normalizeCurriculumSummarySearchParams({}, "2026-06-13");

  it("passes the resolved scope set (explicit ∪ seats) as the level-1 school param ($2)", () => {
    const params = buildCommonQueryParams(
      {
        ...pmPermission,
        level: 1,
        role: "teacher",
        school_codes: ["70705"],
        scope: { schools: new Set(["70705", "99999"]), centres: new Set([5]), programs: new Set([1]) },
      },
      emptyFilters
    );
    expect(params[0]).toBe(false); // $1: level === 3
    expect(new Set(params[1] as string[])).toEqual(new Set(["70705", "99999"])); // $2
    expect(params[2]).toBeNull(); // $3: regions
  });

  it("falls back to raw school_codes for level 1 when scope is unresolved", () => {
    const params = buildCommonQueryParams(
      { ...pmPermission, level: 1, role: "teacher", school_codes: ["70705"], regions: null },
      emptyFilters
    );
    expect(params[1]).toEqual(["70705"]);
  });

  it("includes level-2 seat schools in $2 while regions flow through $3", () => {
    const params = buildCommonQueryParams(
      {
        ...pmPermission,
        level: 2,
        role: "admin",
        school_codes: null,
        regions: ["West"],
        scope: { schools: new Set(["55555"]), centres: new Set([9]), programs: new Set([1]) },
      },
      emptyFilters
    );
    expect(params[1]).toEqual(["55555"]); // $2 seat schools
    expect(params[2]).toEqual(["West"]); // $3 regions
  });
});
