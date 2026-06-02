import { checkCurriculumSchema, type CurriculumSchemaUnavailable } from "./curriculum-schema";
import { query } from "./db";
import { PROGRAM_IDS, type UserPermission } from "./permissions";
import type { ExamTrack } from "@/types/curriculum";

export type CurriculumSummarySortKey =
  | "school"
  | "program"
  | "grade"
  | "subject"
  | "exam_track"
  | "completed"
  | "prescribed"
  | "delta"
  | "actual"
  | "flagged";
export type CurriculumSummarySortDirection = "asc" | "desc";
export type CurriculumSummaryDatePreset =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "current_academic_year"
  | "all"
  | "custom";

export interface CurriculumSummaryFilters {
  schools: string[];
  programs: number[];
  grades: number[];
  subjects: number[];
  examTracks: ExamTrack[];
  regions: string[];
  states: string[];
  districts: string[];
  preset: CurriculumSummaryDatePreset;
  from?: string;
  to?: string;
  flagged: boolean;
  forceEmpty: boolean;
}

export interface CurriculumSummaryParams {
  actorEmail: string;
  permission: UserPermission;
  filters: CurriculumSummaryFilters;
  sort: CurriculumSummarySortKey;
  dir: CurriculumSummarySortDirection;
  page: number;
  pageSize: number;
  todayIstDate: string;
}

export interface CurriculumSummarySchoolOption {
  code: string;
  name: string;
  region: string | null;
  state: string | null;
  district: string | null;
}

export interface CurriculumSummaryProgramOption {
  id: number;
  name: string;
}

export interface CurriculumSummarySubjectOption {
  id: number;
  name: string;
}

export interface CurriculumSummaryFilterOptions {
  schools: CurriculumSummarySchoolOption[];
  programs: CurriculumSummaryProgramOption[];
  grades: number[];
  subjects: CurriculumSummarySubjectOption[];
  examTracks: ExamTrack[];
  regions: string[];
  states: string[];
  districts: string[];
}

export interface CurriculumSummaryStats {
  totalRows: number;
  flaggedRows: number;
  avgCompletionPercent: number | null;
  avgPrescribedPercent: number | null;
  actualMinutes: number;
  prescribedMinutes: number;
}

export interface CurriculumSummaryRow {
  rowKey: string;
  schoolCode: string;
  schoolName: string;
  region: string | null;
  state: string | null;
  district: string | null;
  programId: number;
  programName: string;
  grade: number;
  subjectId: number;
  subjectName: string;
  examTrack: ExamTrack;
  completedChapters: number;
  totalConfiguredChapters: number;
  prescribedChapters: number;
  actualMinutes: number;
  prescribedMinutes: number;
  deltaPercent: number | null;
  flagged: boolean;
  flagReasons: string[];
}

export interface CurriculumSummaryChapterRow {
  parentRowKey: string;
  chapterId: number;
  chapterCode: string;
  chapterName: string;
  coverageSequence: number;
  completedCount: 0 | 1;
  prescribedCount: 0 | 1;
  actualMinutes: number;
  prescribedMinutes: number;
  deltaPercent: number | null;
  flagged: boolean;
  flagReasons: string[];
}

export type CurriculumSummaryResult =
  | {
      ok: true;
      rowCountGuardTripped?: false;
      estimatedRowCount?: number;
      activeFilters: CurriculumSummaryFilters;
      filterOptions: CurriculumSummaryFilterOptions;
      stats: CurriculumSummaryStats;
      rows: CurriculumSummaryRow[];
      chapterRowsByParentKey: Record<string, CurriculumSummaryChapterRow[]>;
      totalRowCount: number;
      currentPage: number;
      totalPages: number;
      sort: CurriculumSummarySortKey;
      dir: CurriculumSummarySortDirection;
    }
  | {
      ok: true;
      rowCountGuardTripped: true;
      estimatedRowCount: number;
      activeFilters: CurriculumSummaryFilters;
      filterOptions: CurriculumSummaryFilterOptions;
      stats: CurriculumSummaryStats;
      rows: [];
      chapterRowsByParentKey: Record<string, CurriculumSummaryChapterRow[]>;
      totalRowCount: 0;
      currentPage: number;
      totalPages: 0;
      sort: CurriculumSummarySortKey;
      dir: CurriculumSummarySortDirection;
    }
  | CurriculumSchemaUnavailable;

interface OptionsQueryRow {
  schools: unknown;
  programs: unknown;
  grades: unknown;
  subjects: unknown;
  exam_tracks: unknown;
  regions: unknown;
  states: unknown;
  districts: unknown;
}

interface SummaryQueryRow {
  total_count: string | number | null;
  school_code: string;
  school_name: string | null;
  region: string | null;
  state: string | null;
  district: string | null;
  program_id: string | number;
  program_name: string;
  grade: string | number;
  subject_id: string | number;
  subject_name: unknown;
  exam_track: ExamTrack;
  completed_chapters: string | number | null;
  total_configured_chapters: string | number | null;
  prescribed_chapters: string | number | null;
  actual_minutes: string | number | null;
  prescribed_minutes: string | number | null;
  delta_percent: string | number | null;
  flagged: boolean | string | null;
  flag_reasons: unknown;
}

