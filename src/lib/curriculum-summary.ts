import { checkCurriculumSchema, type CurriculumSchemaUnavailable } from "./curriculum-schema";
import { query } from "./db";
import { PROGRAM_IDS, type UserPermission } from "./permissions";
import type { ExamTrack } from "@/types/curriculum";

export type CurriculumSummarySortKey =
  | "school"
  | "program"
  | "grade"
  | "subject"
  | "exam_track";
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

export type CurriculumSummaryResult =
  | {
      ok: true;
      activeFilters: CurriculumSummaryFilters;
      filterOptions: CurriculumSummaryFilterOptions;
      rows: CurriculumSummaryRow[];
      totalRowCount: number;
      currentPage: number;
      totalPages: number;
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
}

const CURRICULUM_PROGRAM_IDS = [PROGRAM_IDS.COE, PROGRAM_IDS.NODAL];
const EXAM_TRACKS: ExamTrack[] = ["jee_main", "jee_advanced", "neet"];
const SORT_SQL: Record<CurriculumSummarySortKey, string> = {
  school: "school_name",
  program: "program_order",
  grade: "grade",
  subject: "subject_name",
  exam_track: "exam_track",
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
  const from = presetRange?.from ?? manualFrom;
  const to = presetRange?.to ?? manualTo;

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
  const normalizedSort = isSortKey(sort) ? sort : "school";
  return {
    sort: normalizedSort,
    dir: dir === "desc" ? "desc" : "asc",
  };
}

export function normalizeCurriculumSummaryPage(page?: string): number {
  const parsed = Number.parseInt(page ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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
      rows: [],
      totalRowCount: 0,
      currentPage: page,
      totalPages: 0,
      sort: params.sort,
      dir: params.dir,
    };
  }

  const offset = (page - 1) * pageSize;
  const rowRows = await query<SummaryQueryRow>(
    buildRowsSql(params.sort, params.dir),
    [...commonParams, pageSize, offset]
  );
  const totalRowCount = Number(rowRows[0]?.total_count ?? 0);
  const totalPages = totalRowCount === 0 ? 0 : Math.ceil(totalRowCount / pageSize);

  return {
    ok: true,
    activeFilters: params.filters,
    filterOptions,
    rows: rowRows.map(mapSummaryRow),
    totalRowCount,
    currentPage: page,
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

function buildScopedUniverseSql(): string {
  return `
    WITH scoped_schools AS (
      SELECT s.code, s.name, s.region, s.state, s.district, s.program_ids
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
      JOIN LATERAL unnest(COALESCE(ss.program_ids, ARRAY[]::int[])) AS school_program(program_id) ON true
      JOIN program p ON p.id = school_program.program_id
      WHERE school_program.program_id = ANY($4::int[])
        AND ($5::boolean OR school_program.program_id = ANY($6::int[]))
    ),
    configured_rows AS (
      SELECT DISTINCT
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

function buildOptionsSql(): string {
  return `${buildScopedUniverseSql()},
    geo_options AS (
      SELECT
        COALESCE(jsonb_agg(DISTINCT region) FILTER (WHERE region IS NOT NULL), '[]'::jsonb) AS regions,
        COALESCE(jsonb_agg(DISTINCT state) FILTER (WHERE state IS NOT NULL), '[]'::jsonb) AS states,
        COALESCE(jsonb_agg(DISTINCT district) FILTER (WHERE district IS NOT NULL), '[]'::jsonb) AS districts
      FROM scoped_schools
    )
    SELECT
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'code', school_code,
        'name', school_name,
        'region', region,
        'state', state,
        'district', district
      )) FILTER (WHERE school_code IS NOT NULL), '[]'::jsonb) AS schools,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', program_id,
        'name', program_name
      )) FILTER (WHERE program_id IS NOT NULL), '[]'::jsonb) AS programs,
      COALESCE(jsonb_agg(DISTINCT grade) FILTER (WHERE grade IS NOT NULL), '[]'::jsonb) AS grades,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', subject_id,
        'name', subject_name
      )) FILTER (WHERE subject_id IS NOT NULL), '[]'::jsonb) AS subjects,
      COALESCE(jsonb_agg(DISTINCT exam_track) FILTER (WHERE exam_track IS NOT NULL), '[]'::jsonb) AS exam_tracks,
      geo_options.regions,
      geo_options.states,
      geo_options.districts
    FROM geo_options
    LEFT JOIN filtered_rows ON true
    GROUP BY geo_options.regions, geo_options.states, geo_options.districts`;
}

function buildRowsSql(
  sort: CurriculumSummarySortKey,
  dir: CurriculumSummarySortDirection
): string {
  const sortColumn = SORT_SQL[sort];
  const direction = dir === "desc" ? "DESC" : "ASC";

  return `${buildScopedUniverseSql()}
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
      exam_track
    FROM filtered_rows
    ORDER BY ${sortColumn} ${direction}, school_name ASC, program_order ASC, grade ASC, subject_name ASC, exam_track ASC, school_code ASC
    LIMIT $15 OFFSET $16`;
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
    completedChapters: 0,
    totalConfiguredChapters: 0,
    prescribedChapters: 0,
    actualMinutes: 0,
    prescribedMinutes: 0,
    deltaPercent: null,
    flagged: false,
    flagReasons: [],
  };
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
  return Boolean(value && value in SORT_SQL);
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
