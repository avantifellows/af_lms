import {
  checkCurriculumConfigManagementSchema,
  type CurriculumSchemaUnavailable,
} from "./curriculum-schema";
import { query } from "./db";
import { COE_NODAL_PROGRAM_IDS, getUserPermission, type UserPermission } from "./permissions";
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
  chapterId: number | null;
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
  lock_token?: string | number | null;
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
  lockToken: string;
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
  chapters: Array<{ id: number; code: string; name: string; grade: number; subjectName: string }>;
}

export interface CurriculumConfigChapterOptionsParams {
  examTrack: ExamTrack;
  grade: number | null;
  subject: string | null;
  search: string;
}

export interface CurriculumConfigChapterOptionQueryRow {
  chapter_id: string | number;
  chapter_code: string | null;
  chapter_name: unknown;
  grade: string | number;
  subject_id: string | number;
  subject_name: unknown;
  topic_count: string | number | null;
  existing_config_id: string | number | null;
  existing_is_in_syllabus: boolean | string | null;
}

export interface CurriculumConfigChapterOption {
  chapterId: number;
  chapterCode: string;
  chapterName: string;
  grade: number;
  subjectId: number;
  subjectName: string;
  topicCount: number;
  hasTopics: boolean;
  topicWarning: string;
  existingConfigId: number | null;
  configExists: boolean;
  existingIsInSyllabus: boolean | null;
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

export type CurriculumConfigExportResult =
  | {
      ok: true;
      filename: string;
      csv: string;
    }
  | CurriculumSchemaUnavailable;

export type CurriculumConfigChapterOptionsResult =
  | {
      ok: true;
      options: CurriculumConfigChapterOption[];
    }
  | CurriculumSchemaUnavailable;

export interface CurriculumConfigEditPayload {
  isInSyllabus: boolean;
  prescribedMinutes: number;
  coverageSequence: number;
  updatedAt: string;
  lockToken: string;
}

export interface CurriculumConfigCreatePayload {
  chapterId: number;
  examTrack: ExamTrack;
  isInSyllabus: boolean;
  prescribedMinutes: number;
  coverageSequence: number;
}

export interface CurriculumConfigRemovePayload {
  updatedAt: string;
  lockToken: string;
}

export type CurriculumConfigValidationFailure = {
  ok: false;
  status: 422;
  error: string;
  fields: Record<string, string>;
};

export type CurriculumConfigEditPayloadResult =
  | { ok: true; payload: CurriculumConfigEditPayload }
  | CurriculumConfigValidationFailure;

export type CurriculumConfigCreatePayloadResult =
  | { ok: true; payload: CurriculumConfigCreatePayload }
  | CurriculumConfigValidationFailure;

export type CurriculumConfigRemovePayloadResult =
  | { ok: true; payload: CurriculumConfigRemovePayload }
  | CurriculumConfigValidationFailure;

export interface CurriculumConfigWarning {
  code: "duplicate_coverage_sequence" | "zero_prescribed_minutes";
  message: string;
}

export interface CurriculumConfigImpactParams {
  chapterId: number;
  examTrack: ExamTrack;
  configId?: number;
  isInSyllabus?: boolean;
  prescribedMinutes?: number;
  coverageSequence?: number;
}

export type CurriculumConfigImpactResult =
  | {
      ok: true;
      counts: {
        expectedSummaryRows: number;
        activeCurriculumLogs: number;
        activeChapterCompletions: number;
      };
      warnings: CurriculumConfigWarning[];
    }
  | CurriculumSchemaUnavailable;

export type CurriculumConfigEditResult =
  | {
      ok: true;
      row: CurriculumConfigRow;
      warnings: CurriculumConfigWarning[];
      impact: Extract<CurriculumConfigImpactResult, { ok: true }>["counts"];
    }
  | CurriculumConfigValidationFailure
  | CurriculumSchemaUnavailable
  | { ok: false; status: 404 | 409; error: string };

export type CurriculumConfigCreateResult =
  | {
      ok: true;
      row: CurriculumConfigRow;
      warnings: CurriculumConfigWarning[];
      impact: Extract<CurriculumConfigImpactResult, { ok: true }>["counts"];
    }
  | CurriculumConfigValidationFailure
  | CurriculumSchemaUnavailable
  | { ok: false; status: 409; error: string };

export type CurriculumConfigRemoveResult =
  | {
      ok: true;
      row: CurriculumConfigRow;
      warnings: CurriculumConfigWarning[];
      impact: Extract<CurriculumConfigImpactResult, { ok: true }>["counts"];
    }
  | CurriculumConfigValidationFailure
  | CurriculumSchemaUnavailable
  | { ok: false; status: 404 | 409; error: string };

interface ConfigOptionsQueryRow {
  grades: unknown;
  subjects: unknown;
  exam_tracks: unknown;
  chapters: unknown;
}

interface CountQueryRow {
  total_count: string | number | null;
}

interface ImpactQueryRow {
  expected_summary_rows: string | number | null;
  active_curriculum_logs: string | number | null;
  active_chapter_completions: string | number | null;
  duplicate_coverage_count: string | number | null;
}

interface EditMutationRow extends CurriculumConfigQueryRow {
  failure_reason: "stale" | "missing" | "removal_not_allowed" | null;
}

interface CreateMutationRow extends CurriculumConfigQueryRow {
  failure_reason: "duplicate" | "missing_chapter" | null;
}

interface RemoveMutationRow extends CurriculumConfigQueryRow {
  failure_reason: "stale" | "missing" | "already_out_of_syllabus" | null;
}

const EXAM_TRACKS: ExamTrack[] = ["jee_main", "jee_advanced", "neet"];
const EXAM_TRACK_CURRICULUM_IDS: Record<ExamTrack, number> = {
  jee_main: 1,
  jee_advanced: 9,
  neet: 2,
};
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
  if (permission?.role !== "admin" || permission.read_only) {
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
  const chapterId = positiveInteger(searchParams.chapter_id);
  const subject = searchParams.subject?.trim() || null;

  return {
    filters: {
      examTrack: isExamTrack(requestedExamTrack) ? requestedExamTrack : "jee_main",
      grade,
      subject,
      search: searchParams.search?.trim() ?? "",
      chapterId,
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
    lockToken: row.lock_token ? String(row.lock_token) : "",
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

export function normalizeCurriculumConfigEditPayload(
  body: unknown
): CurriculumConfigEditPayloadResult {
  const fields: Record<string, string> = {};
  const payload = isPlainObject(body) ? body : {};
  const allowedKeys = new Set([
    "is_in_syllabus",
    "prescribed_minutes",
    "coverage_sequence",
    "updated_at",
    "lock_token",
  ]);

  for (const key of Object.keys(payload)) {
    if (allowedKeys.has(key)) continue;
    if (key === "id") {
      fields[key] = "Config id is read-only";
    } else if (key === "chapter_id") {
      fields[key] = "Chapter identity is read-only";
    } else if (key === "exam_track") {
      fields[key] = "Exam Track is read-only";
    } else {
      fields[key] = "Field is not editable";
    }
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config edit payload",
      fields,
    };
  }

  const isInSyllabus =
    typeof payload.is_in_syllabus === "boolean" ? payload.is_in_syllabus : null;
  const prescribedMinutes = integerFromPayload(payload.prescribed_minutes);
  const coverageSequence = integerFromPayload(payload.coverage_sequence);
  const updatedAt =
    typeof payload.updated_at === "string" ? payload.updated_at.trim() : "";
  const lockToken =
    typeof payload.lock_token === "string" ? payload.lock_token.trim() : "";

  if (isInSyllabus === null) {
    fields.is_in_syllabus = "Syllabus status is required";
  }
  if (coverageSequence === null || coverageSequence <= 0) {
    fields.coverage_sequence = "Coverage order must be positive";
  }
  if (prescribedMinutes === null || prescribedMinutes < 0) {
    fields.prescribed_minutes = "Prescribed minutes must be zero or greater";
  }
  if (isInSyllabus === false && prescribedMinutes !== null && prescribedMinutes > 0) {
    fields.prescribed_minutes =
      "Out-of-syllabus rows must have zero prescribed minutes";
  }
  if (!updatedAt) {
    fields.updated_at = "Last-seen updated_at is required";
  } else if (Number.isNaN(Date.parse(updatedAt))) {
    fields.updated_at = "Last-seen updated_at is invalid";
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config edit payload",
      fields,
    };
  }

  return {
    ok: true,
    payload: {
      isInSyllabus: isInSyllabus ?? false,
      prescribedMinutes: prescribedMinutes ?? 0,
      coverageSequence: coverageSequence ?? 0,
      updatedAt,
      lockToken: lockToken || updatedAt,
    },
  };
}

export function normalizeCurriculumConfigCreatePayload(
  body: unknown
): CurriculumConfigCreatePayloadResult {
  const fields: Record<string, string> = {};
  const payload = isPlainObject(body) ? body : {};
  const allowedKeys = new Set([
    "chapter_id",
    "exam_track",
    "is_in_syllabus",
    "prescribed_minutes",
    "coverage_sequence",
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      fields[key] =
        key === "id" ? "Config id is generated by the server" : "Field is not editable";
    }
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config create payload",
      fields,
    };
  }

  const chapterId = integerFromPayload(payload.chapter_id);
  const examTrack = payload.exam_track;
  const isInSyllabus =
    typeof payload.is_in_syllabus === "boolean" ? payload.is_in_syllabus : null;
  const prescribedMinutes = integerFromPayload(payload.prescribed_minutes);
  const coverageSequence = integerFromPayload(payload.coverage_sequence);

  if (chapterId === null || chapterId <= 0) {
    fields.chapter_id = "Chapter is required";
  }
  if (!isExamTrack(examTrack)) {
    fields.exam_track = "Invalid Exam Track";
  }
  if (isInSyllabus === null) {
    fields.is_in_syllabus = "Syllabus status is required";
  }
  if (coverageSequence === null || coverageSequence <= 0) {
    fields.coverage_sequence = "Coverage order must be positive";
  }
  if (prescribedMinutes === null || prescribedMinutes < 0) {
    fields.prescribed_minutes = "Prescribed minutes must be zero or greater";
  }
  if (isInSyllabus === false && prescribedMinutes !== null && prescribedMinutes > 0) {
    fields.prescribed_minutes =
      "Out-of-syllabus rows must have zero prescribed minutes";
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config create payload",
      fields,
    };
  }

