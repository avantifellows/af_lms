import {
  checkCurriculumConfigManagementSchema,
  type CurriculumSchemaUnavailable,
} from "./curriculum-schema";
import { query } from "./db";
import { getUserPermission, type UserPermission } from "./permissions";
import type { ExamTrack } from "@/types/curriculum";

export type CurriculumConfigSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

export type CurriculumConfigAdminResult =
  | {
      ok: true;
      email: string;
      permission: UserPermission;
    }
  | {
      ok: false;
      status: 401 | 403;
      error: "Unauthorized" | "Forbidden";
    };

export type CurriculumConfigSyllabusStatus =
  | "in_syllabus"
  | "out_of_syllabus"
  | "all";
export type CurriculumConfigSortKey =
  | "curriculum"
  | "exam_track"
  | "grade"
  | "subject"
  | "coverage_sequence"
  | "chapter_code"
  | "chapter_name"
  | "updated_at";
export type CurriculumConfigSortDirection = "asc" | "desc";

export interface CurriculumConfigFilters {
  examTrack: ExamTrack;
  grade: number | null;
  subject: string | null;
  search: string;
  syllabusStatus: CurriculumConfigSyllabusStatus;
}

export interface CurriculumConfigListParams {
  filters: CurriculumConfigFilters;
  page: number;
  limit: number;
  sort: CurriculumConfigSortKey;
  dir: CurriculumConfigSortDirection;
}

export interface CurriculumConfigQueryRow {
  config_id: string | number;
  chapter_id: string | number;
  chapter_code: string | null;
  chapter_name: unknown;
  grade: string | number;
  subject_id: string | number;
  subject_name: unknown;
  exam_track: ExamTrack;
  is_in_syllabus: boolean | string | null;
  prescribed_minutes: string | number | null;
  coverage_sequence: string | number | null;
  updated_by_email: string | null;
  updated_at: string | Date | null;
}

export interface CurriculumConfigRow {
  id: number;
  chapterId: number;
  chapterCode: string;
  chapterName: string;
  grade: number;
  subjectId: number;
  subjectName: string;
  examTrack: ExamTrack;
  isInSyllabus: boolean;
  syllabusStatus: Exclude<CurriculumConfigSyllabusStatus, "all">;
  prescribedMinutes: number;
  prescribedHours: number;
  prescribedHoursLabel: string;
  coverageSequence: number;
  updatedByEmail: string;
  updatedAt: string;
}

export interface CurriculumConfigFilterOptions {
  grades: number[];
  subjects: Array<{ id: number; name: string }>;
  examTracks: ExamTrack[];
  syllabusStatuses: CurriculumConfigSyllabusStatus[];
}

export type CurriculumConfigListResult =
  | {
      ok: true;
      activeFilters: CurriculumConfigFilters;
      filterOptions: CurriculumConfigFilterOptions;
      rows: CurriculumConfigRow[];
      totalRowCount: number;
      currentPage: number;
      totalPages: number;
      limit: number;
      sort: CurriculumConfigSortKey;
      dir: CurriculumConfigSortDirection;
    }
  | CurriculumSchemaUnavailable;

interface ConfigOptionsQueryRow {
  grades: unknown;
  subjects: unknown;
  exam_tracks: unknown;
}

interface CountQueryRow {
  total_count: string | number | null;
}

const EXAM_TRACKS: ExamTrack[] = ["jee_main", "jee_advanced", "neet"];
const SYLLABUS_STATUSES: CurriculumConfigSyllabusStatus[] = [
  "in_syllabus",
  "out_of_syllabus",
  "all",
];
const SORT_KEYS: CurriculumConfigSortKey[] = [
  "curriculum",
  "exam_track",
  "grade",
  "subject",
  "coverage_sequence",
  "chapter_code",
  "chapter_name",
  "updated_at",
];
const PAGE_SIZES = [10, 20, 50, 100];

export async function requireCurriculumConfigAdmin(
  session: CurriculumConfigSession
): Promise<CurriculumConfigAdminResult> {
  const email = session?.user?.email;
  if (!email) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (session.isPasscodeUser) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const permission = await getUserPermission(email);
  if (permission?.role !== "admin") {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, email, permission };
}