interface ChapterQueryRow {
  parent_row_key: string;
  chapter_id: string | number;
  chapter_code: string | null;
  chapter_name: unknown;
  coverage_sequence: string | number | null;
  completed_count: string | number | null;
  prescribed_count: string | number | null;
  actual_minutes: string | number | null;
  prescribed_minutes: string | number | null;
  delta_percent: string | number | null;
  flagged: boolean | string | null;
  flag_reasons: unknown;
}

interface StatsQueryRow {
  total_rows: string | number | null;
  flagged_rows: string | number | null;
  completed_chapters: string | number | null;
  total_configured_chapters: string | number | null;
  prescribed_chapters: string | number | null;
  actual_minutes: string | number | null;
  prescribed_minutes: string | number | null;
}

interface GuardQueryRow {
  estimated_rows: string | number | null;
}

const CURRICULUM_PROGRAM_IDS = [PROGRAM_IDS.COE, PROGRAM_IDS.NODAL];
const EXAM_TRACKS: ExamTrack[] = ["jee_main", "jee_advanced", "neet"];
const SORT_SQL: Record<CurriculumSummarySortKey, string> = {
  school: "school_name",
  program: "program_order",
  grade: "grade",
  subject: "subject_name",
  exam_track: "exam_track",
  completed: "completed_percent",
  prescribed: "prescribed_percent",
  delta: "delta_percent",
  actual: "actual_minutes",
  flagged: "flagged",
};

export function normalizeCurriculumSummarySearchParams(
  searchParams: Record<string, string | undefined>,
  todayIstDate: string
): CurriculumSummaryFilters {
  const manualFrom = isDateString(searchParams.from) ? searchParams.from : undefined;
  const manualTo = isDateString(searchParams.to) ? searchParams.to : undefined;
  const requestedPreset = normalizePreset(searchParams.preset);
  const preset =
    requestedPreset ?? (manualFrom || manualTo ? "custom" : "current_academic_year");
  const presetRange = resolvePresetDateRange(preset, todayIstDate);
  const from = preset === "all" ? undefined : presetRange?.from ?? manualFrom;
  const to = preset === "all" ? undefined : presetRange?.to ?? manualTo;

  return {
    schools: parseStringList(searchParams.schools, isSchoolCode),
    programs: parseNumberList(searchParams.programs),
    grades: parseNumberList(searchParams.grades),
    subjects: parseNumberList(searchParams.subjects),
    examTracks: parseStringList(searchParams.exam_tracks, isExamTrack),
    regions: parseStringList(searchParams.regions),
    states: parseStringList(searchParams.states),
    districts: parseStringList(searchParams.districts),
    preset,
    from,
    to,
    flagged: searchParams.flagged === "true" || searchParams.flagged === "1",
    forceEmpty: Boolean(from && to && from > to),
  };
}

export function normalizeCurriculumSummarySort(
  sort?: string,
  dir?: string
): { sort: CurriculumSummarySortKey; dir: CurriculumSummarySortDirection } {
  const normalizedSort = isSortKey(sort) ? sort : "flagged";
  return {
    sort: normalizedSort,
    dir: dir === "asc" ? "asc" : "desc",
  };
}