  return {
    ok: true,
    payload: {
      chapterId: chapterId ?? 0,
      examTrack: examTrack as ExamTrack,
      isInSyllabus: isInSyllabus ?? false,
      prescribedMinutes: prescribedMinutes ?? 0,
      coverageSequence: coverageSequence ?? 0,
    },
  };
}

export function normalizeCurriculumConfigRemovePayload(
  body: unknown
): CurriculumConfigRemovePayloadResult {
  const payload = isPlainObject(body) ? body : {};
  const updatedAt =
    typeof payload.updated_at === "string" ? payload.updated_at.trim() : "";
  const lockToken =
    typeof payload.lock_token === "string" ? payload.lock_token.trim() : "";
  const fields: Record<string, string> = {};

  if (!updatedAt) {
    fields.updated_at = "Last-seen updated_at is required";
  } else if (Number.isNaN(Date.parse(updatedAt))) {
    fields.updated_at = "Last-seen updated_at is invalid";
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config remove payload",
      fields,
    };
  }

  return { ok: true, payload: { updatedAt, lockToken: lockToken || updatedAt } };
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

export async function getCurriculumConfigExport(
  params: CurriculumConfigListParams,
  now = new Date()
): Promise<CurriculumConfigExportResult> {
  const schema = await checkCurriculumConfigManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const rows = await query<CurriculumConfigQueryRow>(
    buildExportRowsSql(params.sort, params.dir),
    buildListQueryParams(params.filters)
  );

  return {
    ok: true,
    filename: `curriculum-config-${formatExportDate(now)}.csv`,
    csv: formatCurriculumConfigCsv(rows.map(mapCurriculumConfigRow)),
  };
}