export function normalizeCurriculumConfigListParams(
  searchParams: Record<string, string | undefined>
): CurriculumConfigListParams {
  const requestedExamTrack = searchParams.exam_track;
  const requestedSyllabusStatus = searchParams.syllabus_status;
  const page = numberOption(searchParams.page, [null], 1);
  const limit = numberOption(searchParams.limit, PAGE_SIZES, 50);
  const sort = isSortKey(searchParams.sort) ? searchParams.sort : "curriculum";
  const dir = searchParams.dir === "desc" ? "desc" : "asc";
  const grade = positiveInteger(searchParams.grade);
  const subject = searchParams.subject?.trim() || null;

  return {
    filters: {
      examTrack: isExamTrack(requestedExamTrack) ? requestedExamTrack : "jee_main",
      grade,
      subject,
      search: searchParams.search?.trim() ?? "",
      syllabusStatus: isSyllabusStatus(requestedSyllabusStatus)
        ? requestedSyllabusStatus
        : "in_syllabus",
    },
    page,
    limit,
    sort,
    dir,
  };
}

export function mapCurriculumConfigRow(
  row: CurriculumConfigQueryRow
): CurriculumConfigRow {
  const prescribedMinutes = numberFromDb(row.prescribed_minutes);
  const isInSyllabus =
    row.is_in_syllabus === true || row.is_in_syllabus === "true";

  return {
    id: numberFromDb(row.config_id),
    chapterId: numberFromDb(row.chapter_id),
    chapterCode: String(row.chapter_code ?? ""),
    chapterName: localizedName(row.chapter_name, "chapter", row.chapter_code),
    grade: numberFromDb(row.grade),
    subjectId: numberFromDb(row.subject_id),
    subjectName: localizedName(row.subject_name, "subject", "Unknown subject"),
    examTrack: row.exam_track,
    isInSyllabus,
    syllabusStatus: isInSyllabus ? "in_syllabus" : "out_of_syllabus",
    prescribedMinutes,
    prescribedHours: prescribedMinutes / 60,
    prescribedHoursLabel: formatMinutes(prescribedMinutes),
    coverageSequence: numberFromDb(row.coverage_sequence),
    updatedByEmail: row.updated_by_email ?? "",
    updatedAt: row.updated_at ? String(row.updated_at) : "",
  };
}

export async function getCurriculumConfigList(
  params: CurriculumConfigListParams
): Promise<CurriculumConfigListResult> {
  const schema = await checkCurriculumConfigManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const listParams = buildListQueryParams(params.filters);
  const optionsRows = await query<ConfigOptionsQueryRow>(buildOptionsSql(), []);
  const countRows = await query<CountQueryRow>(buildCountSql(), listParams);
  const totalRowCount = numberFromDb(countRows[0]?.total_count);
  const totalPages = totalRowCount === 0 ? 0 : Math.ceil(totalRowCount / params.limit);
  const currentPage = totalPages === 0 ? params.page : Math.min(params.page, totalPages);
  const offset = (currentPage - 1) * params.limit;
  const rows = await query<CurriculumConfigQueryRow>(
    buildRowsSql(params.sort, params.dir),
    [...listParams, params.limit, offset]
  );

  return {
    ok: true,
    activeFilters: params.filters,
    filterOptions: mapFilterOptions(optionsRows[0]),
    rows: rows.map(mapCurriculumConfigRow),
    totalRowCount,
    currentPage,
    totalPages,
    limit: params.limit,
    sort: params.sort,
    dir: params.dir,
  };
}

function isExamTrack(value: unknown): value is ExamTrack {
  return typeof value === "string" && EXAM_TRACKS.includes(value as ExamTrack);
}

function isSyllabusStatus(value: unknown): value is CurriculumConfigSyllabusStatus {
  return (
    typeof value === "string" &&
    SYLLABUS_STATUSES.includes(value as CurriculumConfigSyllabusStatus)
  );
}

function isSortKey(value: unknown): value is CurriculumConfigSortKey {
  return typeof value === "string" && SORT_KEYS.includes(value as CurriculumConfigSortKey);
}

function buildListQueryParams(filters: CurriculumConfigFilters): unknown[] {
  return [
    filters.examTrack,
    filters.grade,
    filters.subject,
    filters.search ? `%${filters.search.toLowerCase()}%` : null,
    filters.syllabusStatus,
  ];
}

function buildOptionsSql(): string {
  return `
    WITH config_options AS (
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
    )
    SELECT
      COALESCE(jsonb_agg(DISTINCT grade) FILTER (WHERE grade IS NOT NULL), '[]'::jsonb) AS grades,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', subject_id,
        'name', subject_name
      )) FILTER (WHERE subject_id IS NOT NULL), '[]'::jsonb) AS subjects,
      COALESCE(jsonb_agg(DISTINCT exam_track) FILTER (WHERE exam_track IS NOT NULL), '[]'::jsonb) AS exam_tracks
    FROM config_options`;
}