export function normalizeCurriculumSummaryPage(page?: string): number {
  const parsed = Number.parseInt(page ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function normalizeCurriculumSummaryPageSize(limit?: string): number {
  const parsed = Number.parseInt(limit ?? "20", 10);
  return [10, 20, 50, 100].includes(parsed) ? parsed : 20;
}

export async function getCurriculumSummary(
  params: CurriculumSummaryParams
): Promise<CurriculumSummaryResult> {
  void params.actorEmail;
  void params.todayIstDate;

  const schemaStatus = await checkCurriculumSchema();
  if (!schemaStatus.ok) {
    return schemaStatus;
  }

  const page = Math.max(1, params.page);
  const pageSize = Math.max(1, params.pageSize);
  const commonParams = buildCommonQueryParams(params.permission, params.filters);
  const optionsRows = await query<OptionsQueryRow>(buildOptionsSql(), commonParams);
  const filterOptions = mapFilterOptions(optionsRows[0]);

  if (params.filters.forceEmpty) {
    return {
      ok: true,
      activeFilters: params.filters,
      filterOptions,
      stats: emptyStats(),
      rows: [],
      chapterRowsByParentKey: {},
      totalRowCount: 0,
      currentPage: page,
      totalPages: 0,
      sort: params.sort,
      dir: params.dir,
    };
  }

  const guardRows = await query<GuardQueryRow>(buildRowCountGuardSql(), commonParams);
  const estimatedRowCount = numberFromDb(guardRows[0]?.estimated_rows);
  if (estimatedRowCount > 10000) {
    return {
      ok: true,
      rowCountGuardTripped: true,
      estimatedRowCount,
      activeFilters: params.filters,
      filterOptions,
      stats: emptyStats(),
      rows: [],
      chapterRowsByParentKey: {},
      totalRowCount: 0,
      currentPage: page,
      totalPages: 0,
      sort: params.sort,
      dir: params.dir,
    };
  }

  const metricParams = buildMetricQueryParams(commonParams, params.filters);
  const statsRows = await query<StatsQueryRow>(buildStatsSql(), metricParams);
  const stats = mapStats(statsRows[0]);
  const totalRowCount = stats.totalRows;
  const totalPages = totalRowCount === 0 ? 0 : Math.ceil(totalRowCount / pageSize);
  const currentPage = totalPages === 0 ? page : Math.min(page, totalPages);
  const offset = (currentPage - 1) * pageSize;
  const rowRows = await query<SummaryQueryRow>(
    buildRowsSql(params.sort, params.dir),
    [...metricParams, pageSize, offset]
  );
  const chapterRows = rowRows.length
    ? await query<ChapterQueryRow>(
        buildChapterRowsSql(params.sort, params.dir),
        [...metricParams, pageSize, offset]
      )
    : [];

  return {
    ok: true,
    activeFilters: params.filters,
    filterOptions,
    stats,
    rows: rowRows.map(mapSummaryRow),
    chapterRowsByParentKey: mapChapterRowsByParentKey(chapterRows),
    totalRowCount,
    currentPage,
    totalPages,
    sort: params.sort,
    dir: params.dir,
  };
}

function buildCommonQueryParams(
  permission: UserPermission,
  filters: CurriculumSummaryFilters
): unknown[] {
  return [
    permission.level === 3,
    permission.level === 1 ? permission.school_codes ?? [] : null,
    permission.level === 2 ? permission.regions ?? [] : null,
    CURRICULUM_PROGRAM_IDS,
    permission.role === "admin",
    permission.program_ids ?? [],
    filters.schools.length ? filters.schools : null,
    filters.programs.length ? filters.programs : null,
    filters.grades.length ? filters.grades : null,
    filters.subjects.length ? filters.subjects : null,
    filters.examTracks.length ? filters.examTracks : null,
    filters.regions.length ? filters.regions : null,
    filters.states.length ? filters.states : null,
    filters.districts.length ? filters.districts : null,
  ];
}

function buildMetricQueryParams(
  commonParams: unknown[],
  filters: CurriculumSummaryFilters
): unknown[] {
  return [
    ...commonParams,
    filters.from ?? null,
    filters.to ?? null,
    filters.flagged,
  ];
}

function buildScopedUniverseSql(): string {
  return `
    WITH scoped_schools AS (
      SELECT s.code, s.name, s.region, s.state, s.district
      FROM school s
      WHERE s.af_school_category = 'JNV'
        AND (
          $1::boolean
          OR ($2::text[] IS NOT NULL AND s.code = ANY($2::text[]))
          OR ($3::text[] IS NOT NULL AND s.region = ANY($3::text[]))
        )
    ),
    scoped_school_programs AS (
      SELECT
        ss.code AS school_code,
        ss.name AS school_name,
        ss.region,
        ss.state,
        ss.district,
        p.id AS program_id,
        p.name AS program_name,
        array_position($4::int[], p.id) AS program_order
      FROM scoped_schools ss
      JOIN program p ON p.id = ANY($4::int[])
      WHERE ($5::boolean OR p.id = ANY($6::int[]))
    ),
    configured_rows AS (
      SELECT DISTINCT
        g.id AS grade_id,
        g.number AS grade,
        s.id AS subject_id,
        COALESCE(
          (
            SELECT item->>'subject'
            FROM jsonb_array_elements(s.name::jsonb) item
            WHERE item->>'lang_code' = 'en'
            LIMIT 1
          ),
          'Unknown subject'
        ) AS subject_name,
        cfg.exam_track
      FROM lms_chapter_exam_configs cfg
      JOIN chapter ch ON ch.id = cfg.chapter_id
      JOIN grade g ON g.id = ch.grade_id
      JOIN subject s ON s.id = ch.subject_id
      WHERE cfg.is_in_syllabus = true
    ),
    expected_rows AS (
      SELECT
        ssp.school_code,
        ssp.school_name,
        ssp.region,
        ssp.state,
        ssp.district,
        ssp.program_id,
        ssp.program_name,
        ssp.program_order,
        cr.grade_id,
        cr.grade,
        cr.subject_id,
        cr.subject_name,
        cr.exam_track
      FROM scoped_school_programs ssp
      CROSS JOIN configured_rows cr
    ),
    filtered_rows AS (
      SELECT *
      FROM expected_rows
      WHERE ($7::text[] IS NULL OR school_code = ANY($7::text[]))
        AND ($8::int[] IS NULL OR program_id = ANY($8::int[]))
        AND ($9::int[] IS NULL OR grade = ANY($9::int[]))
        AND ($10::int[] IS NULL OR subject_id = ANY($10::int[]))
        AND ($11::text[] IS NULL OR exam_track = ANY($11::text[]))
        AND ($12::text[] IS NULL OR region = ANY($12::text[]))
        AND ($13::text[] IS NULL OR state = ANY($13::text[]))
        AND ($14::text[] IS NULL OR district = ANY($14::text[]))
    )`;
}

function buildComputedRowsSql(): string {
  return `${buildScopedUniverseSql()},
    configured_metrics AS (
      SELECT
        g.id AS grade_id,
        g.number AS grade,
        ch.subject_id,
        cfg.exam_track,
        COUNT(*)::int AS total_configured_chapters,
        COUNT(*) FILTER (WHERE cfg.prescribed_minutes > 0)::int AS prescribed_chapters,
        COALESCE(SUM(cfg.prescribed_minutes), 0)::int AS prescribed_minutes
      FROM lms_chapter_exam_configs cfg
      JOIN chapter ch ON ch.id = cfg.chapter_id
      JOIN grade g ON g.id = ch.grade_id
      WHERE cfg.is_in_syllabus = true
      GROUP BY g.id, g.number, ch.subject_id, cfg.exam_track
    ),
    actual_minutes AS (
      SELECT
        fr.school_code,
        fr.program_id,
        fr.grade_id,
        fr.subject_id,
        fr.exam_track,
        COALESCE(SUM(l.duration_minutes), 0)::int AS actual_minutes
      FROM filtered_rows fr
      LEFT JOIN lms_curriculum_logs l
        ON l.school_code = fr.school_code
       AND l.program_id = fr.program_id
       AND l.grade_id = fr.grade_id
       AND l.subject_id = fr.subject_id
       AND l.exam_track = fr.exam_track
       AND l.deleted_at IS NULL
       AND ($15::date IS NULL OR l.log_date >= $15::date)
       AND ($16::date IS NULL OR l.log_date <= $16::date)
      GROUP BY fr.school_code, fr.program_id, fr.grade_id, fr.subject_id, fr.exam_track
    ),
    completion_counts AS (
      SELECT
        fr.school_code,
        fr.program_id,
        fr.grade_id,
        fr.subject_id,
        fr.exam_track,
        COUNT(DISTINCT cc.chapter_id)::int AS completed_chapters
      FROM filtered_rows fr
      JOIN lms_curriculum_chapter_completions cc
        ON cc.school_code = fr.school_code
       AND cc.program_id = fr.program_id
       AND cc.exam_track = fr.exam_track
       AND cc.deleted_at IS NULL
      JOIN chapter ch
        ON ch.id = cc.chapter_id
       AND ch.grade_id = fr.grade_id
       AND ch.subject_id = fr.subject_id
      JOIN lms_chapter_exam_configs cfg
        ON cfg.chapter_id = cc.chapter_id
       AND cfg.exam_track = fr.exam_track
       AND cfg.is_in_syllabus = true
      GROUP BY fr.school_code, fr.program_id, fr.grade_id, fr.subject_id, fr.exam_track
    ),
    metric_rows AS (
      SELECT
        fr.*,
        COALESCE(cc.completed_chapters, 0)::int AS completed_chapters,
        COALESCE(cm.total_configured_chapters, 0)::int AS total_configured_chapters,
        COALESCE(cm.prescribed_chapters, 0)::int AS prescribed_chapters,
        COALESCE(am.actual_minutes, 0)::int AS actual_minutes,
        COALESCE(cm.prescribed_minutes, 0)::int AS prescribed_minutes,
        CASE
          WHEN COALESCE(cm.total_configured_chapters, 0) > 0
            THEN (COALESCE(cc.completed_chapters, 0)::numeric / cm.total_configured_chapters::numeric) * 100
          ELSE NULL
        END AS completed_percent,
        CASE
          WHEN COALESCE(cm.total_configured_chapters, 0) > 0
            THEN (COALESCE(cm.prescribed_chapters, 0)::numeric / cm.total_configured_chapters::numeric) * 100
          ELSE NULL
        END AS prescribed_percent,
        CASE
          WHEN COALESCE(cm.prescribed_minutes, 0) > 0
            THEN ((COALESCE(am.actual_minutes, 0) - cm.prescribed_minutes)::numeric / cm.prescribed_minutes::numeric) * 100
          ELSE NULL
        END AS delta_percent
      FROM filtered_rows fr
      LEFT JOIN configured_metrics cm
        ON cm.grade_id = fr.grade_id
       AND cm.subject_id = fr.subject_id
       AND cm.exam_track = fr.exam_track
      LEFT JOIN actual_minutes am
        ON am.school_code = fr.school_code
       AND am.program_id = fr.program_id
       AND am.grade_id = fr.grade_id
       AND am.subject_id = fr.subject_id
       AND am.exam_track = fr.exam_track
      LEFT JOIN completion_counts cc
        ON cc.school_code = fr.school_code
       AND cc.program_id = fr.program_id
       AND cc.grade_id = fr.grade_id
       AND cc.subject_id = fr.subject_id
       AND cc.exam_track = fr.exam_track
    ),
    computed_rows AS (
      SELECT
        mr.*,
        ARRAY_REMOVE(ARRAY[
          CASE
            WHEN mr.prescribed_minutes = 0 AND mr.actual_minutes > 0
              THEN 'actual_time_on_zero_prescribed_minutes'
            ELSE NULL
          END,
          CASE
            WHEN mr.prescribed_minutes > 0 AND mr.delta_percent < -10
              THEN 'under_prescribed_hours'
            ELSE NULL
          END,
          CASE
            WHEN mr.prescribed_minutes > 0 AND mr.delta_percent > 10
              THEN 'over_prescribed_hours'
            ELSE NULL
          END,
          CASE
            WHEN mr.total_configured_chapters > 0
             AND (mr.completed_chapters::numeric / mr.total_configured_chapters::numeric)
               < (mr.prescribed_chapters::numeric / mr.total_configured_chapters::numeric)
              THEN 'completion_below_prescribed_coverage'
            ELSE NULL
          END
        ], NULL) AS flag_reasons
      FROM metric_rows mr
    ),
    computed_filtered_rows AS (
      SELECT
        cr.*,
        CARDINALITY(cr.flag_reasons) > 0 AS flagged,
        CASE
          WHEN 'actual_time_on_zero_prescribed_minutes' = ANY(cr.flag_reasons) THEN 0
          WHEN CARDINALITY(cr.flag_reasons) > 0 THEN 1
          ELSE 2
        END AS flag_priority
      FROM computed_rows cr
      WHERE ($17::boolean = false OR CARDINALITY(cr.flag_reasons) > 0)
    )`;
}

function buildStatsSql(): string {
  return `${buildComputedRowsSql()}
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(*) FILTER (WHERE flagged)::int AS flagged_rows,
      COALESCE(SUM(completed_chapters), 0)::int AS completed_chapters,
      COALESCE(SUM(total_configured_chapters), 0)::int AS total_configured_chapters,
      COALESCE(SUM(prescribed_chapters), 0)::int AS prescribed_chapters,
      COALESCE(SUM(actual_minutes), 0)::int AS actual_minutes,
      COALESCE(SUM(prescribed_minutes), 0)::int AS prescribed_minutes
    FROM computed_filtered_rows`;
}

function buildOptionsSql(): string {
  return `${buildScopedUniverseSql()},
    school_options AS (
      SELECT DISTINCT school_code, school_name, region, state, district
      FROM scoped_school_programs
    ),
    program_options AS (
      SELECT DISTINCT program_id, program_name, program_order
      FROM scoped_school_programs
    ),
    primary_filter_option_rows AS (
      SELECT *
      FROM expected_rows
      WHERE ($7::text[] IS NULL OR school_code = ANY($7::text[]))
        AND ($8::int[] IS NULL OR program_id = ANY($8::int[]))
        AND ($12::text[] IS NULL OR region = ANY($12::text[]))
        AND ($13::text[] IS NULL OR state = ANY($13::text[]))
        AND ($14::text[] IS NULL OR district = ANY($14::text[]))
    ),
    subject_filter_option_rows AS (
      SELECT *
      FROM primary_filter_option_rows
      WHERE ($9::int[] IS NULL OR grade = ANY($9::int[]))
    ),
    exam_track_filter_option_rows AS (
      SELECT *
      FROM subject_filter_option_rows
      WHERE ($10::int[] IS NULL OR subject_id = ANY($10::int[]))
    ),
    grade_options AS (
      SELECT DISTINCT grade
      FROM primary_filter_option_rows
      WHERE grade IS NOT NULL
    ),
    subject_options AS (
      SELECT DISTINCT subject_id, subject_name
      FROM subject_filter_option_rows
      WHERE subject_id IS NOT NULL
    ),
    exam_track_options AS (
      SELECT DISTINCT exam_track
      FROM exam_track_filter_option_rows
      WHERE exam_track IS NOT NULL
    ),
    geo_options AS (
      SELECT
        COALESCE(jsonb_agg(DISTINCT region) FILTER (WHERE region IS NOT NULL), '[]'::jsonb) AS regions,
        COALESCE(jsonb_agg(DISTINCT state) FILTER (WHERE state IS NOT NULL), '[]'::jsonb) AS states,
        COALESCE(jsonb_agg(DISTINCT district) FILTER (WHERE district IS NOT NULL), '[]'::jsonb) AS districts
      FROM scoped_schools
    )
    SELECT
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'code', school_code,
          'name', school_name,
          'region', region,
          'state', state,
          'district', district
        ) ORDER BY school_name, school_code), '[]'::jsonb)
        FROM school_options
      ) AS schools,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', program_id,
          'name', program_name
        ) ORDER BY program_order, program_id), '[]'::jsonb)
        FROM program_options
      ) AS programs,
      (
        SELECT COALESCE(jsonb_agg(grade ORDER BY grade), '[]'::jsonb)
        FROM grade_options
      ) AS grades,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', subject_id,
          'name', subject_name
        ) ORDER BY subject_id), '[]'::jsonb)
        FROM subject_options
      ) AS subjects,
      (
        SELECT COALESCE(jsonb_agg(exam_track ORDER BY exam_track), '[]'::jsonb)
        FROM exam_track_options
      ) AS exam_tracks,
      geo_options.regions,
      geo_options.states,
      geo_options.districts
    FROM geo_options`;
}

function buildRowCountGuardSql(): string {
  return `${buildScopedUniverseSql()}
    SELECT COUNT(*)::int AS estimated_rows
    FROM (
      SELECT 1
      FROM filtered_rows
      LIMIT 10001
    ) capped_rows`;
}

function buildRowsSql(
  sort: CurriculumSummarySortKey,
  dir: CurriculumSummarySortDirection
): string {
  return `${buildComputedRowsSql()}
    SELECT
      COUNT(*) OVER() AS total_count,
      school_code,
      school_name,
      region,
      state,
      district,
      program_id,
      program_name,
      grade,
      subject_id,
      subject_name,
      exam_track,
      completed_chapters,
      total_configured_chapters,
      prescribed_chapters,
      actual_minutes,
      prescribed_minutes,
      delta_percent,
      flagged,
      flag_reasons
    FROM computed_filtered_rows
    ORDER BY ${buildOrderClause(sort, dir)}
    LIMIT $18 OFFSET $19`;
}

function buildChapterRowsSql(
  sort: CurriculumSummarySortKey,
  dir: CurriculumSummarySortDirection
): string {
  return `${buildComputedRowsSql()},
    current_page_rows AS (
      SELECT
        *,
        ROW_NUMBER() OVER (ORDER BY ${buildOrderClause(sort, dir)}) AS page_row_order
      FROM computed_filtered_rows
      ORDER BY ${buildOrderClause(sort, dir)}
      LIMIT $18 OFFSET $19
    ),
    scoped_log_topics AS (
      SELECT
        cpr.school_code,
        cpr.program_id,
        cpr.grade_id,
        cpr.subject_id,
        cpr.exam_track,
        l.id AS log_id,
        l.duration_minutes,
        lt.topic_id,
        COUNT(*) OVER (
          PARTITION BY
            cpr.school_code,
            cpr.program_id,
            cpr.grade_id,
            cpr.subject_id,
            cpr.exam_track,
            l.id
        ) AS total_topics_in_log
      FROM current_page_rows cpr
      JOIN lms_curriculum_logs l
        ON l.school_code = cpr.school_code
       AND l.program_id = cpr.program_id
       AND l.grade_id = cpr.grade_id
       AND l.subject_id = cpr.subject_id
       AND l.exam_track = cpr.exam_track
       AND l.deleted_at IS NULL
       AND ($15::date IS NULL OR l.log_date >= $15::date)
       AND ($16::date IS NULL OR l.log_date <= $16::date)
      JOIN lms_curriculum_log_topics lt ON lt.curriculum_log_id = l.id
    ),
    chapter_log_allocations AS (
      SELECT
        slt.school_code,
        slt.program_id,
        slt.grade_id,
        slt.subject_id,
        slt.exam_track,
        ch.id AS chapter_id,
        slt.log_id,
        MAX(slt.duration_minutes)::int AS duration_minutes,
        MAX(slt.total_topics_in_log)::int AS total_topics_in_log,
        COUNT(DISTINCT slt.topic_id)::int AS topics_in_chapter_for_log
      FROM scoped_log_topics slt
      JOIN topic t ON t.id = slt.topic_id
      JOIN chapter ch
        ON ch.id = t.chapter_id
       AND ch.grade_id = slt.grade_id
       AND ch.subject_id = slt.subject_id
      JOIN lms_chapter_exam_configs cfg
        ON cfg.chapter_id = ch.id
       AND cfg.exam_track = slt.exam_track
       AND cfg.is_in_syllabus = true
      GROUP BY
        slt.school_code,
        slt.program_id,
        slt.grade_id,
        slt.subject_id,
        slt.exam_track,
        ch.id,
        slt.log_id
    ),
    chapter_actual_minutes AS (
      SELECT
        school_code,
        program_id,
        grade_id,
        subject_id,
        exam_track,
        chapter_id,
        COALESCE(
          SUM(
            ROUND(
              duration_minutes::numeric
              * (topics_in_chapter_for_log::numeric / NULLIF(total_topics_in_log, 0)::numeric)
            )
          ),
          0
        )::int AS actual_minutes
      FROM chapter_log_allocations
      GROUP BY school_code, program_id, grade_id, subject_id, exam_track, chapter_id
    ),
    chapter_metric_rows AS (
      SELECT
        CONCAT(
          cpr.school_code,
          ':',
          cpr.program_id,
          ':',
          cpr.grade,
          ':',
          cpr.subject_id,
          ':',
          cpr.exam_track
        ) AS parent_row_key,
        cpr.page_row_order,
        ch.id AS chapter_id,
        ch.code AS chapter_code,
        ch.name AS chapter_name,
        COALESCE(
          (
            SELECT item->>'chapter'
            FROM jsonb_array_elements(ch.name::jsonb) item
            WHERE item->>'lang_code' = 'en'
            LIMIT 1
          ),
          ch.code,
          'Unknown chapter'
        ) AS chapter_sort_name,
        cfg.coverage_sequence,
        CASE WHEN cc.chapter_id IS NULL THEN 0 ELSE 1 END AS completed_count,
        CASE WHEN cfg.prescribed_minutes > 0 THEN 1 ELSE 0 END AS prescribed_count,
        COALESCE(cam.actual_minutes, 0)::int AS actual_minutes,
        COALESCE(cfg.prescribed_minutes, 0)::int AS prescribed_minutes,
        CASE
          WHEN COALESCE(cfg.prescribed_minutes, 0) > 0
            THEN ((COALESCE(cam.actual_minutes, 0) - cfg.prescribed_minutes)::numeric / cfg.prescribed_minutes::numeric) * 100
          ELSE NULL
        END AS delta_percent
      FROM current_page_rows cpr
      JOIN lms_chapter_exam_configs cfg
        ON cfg.exam_track = cpr.exam_track
       AND cfg.is_in_syllabus = true
      JOIN chapter ch
        ON ch.id = cfg.chapter_id
       AND ch.grade_id = cpr.grade_id
       AND ch.subject_id = cpr.subject_id
      LEFT JOIN lms_curriculum_chapter_completions cc
        ON cc.school_code = cpr.school_code
       AND cc.program_id = cpr.program_id
       AND cc.exam_track = cpr.exam_track
       AND cc.chapter_id = ch.id
       AND cc.deleted_at IS NULL
      LEFT JOIN chapter_actual_minutes cam
        ON cam.school_code = cpr.school_code
       AND cam.program_id = cpr.program_id
       AND cam.grade_id = cpr.grade_id
       AND cam.subject_id = cpr.subject_id
       AND cam.exam_track = cpr.exam_track
       AND cam.chapter_id = ch.id
    ),
    chapter_computed_rows AS (
      SELECT
        cmr.*,
        ARRAY_REMOVE(ARRAY[
          CASE
            WHEN cmr.prescribed_minutes = 0 AND cmr.actual_minutes > 0
              THEN 'actual_time_on_zero_prescribed_minutes'
            ELSE NULL
          END,
          CASE
            WHEN cmr.prescribed_minutes > 0 AND cmr.delta_percent < -10
              THEN 'under_prescribed_hours'
            ELSE NULL
          END,
          CASE
            WHEN cmr.prescribed_minutes > 0 AND cmr.delta_percent > 10
              THEN 'over_prescribed_hours'
            ELSE NULL
          END,
          CASE
            WHEN cmr.prescribed_minutes > 0 AND cmr.completed_count = 0
              THEN 'incomplete_prescribed_chapter'
            ELSE NULL
          END
        ], NULL) AS flag_reasons
      FROM chapter_metric_rows cmr
    )
    SELECT
      parent_row_key,
      chapter_id,
      chapter_code,
      chapter_name,
      coverage_sequence,
      completed_count,
      prescribed_count,
      actual_minutes,
      prescribed_minutes,
      delta_percent,
      CARDINALITY(flag_reasons) > 0 AS flagged,
      flag_reasons
    FROM chapter_computed_rows
    ORDER BY
      page_row_order ASC,
      coverage_sequence ASC NULLS LAST,
      chapter_code ASC,
      chapter_sort_name ASC,
      chapter_id ASC`;
}

function buildOrderClause(
  sort: CurriculumSummarySortKey,
  dir: CurriculumSummarySortDirection
): string {
  const direction = dir === "desc" ? "DESC" : "ASC";
  const tieBreakers =
    "school_name ASC, program_order ASC, grade ASC, subject_name ASC, exam_track ASC, school_code ASC";

  if (sort === "flagged" && dir === "desc") {
    return `flagged DESC, flag_priority ASC, delta_percent ASC NULLS LAST, ${tieBreakers}`;
  }

  const sortColumn = SORT_SQL[sort];
  const nullsClause = sort === "delta" ? " NULLS LAST" : "";
  return `${sortColumn} ${direction}${nullsClause}, ${tieBreakers}`;
}

function mapFilterOptions(row: OptionsQueryRow | undefined): CurriculumSummaryFilterOptions {
  const schools = parseJsonArray<CurriculumSummarySchoolOption>(row?.schools)
    .map((school) => ({
      code: String(school.code),
      name: String(school.name ?? school.code),
      region: school.region ?? null,
      state: school.state ?? null,
      district: school.district ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  const programs = parseJsonArray<CurriculumSummaryProgramOption>(row?.programs)
    .map((program) => ({ id: Number(program.id), name: String(program.name) }))
    .sort((a, b) => a.id - b.id);
  const subjects = parseJsonArray<CurriculumSummarySubjectOption>(row?.subjects)
    .map((subject) => ({
      id: Number(subject.id),
      name: normalizeSubjectName(subject.name),
    }))
    .sort((a, b) => a.id - b.id);

  return {
    schools,
    programs,
    grades: parseJsonArray<number>(row?.grades).map(Number).sort((a, b) => a - b),
    subjects,
    examTracks: EXAM_TRACKS.filter((track) =>
      parseJsonArray<string>(row?.exam_tracks).includes(track)
    ),
    regions: parseJsonArray<string>(row?.regions).map(String).sort(),
    states: parseJsonArray<string>(row?.states).map(String).sort(),
    districts: parseJsonArray<string>(row?.districts).map(String).sort(),
  };
}

function mapSummaryRow(row: SummaryQueryRow): CurriculumSummaryRow {
  const schoolCode = String(row.school_code);
  const programId = Number(row.program_id);
  const grade = Number(row.grade);
  const subjectId = Number(row.subject_id);
  const examTrack = row.exam_track;

  return {
    rowKey: `${schoolCode}:${programId}:${grade}:${subjectId}:${examTrack}`,
    schoolCode,
    schoolName: row.school_name ?? schoolCode,
    region: row.region,
    state: row.state,
    district: row.district,
    programId,
    programName: row.program_name,
    grade,
    subjectId,
    subjectName: normalizeSubjectName(row.subject_name),
    examTrack,
    completedChapters: numberFromDb(row.completed_chapters),
    totalConfiguredChapters: numberFromDb(row.total_configured_chapters),
    prescribedChapters: numberFromDb(row.prescribed_chapters),
    actualMinutes: numberFromDb(row.actual_minutes),
    prescribedMinutes: numberFromDb(row.prescribed_minutes),
    deltaPercent:
      row.delta_percent === null || row.delta_percent === undefined
        ? null
        : Number(row.delta_percent),
    flagged: row.flagged === true || row.flagged === "true",
    flagReasons: parseJsonArray<string>(row.flag_reasons).map(String),
  };
}

function mapChapterRowsByParentKey(
  rows: ChapterQueryRow[]
): Record<string, CurriculumSummaryChapterRow[]> {
  const grouped: Record<string, CurriculumSummaryChapterRow[]> = {};

  for (const row of rows) {
    const mapped = mapChapterRow(row);
    grouped[mapped.parentRowKey] = grouped[mapped.parentRowKey] ?? [];
    grouped[mapped.parentRowKey].push(mapped);
  }

  return grouped;
}

function mapChapterRow(row: ChapterQueryRow): CurriculumSummaryChapterRow {
  const prescribedCount = numberFromDb(row.prescribed_count) > 0 ? 1 : 0;
  const completedCount = numberFromDb(row.completed_count) > 0 ? 1 : 0;

  return {
    parentRowKey: String(row.parent_row_key),
    chapterId: numberFromDb(row.chapter_id),
    chapterCode: String(row.chapter_code ?? ""),
    chapterName: normalizeChapterName(row.chapter_name),
    coverageSequence: numberFromDb(row.coverage_sequence),
    completedCount,
    prescribedCount,
    actualMinutes: numberFromDb(row.actual_minutes),
    prescribedMinutes: numberFromDb(row.prescribed_minutes),
    deltaPercent:
      row.delta_percent === null || row.delta_percent === undefined
        ? null
        : Number(row.delta_percent),
    flagged: row.flagged === true || row.flagged === "true",
    flagReasons: parseJsonArray<string>(row.flag_reasons).map(String),
  };
}

function mapStats(row: StatsQueryRow | undefined): CurriculumSummaryStats {
  if (!row) {
    return emptyStats();
  }

  const totalConfiguredChapters = numberFromDb(row.total_configured_chapters);
  const completedChapters = numberFromDb(row.completed_chapters);
  const prescribedChapters = numberFromDb(row.prescribed_chapters);

  return {
    totalRows: numberFromDb(row.total_rows),
    flaggedRows: numberFromDb(row.flagged_rows),
    avgCompletionPercent:
      totalConfiguredChapters > 0
        ? (completedChapters / totalConfiguredChapters) * 100
        : null,
    avgPrescribedPercent:
      totalConfiguredChapters > 0
        ? (prescribedChapters / totalConfiguredChapters) * 100
        : null,
    actualMinutes: numberFromDb(row.actual_minutes),
    prescribedMinutes: numberFromDb(row.prescribed_minutes),
  };
}

function emptyStats(): CurriculumSummaryStats {
  return {
    totalRows: 0,
    flaggedRows: 0,
    avgCompletionPercent: null,
    avgPrescribedPercent: null,
    actualMinutes: 0,
    prescribedMinutes: 0,
  };
}

function numberFromDb(value: string | number | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeSubjectName(value: unknown): string {
  const name = extractEnglishName(value, "subject");
  return name === "Mathematics" ? "Maths" : name;
}

function normalizeChapterName(value: unknown): string {
  return extractEnglishName(value, "chapter");
}

function extractEnglishName(value: unknown, field: string): string {
  if (typeof value === "string" && !value.trim().startsWith("[") && !value.trim().startsWith("{")) {
    return value;
  }

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) {
      return `Unknown ${field}`;
    }
    const english = parsed.find((item: Record<string, string>) => item.lang_code === "en");
    return english?.[field] || `Unknown ${field}`;
  } catch {
    return `Unknown ${field}`;
  }
}

function parseStringList<T extends string = string>(
  value: string | undefined,
  predicate: (item: string) => item is T = ((item: string): item is T => item.length > 0)
): T[] {
  const seen = new Set<T>();
  for (const item of (value ?? "").split(",")) {
    const trimmed = item.trim();
    if (!trimmed || !predicate(trimmed)) {
      continue;
    }
    seen.add(trimmed);
  }
  return [...seen];
}

function parseNumberList(value: string | undefined): number[] {
  const seen = new Set<number>();
  for (const item of (value ?? "").split(",")) {
    const trimmed = item.trim();
    if (!/^\d+$/.test(trimmed)) {
      continue;
    }
    seen.add(Number(trimmed));
  }
  return [...seen];
}

function isSchoolCode(value: string): value is string {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function isExamTrack(value: string): value is ExamTrack {
  return EXAM_TRACKS.includes(value as ExamTrack);
}

function isSortKey(value: string | undefined): value is CurriculumSummarySortKey {
  return Boolean(value && Object.prototype.hasOwnProperty.call(SORT_SQL, value));
}

function normalizePreset(value: string | undefined): CurriculumSummaryDatePreset | null {
  if (
    value === "today" ||
    value === "last_7_days" ||
    value === "last_30_days" ||
    value === "current_academic_year" ||
    value === "all" ||
    value === "custom"
  ) {
    return value;
  }
  return null;
}

function isDateString(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function resolvePresetDateRange(
  preset: CurriculumSummaryDatePreset,
  todayIstDate: string
): { from?: string; to?: string } {
  if (preset === "all") {
    return {};
  }
  if (preset === "today") {
    return { from: todayIstDate, to: todayIstDate };
  }
  if (preset === "last_7_days") {
    return { from: addDays(todayIstDate, -6), to: todayIstDate };
  }
  if (preset === "last_30_days") {
    return { from: addDays(todayIstDate, -29), to: todayIstDate };
  }
  if (preset === "current_academic_year") {
    return { from: academicYearStart(todayIstDate), to: todayIstDate };
  }
  return {};
}

function academicYearStart(todayIstDate: string): string {
  const [year, month] = todayIstDate.split("-").map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-04-01`;
}

function addDays(yyyyMmDd: string, days: number): string {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}