export async function getCurriculumConfigChapterOptions(
  params: CurriculumConfigChapterOptionsParams
): Promise<CurriculumConfigChapterOptionsResult> {
  const schema = await checkCurriculumConfigManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const rows = await query<CurriculumConfigChapterOptionQueryRow>(
    buildChapterOptionsSql(),
    [
      params.examTrack,
      EXAM_TRACK_CURRICULUM_IDS[params.examTrack],
      params.grade,
      params.subject,
      params.search ? `%${params.search.toLowerCase()}%` : null,
    ]
  );

  return {
    ok: true,
    options: rows.map(mapCurriculumConfigChapterOption),
  };
}

export async function getCurriculumConfigImpact(
  params: CurriculumConfigImpactParams
): Promise<CurriculumConfigImpactResult> {
  const schema = await checkCurriculumConfigManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const rows = await query<ImpactQueryRow>(buildImpactSql(), [
    params.chapterId,
    params.examTrack,
    COE_NODAL_PROGRAM_IDS,
    params.coverageSequence ?? null,
    params.configId ?? null,
  ]);
  const row = rows[0];

  return {
    ok: true,
    counts: {
      expectedSummaryRows: numberFromDb(row?.expected_summary_rows),
      activeCurriculumLogs: numberFromDb(row?.active_curriculum_logs),
      activeChapterCompletions: numberFromDb(row?.active_chapter_completions),
    },
    warnings: buildCurriculumConfigWarnings({
      duplicateCoverageCount: numberFromDb(row?.duplicate_coverage_count),
      isInSyllabus: params.isInSyllabus,
      prescribedMinutes: params.prescribedMinutes,
    }),
  };
}