function buildBaseListSql(): string {
  return `
    WITH config_rows AS (
      SELECT
        cfg.id AS config_id,
        cfg.chapter_id,
        ch.code AS chapter_code,
        COALESCE(
          (
            SELECT item->>'chapter'
            FROM jsonb_array_elements(ch.name::jsonb) item
            WHERE item->>'lang_code' = 'en'
            LIMIT 1
          ),
          ch.code,
          'Unknown chapter'
        ) AS chapter_name,
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
        cfg.exam_track,
        cfg.is_in_syllabus,
        cfg.prescribed_minutes,
        cfg.coverage_sequence,
        cfg.updated_by_email,
        cfg.updated_at
      FROM lms_chapter_exam_configs cfg
      JOIN chapter ch ON ch.id = cfg.chapter_id
      JOIN grade g ON g.id = ch.grade_id
      JOIN subject s ON s.id = ch.subject_id
    )
    SELECT *
    FROM config_rows
    WHERE exam_track = $1
      AND ($2::int IS NULL OR grade = $2::int)
      AND (
        $3::text IS NULL
        OR subject_id::text = $3::text
        OR LOWER(subject_name) = LOWER($3::text)
      )
      AND (
        $4::text IS NULL
        OR LOWER(chapter_code) LIKE $4::text
        OR LOWER(chapter_name) LIKE $4::text
      )
      AND (
        $5::text = 'all'
        OR ($5::text = 'in_syllabus' AND is_in_syllabus = true)
        OR ($5::text = 'out_of_syllabus' AND is_in_syllabus = false)
      )`;
}

function buildCountSql(): string {
  return `SELECT COUNT(*)::int AS total_count FROM (${buildBaseListSql()}) counted_configs`;
}

function buildRowsSql(
  sort: CurriculumConfigSortKey,
  dir: CurriculumConfigSortDirection
): string {
  return `${buildBaseListSql()}
    ORDER BY ${buildOrderClause(sort, dir)}
    LIMIT $6 OFFSET $7`;
}

function buildOrderClause(
  sort: CurriculumConfigSortKey,
  dir: CurriculumConfigSortDirection
): string {
  const direction = dir === "desc" ? "DESC" : "ASC";
  const baseOrder =
    "exam_track ASC, grade ASC, subject_name ASC, coverage_sequence ASC, chapter_code ASC, chapter_name ASC";

  if (sort === "curriculum") {
    return baseOrder;
  }

  const sortSql: Record<Exclude<CurriculumConfigSortKey, "curriculum">, string> = {
    exam_track: "exam_track",
    grade: "grade",
    subject: "subject_name",
    coverage_sequence: "coverage_sequence",
    chapter_code: "chapter_code",
    chapter_name: "chapter_name",
    updated_at: "updated_at",
  };
  return `${sortSql[sort]} ${direction}, ${baseOrder}`;
}

function mapFilterOptions(row: ConfigOptionsQueryRow | undefined): CurriculumConfigFilterOptions {
  const subjects = parseJsonArray<{ id: unknown; name: unknown }>(row?.subjects)
    .map((subject) => ({
      id: numberFromDb(subject.id as string | number | null | undefined),
      name: localizedName(subject.name, "subject", subject.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  return {
    grades: parseJsonArray<number>(row?.grades).map(Number).sort((a, b) => a - b),
    subjects,
    examTracks: EXAM_TRACKS.filter((track) =>
      parseJsonArray<string>(row?.exam_tracks).includes(track)
    ),
    syllabusStatuses: ["in_syllabus", "out_of_syllabus", "all"],
  };
}

function numberOption(
  value: string | undefined,
  allowedValues: Array<number | null>,
  fallback: number
): number {
  const parsed = positiveInteger(value);
  if (parsed === null) {
    return fallback;
  }
  if (allowedValues.includes(null) || allowedValues.includes(parsed)) {
    return parsed;
  }
  return fallback;
}

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberFromDb(value: string | number | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function localizedName(
  value: unknown,
  key: "chapter" | "subject",
  fallback: unknown
): string {
  if (typeof value === "string" && !value.trim().startsWith("[")) {
    return value;
  }
  const rows = parseJsonArray<Record<string, unknown>>(value);
  const english = rows.find((item) => item.lang_code === "en")?.[key];
  return String(english ?? fallback ?? "");
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

function formatMinutes(minutes: number): string {
  if (minutes <= 0) {
    return "0h";
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}