export async function createCurriculumConfigRow(params: {
  adminEmail: string;
  body: unknown;
}): Promise<CurriculumConfigCreateResult> {
  const schema = await checkCurriculumConfigManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const payloadResult = normalizeCurriculumConfigCreatePayload(params.body);
  if (!payloadResult.ok) {
    return payloadResult;
  }

  const payload = payloadResult.payload;

  try {
    const rows = await query<CreateMutationRow>(buildCreateSql(), [
      payload.chapterId,
      payload.examTrack,
      payload.isInSyllabus,
      payload.prescribedMinutes,
      payload.coverageSequence,
      params.adminEmail,
    ]);
    const row = rows[0];

    if (!row || row.failure_reason === "missing_chapter") {
      return {
        ok: false,
        status: 422,
        error: "Invalid Curriculum Config create payload",
        fields: { chapter_id: "Chapter was not found" },
      };
    }
    if (row.failure_reason === "duplicate") {
      return {
        ok: false,
        status: 409,
        error: "LMS Chapter Exam Config already exists for this chapter and Exam Track",
      };
    }

    const mappedRow = mapCurriculumConfigRow(row);
    const impact = await getCurriculumConfigImpact({
      chapterId: mappedRow.chapterId,
      examTrack: mappedRow.examTrack,
      configId: mappedRow.id,
      isInSyllabus: mappedRow.isInSyllabus,
      prescribedMinutes: mappedRow.prescribedMinutes,
      coverageSequence: mappedRow.coverageSequence,
    });

    return {
      ok: true,
      row: mappedRow,
      warnings: impact.ok ? impact.warnings : [],
      impact: impact.ok
        ? impact.counts
        : {
            expectedSummaryRows: 0,
            activeCurriculumLogs: 0,
            activeChapterCompletions: 0,
          },
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        status: 409,
        error: "LMS Chapter Exam Config already exists for this chapter and Exam Track",
      };
    }
    throw error;
  }
}

export async function editCurriculumConfigRow(params: {
  id: number;
  adminEmail: string;
  body: unknown;
}): Promise<CurriculumConfigEditResult> {
  const schema = await checkCurriculumConfigManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const payloadResult = normalizeCurriculumConfigEditPayload(params.body);
  if (!payloadResult.ok) {
    return payloadResult;
  }

  if (!Number.isInteger(params.id) || params.id <= 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config edit payload",
      fields: { id: "Config id must be positive" },
    };
  }

  const payload = payloadResult.payload;
  const rows = await query<EditMutationRow>(buildEditSql(), [
    params.id,
    payload.isInSyllabus,
    payload.prescribedMinutes,
    payload.coverageSequence,
    payload.lockToken,
    params.adminEmail,
  ]);
  const row = rows[0];

  if (!row || row.failure_reason === "missing") {
    return { ok: false, status: 404, error: "Curriculum Config row not found" };
  }
  if (row.failure_reason === "stale") {
    return { ok: false, status: 409, error: "Curriculum Config row is stale" };
  }
  if (row.failure_reason === "removal_not_allowed") {
    return {
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config edit payload",
      fields: {
        is_in_syllabus:
          "Use the dedicated remove-from-syllabus flow for in-syllabus rows",
      },
    };
  }

  const mappedRow = mapCurriculumConfigRow(row);
  const impact = await getCurriculumConfigImpact({
    chapterId: mappedRow.chapterId,
    examTrack: mappedRow.examTrack,
    configId: mappedRow.id,
    isInSyllabus: mappedRow.isInSyllabus,
    prescribedMinutes: mappedRow.prescribedMinutes,
    coverageSequence: mappedRow.coverageSequence,
  });

  return {
    ok: true,
    row: mappedRow,
    warnings: impact.ok ? impact.warnings : [],
    impact: impact.ok
      ? impact.counts
      : {
          expectedSummaryRows: 0,
          activeCurriculumLogs: 0,
          activeChapterCompletions: 0,
        },
  };
}

export async function removeCurriculumConfigRowFromSyllabus(params: {
  id: number;
  adminEmail: string;
  body: unknown;
}): Promise<CurriculumConfigRemoveResult> {
  const schema = await checkCurriculumConfigManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const payloadResult = normalizeCurriculumConfigRemovePayload(params.body);
  if (!payloadResult.ok) {
    return payloadResult;
  }

  if (!Number.isInteger(params.id) || params.id <= 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config remove payload",
      fields: { id: "Config id must be positive" },
    };
  }

  const rows = await query<RemoveMutationRow>(buildRemoveFromSyllabusSql(), [
    params.id,
    payloadResult.payload.lockToken,
    params.adminEmail,
  ]);
  const row = rows[0];

  if (!row || row.failure_reason === "missing") {
    return { ok: false, status: 404, error: "Curriculum Config row not found" };
  }
  if (row.failure_reason === "stale") {
    return { ok: false, status: 409, error: "Curriculum Config row is stale" };
  }
  if (row.failure_reason === "already_out_of_syllabus") {
    return {
      ok: false,
      status: 422,
      error: "Invalid Curriculum Config remove payload",
      fields: {
        is_in_syllabus: "Curriculum Config row is already out of syllabus",
      },
    };
  }

  const mappedRow = mapCurriculumConfigRow(row);
  const impact = await getCurriculumConfigImpact({
    chapterId: mappedRow.chapterId,
    examTrack: mappedRow.examTrack,
    configId: mappedRow.id,
    isInSyllabus: mappedRow.isInSyllabus,
    prescribedMinutes: mappedRow.prescribedMinutes,
    coverageSequence: mappedRow.coverageSequence,
  });

  return {
    ok: true,
    row: mappedRow,
    warnings: impact.ok ? impact.warnings : [],
    impact: impact.ok
      ? impact.counts
      : {
          expectedSummaryRows: 0,
          activeCurriculumLogs: 0,
          activeChapterCompletions: 0,
        },
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
    filters.chapterId,
  ];
}

function buildOptionsSql(): string {
  return `
    WITH config_options AS (
      SELECT DISTINCT
        ch.id AS chapter_id,
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
      COALESCE(jsonb_agg(DISTINCT exam_track) FILTER (WHERE exam_track IS NOT NULL), '[]'::jsonb) AS exam_tracks,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', chapter_id,
        'code', chapter_code,
        'name', chapter_name,
        'grade', grade,
        'subjectName', subject_name
      )) FILTER (WHERE chapter_id IS NOT NULL), '[]'::jsonb) AS chapters
    FROM config_options`;
}

function buildBaseListSql(): string {
  return `
    WITH config_rows AS (
      SELECT
        cfg.id AS config_id,
        cfg.xmin::text AS lock_token,
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
      )
      AND ($6::int IS NULL OR chapter_id = $6::int)`;
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
    LIMIT $7 OFFSET $8`;
}

function buildExportRowsSql(
  sort: CurriculumConfigSortKey,
  dir: CurriculumConfigSortDirection
): string {
  return `${buildBaseListSql()}
    ORDER BY ${buildOrderClause(sort, dir)}`;
}

function buildChapterOptionsSql(): string {
  return `
    WITH chapter_options AS (
      SELECT
        ch.id AS chapter_id,
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
        COUNT(DISTINCT t.id)::int AS topic_count,
        cfg.id AS existing_config_id,
        cfg.is_in_syllabus AS existing_is_in_syllabus
      FROM chapter ch
      JOIN grade g ON g.id = ch.grade_id
      JOIN subject s ON s.id = ch.subject_id
      LEFT JOIN (
        topic t
        JOIN topic_curriculum tc
          ON tc.topic_id = t.id
         AND tc.curriculum_id = $2
      ) ON t.chapter_id = ch.id
      LEFT JOIN lms_chapter_exam_configs cfg
        ON cfg.chapter_id = ch.id
       AND cfg.exam_track = $1
      GROUP BY
        ch.id,
        ch.code,
        ch.name,
        g.number,
        s.id,
        s.name,
        cfg.id,
        cfg.is_in_syllabus
    )
    SELECT *
    FROM chapter_options
    WHERE ($3::int IS NULL OR grade = $3::int)
      AND (
        $4::text IS NULL
        OR subject_id::text = $4::text
        OR LOWER(subject_name) = LOWER($4::text)
      )
      AND (
        $5::text IS NULL
        OR LOWER(chapter_code) LIKE $5::text
        OR LOWER(chapter_name) LIKE $5::text
      )
    ORDER BY grade ASC, subject_name ASC, chapter_code ASC, chapter_name ASC
    LIMIT 50`;
}

function buildImpactSql(): string {
  return `
    WITH target_chapter AS (
      SELECT
        ch.id AS chapter_id,
        ch.grade_id,
        ch.subject_id
      FROM chapter ch
      WHERE ch.id = $1
    ),
    expected_summary AS (
      SELECT COUNT(*)::int AS expected_summary_rows
      FROM school s
      CROSS JOIN program p
      CROSS JOIN target_chapter tc
      WHERE s.af_school_category = 'JNV'
        AND p.id = ANY($3::int[])
    ),
    active_logs AS (
      SELECT COUNT(DISTINCT l.id)::int AS active_curriculum_logs
      FROM lms_curriculum_logs l
      JOIN lms_curriculum_log_topics lclt ON lclt.curriculum_log_id = l.id
      JOIN topic t ON t.id = lclt.topic_id
      WHERE t.chapter_id = $1
        AND l.exam_track = $2
        AND l.deleted_at IS NULL
    ),
    active_completions AS (
      SELECT COUNT(*)::int AS active_chapter_completions
      FROM lms_curriculum_chapter_completions cc
      WHERE cc.chapter_id = $1
        AND cc.exam_track = $2
        AND cc.deleted_at IS NULL
    ),
    duplicate_sequences AS (
      SELECT COUNT(*)::int AS duplicate_coverage_count
      FROM lms_chapter_exam_configs dup
      JOIN chapter dup_ch ON dup_ch.id = dup.chapter_id
      JOIN target_chapter tc
        ON tc.grade_id = dup_ch.grade_id
       AND tc.subject_id = dup_ch.subject_id
      WHERE $4::int IS NOT NULL
        AND dup.exam_track = $2
        AND dup.coverage_sequence = $4::int
        AND dup.is_in_syllabus = true
        AND ($5::int IS NULL OR dup.id <> $5::int)
    )
    SELECT
      expected_summary.expected_summary_rows,
      active_logs.active_curriculum_logs,
      active_completions.active_chapter_completions,
      duplicate_sequences.duplicate_coverage_count
    FROM expected_summary
    CROSS JOIN active_logs
    CROSS JOIN active_completions
    CROSS JOIN duplicate_sequences`;
}

function buildCreateSql(): string {
  return `
    WITH target_chapter AS (
      SELECT ch.id
      FROM chapter ch
      WHERE ch.id = $1
    ),
    existing_config AS (
      SELECT cfg.id
      FROM lms_chapter_exam_configs cfg
      WHERE cfg.chapter_id = $1
        AND cfg.exam_track = $2
    ),
    inserted AS (
      INSERT INTO lms_chapter_exam_configs (
        chapter_id,
        exam_track,
        is_in_syllabus,
        prescribed_minutes,
        coverage_sequence,
        inserted_by_email,
        updated_by_email,
        inserted_at,
        updated_at
      )
      SELECT
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $6,
        (NOW() AT TIME ZONE 'UTC'),
        (NOW() AT TIME ZONE 'UTC')
      WHERE EXISTS (SELECT 1 FROM target_chapter)
        AND NOT EXISTS (SELECT 1 FROM existing_config)
      RETURNING
        id,
        xmin::text AS lock_token,
        chapter_id,
        exam_track,
        is_in_syllabus,
        prescribed_minutes,
        coverage_sequence,
        updated_by_email,
        updated_at
    ),
    inserted_row AS (
      SELECT
        NULL::text AS failure_reason,
        inserted.id AS config_id,
        inserted.lock_token,
        inserted.chapter_id,
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
        inserted.exam_track,
        inserted.is_in_syllabus,
        inserted.prescribed_minutes,
        inserted.coverage_sequence,
        inserted.updated_by_email,
        inserted.updated_at
      FROM inserted
      JOIN chapter ch ON ch.id = inserted.chapter_id
      JOIN grade g ON g.id = ch.grade_id
      JOIN subject s ON s.id = ch.subject_id
    ),
    failure AS (
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM target_chapter) THEN 'missing_chapter'
          ELSE 'duplicate'
        END AS failure_reason
      WHERE NOT EXISTS (SELECT 1 FROM inserted)
    )
    SELECT *
    FROM inserted_row
    UNION ALL
    SELECT
      failure_reason,
      NULL::int AS config_id,
      NULL::text AS lock_token,
      NULL::int AS chapter_id,
      NULL::text AS chapter_code,
      NULL::text AS chapter_name,
      NULL::int AS grade,
      NULL::int AS subject_id,
      NULL::text AS subject_name,
      NULL::text AS exam_track,
      NULL::boolean AS is_in_syllabus,
      NULL::int AS prescribed_minutes,
      NULL::int AS coverage_sequence,
      NULL::text AS updated_by_email,
      NULL::timestamp AS updated_at
    FROM failure`;
}

function buildEditSql(): string {
  return `
    WITH current_config AS (
      SELECT
        cfg.id,
        cfg.xmin::text AS current_lock_token,
        cfg.is_in_syllabus AS current_is_in_syllabus
      FROM lms_chapter_exam_configs cfg
      WHERE cfg.id = $1
    ),
    updated AS (
      UPDATE lms_chapter_exam_configs cfg
      SET is_in_syllabus = $2,
          prescribed_minutes = $3,
          coverage_sequence = $4,
          updated_by_email = $6,
          updated_at = (NOW() AT TIME ZONE 'UTC')
      FROM current_config current_config
      WHERE cfg.id = current_config.id
        AND cfg.xmin::text = $5
        AND NOT (
          current_config.current_is_in_syllabus = true
          AND $2::boolean = false
        )
      RETURNING
        cfg.id,
        cfg.xmin::text AS lock_token,
        cfg.chapter_id,
        cfg.exam_track,
        cfg.is_in_syllabus,
        cfg.prescribed_minutes,
        cfg.coverage_sequence,
        cfg.updated_by_email,
        cfg.updated_at
    ),
    updated_row AS (
      SELECT
        NULL::text AS failure_reason,
        updated.id AS config_id,
        updated.lock_token,
        updated.chapter_id,
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
        updated.exam_track,
        updated.is_in_syllabus,
        updated.prescribed_minutes,
        updated.coverage_sequence,
        updated.updated_by_email,
        updated.updated_at
      FROM updated
      JOIN chapter ch
        ON ch.id = updated.chapter_id
      JOIN grade g ON g.id = ch.grade_id
      JOIN subject s ON s.id = ch.subject_id
    ),
    failure AS (
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM current_config) THEN 'missing'
          WHEN NOT EXISTS (
            SELECT 1
            FROM current_config
            WHERE current_lock_token = $5
          ) THEN 'stale'
          WHEN EXISTS (
            SELECT 1
            FROM current_config
            WHERE current_is_in_syllabus = true
          ) AND $2::boolean = false THEN 'removal_not_allowed'
          ELSE 'stale'
        END AS failure_reason
      WHERE NOT EXISTS (SELECT 1 FROM updated)
    )
    SELECT *
    FROM updated_row
    UNION ALL
    SELECT
      failure_reason,
      NULL::int AS config_id,
      NULL::text AS lock_token,
      NULL::int AS chapter_id,
      NULL::text AS chapter_code,
      NULL::text AS chapter_name,
      NULL::int AS grade,
      NULL::int AS subject_id,
      NULL::text AS subject_name,
      NULL::text AS exam_track,
      NULL::boolean AS is_in_syllabus,
      NULL::int AS prescribed_minutes,
      NULL::int AS coverage_sequence,
      NULL::text AS updated_by_email,
      NULL::timestamp AS updated_at
    FROM failure`;
}

function buildRemoveFromSyllabusSql(): string {
  return `
    WITH updated AS (
      UPDATE lms_chapter_exam_configs cfg
      SET is_in_syllabus = false,
          prescribed_minutes = 0,
          updated_by_email = $3,
          updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE cfg.id = $1
        AND cfg.xmin::text = $2
        AND cfg.is_in_syllabus = true
      RETURNING
        cfg.id,
        cfg.xmin::text AS lock_token,
        cfg.chapter_id,
        cfg.exam_track,
        cfg.is_in_syllabus,
        cfg.prescribed_minutes,
        cfg.coverage_sequence,
        cfg.updated_by_email,
        cfg.updated_at
    ),
    updated_row AS (
      SELECT
        NULL::text AS failure_reason,
        updated.id AS config_id,
        updated.lock_token,
        updated.chapter_id,
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
        updated.exam_track,
        updated.is_in_syllabus,
        updated.prescribed_minutes,
        updated.coverage_sequence,
        updated.updated_by_email,
        updated.updated_at
      FROM updated
      JOIN chapter ch
        ON ch.id = updated.chapter_id
      JOIN grade g ON g.id = ch.grade_id
      JOIN subject s ON s.id = ch.subject_id
    ),
    failure AS (
      SELECT
        CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM lms_chapter_exam_configs cfg WHERE cfg.id = $1
          ) THEN 'missing'
          WHEN EXISTS (
            SELECT 1
            FROM lms_chapter_exam_configs cfg
            WHERE cfg.id = $1
              AND cfg.xmin::text = $2
              AND cfg.is_in_syllabus = false
          ) THEN 'already_out_of_syllabus'
          ELSE 'stale'
        END AS failure_reason
      WHERE NOT EXISTS (SELECT 1 FROM updated)
    )
    SELECT *
    FROM updated_row
    UNION ALL
    SELECT
      failure_reason,
      NULL::int AS config_id,
      NULL::text AS lock_token,
      NULL::int AS chapter_id,
      NULL::text AS chapter_code,
      NULL::text AS chapter_name,
      NULL::int AS grade,
      NULL::int AS subject_id,
      NULL::text AS subject_name,
      NULL::text AS exam_track,
      NULL::boolean AS is_in_syllabus,
      NULL::int AS prescribed_minutes,
      NULL::int AS coverage_sequence,
      NULL::text AS updated_by_email,
      NULL::timestamp AS updated_at
    FROM failure`;
}

function buildCurriculumConfigWarnings(params: {
  duplicateCoverageCount: number;
  isInSyllabus?: boolean;
  prescribedMinutes?: number;
}): CurriculumConfigWarning[] {
  const warnings: CurriculumConfigWarning[] = [];

  if (params.duplicateCoverageCount > 0) {
    warnings.push({
      code: "duplicate_coverage_sequence",
      message:
        "Another in-syllabus row in the same Grade, Subject, and Exam Track already uses this coverage order.",
    });
  }

  if (params.isInSyllabus === true && params.prescribedMinutes === 0) {
    warnings.push({
      code: "zero_prescribed_minutes",
      message:
        "This in-syllabus row has zero prescribed minutes and will still appear in Curriculum Summary.",
    });
  }

  return warnings;
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

function formatCurriculumConfigCsv(rows: CurriculumConfigRow[]): string {
  const header = [
    "chapter_code",
    "chapter_name",
    "grade",
    "subject",
    "exam_track",
    "is_in_syllabus",
    "prescribed_minutes",
    "prescribed_hours",
    "coverage_sequence",
    "updated_by_email",
    "updated_at",
  ];
  const body = rows.map((row) =>
    [
      row.chapterCode,
      row.chapterName,
      row.grade,
      row.subjectName,
      row.examTrack,
      row.isInSyllabus,
      row.prescribedMinutes,
      formatPrescribedHours(row.prescribedHours),
      row.coverageSequence,
      row.updatedByEmail,
      row.updatedAt,
    ]
      .map(csvCell)
      .join(",")
  );

  return [header.join(","), ...body].join("\r\n");
}

function csvCell(value: string | number | boolean): string {
  const raw = String(value);
  const escapedForFormula = formulaEscape(raw);
  const mustQuote =
    raw.startsWith("=") ||
    raw.startsWith("+") ||
    /[",\r\n\t]/.test(escapedForFormula);

  if (!mustQuote) {
    return escapedForFormula;
  }

  return `"${escapedForFormula.replaceAll('"', '""')}"`;
}

function formulaEscape(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function formatPrescribedHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(hours);
}

function formatExportDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mapFilterOptions(row: ConfigOptionsQueryRow | undefined): CurriculumConfigFilterOptions {
  const subjects = parseJsonArray<{ id: unknown; name: unknown }>(row?.subjects)
    .map((subject) => ({
      id: numberFromDb(subject.id as string | number | null | undefined),
      name: localizedName(subject.name, "subject", subject.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const chapters = parseJsonArray<{
    id: unknown;
    code: unknown;
    name: unknown;
    grade: unknown;
    subjectName: unknown;
  }>(row?.chapters)
    .map((chapter) => ({
      id: numberFromDb(chapter.id as string | number | null | undefined),
      code: String(chapter.code ?? ""),
      name: localizedName(chapter.name, "chapter", chapter.code),
      grade: numberFromDb(chapter.grade as string | number | null | undefined),
      subjectName: localizedName(chapter.subjectName, "subject", chapter.subjectName),
    }))
    .sort(
      (a, b) =>
        a.grade - b.grade ||
        a.subjectName.localeCompare(b.subjectName) ||
        a.code.localeCompare(b.code) ||
        a.name.localeCompare(b.name)
    );

  return {
    grades: parseJsonArray<number>(row?.grades).map(Number).sort((a, b) => a - b),
    subjects,
    examTracks: EXAM_TRACKS.filter((track) =>
      parseJsonArray<string>(row?.exam_tracks).includes(track)
    ),
    syllabusStatuses: ["in_syllabus", "out_of_syllabus", "all"],
    chapters,
  };
}

function mapCurriculumConfigChapterOption(
  row: CurriculumConfigChapterOptionQueryRow
): CurriculumConfigChapterOption {
  const topicCount = numberFromDb(row.topic_count);
  const existingConfigId = row.existing_config_id
    ? numberFromDb(row.existing_config_id)
    : null;
  const existingIsInSyllabus =
    row.existing_is_in_syllabus === null
      ? null
      : row.existing_is_in_syllabus === true ||
        row.existing_is_in_syllabus === "true";

  return {
    chapterId: numberFromDb(row.chapter_id),
    chapterCode: String(row.chapter_code ?? ""),
    chapterName: localizedName(row.chapter_name, "chapter", row.chapter_code),
    grade: numberFromDb(row.grade),
    subjectId: numberFromDb(row.subject_id),
    subjectName: localizedName(row.subject_name, "subject", "Unknown subject"),
    topicCount,
    hasTopics: topicCount > 0,
    topicWarning: topicCount > 0 ? "" : "This chapter has no topics.",
    existingConfigId,
    configExists: existingConfigId !== null,
    existingIsInSyllabus,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function integerFromPayload(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
