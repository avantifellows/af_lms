import { query } from "./db";
import { type UserPermission } from "./permissions";
import { makeSchemaChecker, requireAdmin } from "./admin-guard";
import { isExamTrack, type ExamTrack } from "./exam-tracks";
import {
  CENTRE_COMMON_SCHEMA_COLUMNS,
  findMissingSchemaColumns,
} from "./schema-columns";

export type CentreOptionSetCode = "type" | "category" | "sub_category";

// Correlated subquery yielding a user's active centre assignments as a JSON
// array of { centreName, role }, aliased `centres`. Embed inside a SELECT over
// `user_permission` (it references `user_permission.user_id`). Shared by the
// admin users page and the /api/admin/users route so they can't drift.
export const CENTRE_ASSIGNMENTS_SUBQUERY = `COALESCE((
  SELECT json_agg(
           json_build_object('centreName', c.name, 'role', cp.role)
           ORDER BY c.name, cp.role
         )
  FROM centre_positions cp
  JOIN centres c ON c.id = cp.centre_id
  WHERE cp.user_id = user_permission.user_id AND cp.deleted_at IS NULL
), '[]'::json) AS centres`;

export interface CentreSchemaReady {
  ok: true;
}

export interface CentreSchemaUnavailable {
  ok: false;
  status: 503;
  error: "Centre management schema unavailable";
  details: string[];
}

export type CentreSchemaStatus = CentreSchemaReady | CentreSchemaUnavailable;

export interface CentreOption {
  id: number;
  optionSetCode: CentreOptionSetCode;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  insertedAt: string;
  updatedAt: string;
}

export interface CentreOptionSet {
  id: number;
  code: CentreOptionSetCode;
  label: string;
  allowMulti: boolean;
  sortOrder: number;
  options: CentreOption[];
}

export type CentreBooleanFilter = "all" | "true" | "false";
export type CentreSchoolLinkFilter = "all" | "linked" | "unlinked";

export interface CentreListFilters {
  search: string;
  searchTerms: string[];
  active: CentreBooleanFilter;
  schoolLink: CentreSchoolLinkFilter;
  typeCode: string | null;
  categoryCode: string | null;
  subCategoryCode: string | null;
  isPhysical: CentreBooleanFilter;
}

export interface CentreListParams {
  page: number;
  limit: number;
  offset: number;
  filters: CentreListFilters;
}

export interface CentreListRow {
  id: number;
  name: string;
  schoolId: number | null;
  typeCode: string | null;
  typeLabel: string | null;
  typeOptionActive: boolean | null;
  categoryCode: string | null;
  categoryLabel: string | null;
  categoryOptionActive: boolean | null;
  subCategoryCode: string | null;
  subCategoryLabel: string | null;
  subCategoryOptionActive: boolean | null;
  grade11ExamTrackCodes: ExamTrack[];
  grade12ExamTrackCodes: ExamTrack[];
  isPhysical: boolean;
  isActive: boolean;
  programId: number | null;
  programName: string | null;
  insertedAt: string;
  updatedAt: string;
  school: {
    id: number;
    name: string;
    code: string;
    udiseCode: string;
    region: string;
    state: string;
    district: string;
  } | null;
}

export type CentreAdminSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

export type CentreAdminResult =
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

export type CentreOptionSetsResult =
  | {
      ok: true;
      optionSets: CentreOptionSet[];
    }
  | CentreSchemaUnavailable;

export type CentreListResult =
  | {
      ok: true;
      filters: CentreListFilters;
      rows: CentreListRow[];
      summary: CentreListSummary;
      pagination: {
        page: number;
        limit: number;
        totalRows: number;
        totalPages: number;
      };
    }
  | CentreSchemaUnavailable;

export interface CentreListSummary {
  totalCentres: number;
  activeCentres: number;
  linkedCentres: number;
  physicalCentres: number;
}

export interface CentreSearchSuggestion {
  kind: "centre_name" | "school_name" | "school_code" | "udise";
  value: string;
  label: string;
  detail: string;
}

export type CentreSearchSuggestionsResult =
  | {
      ok: true;
      suggestions: CentreSearchSuggestion[];
    }
  | CentreSchemaUnavailable;

export type CentreMutationResult =
  | {
      ok: true;
      centre: CentreListRow;
    }
  | CentreValidationFailure
  | CentreSchemaUnavailable
  | { ok: false; status: 404; error: string };

export type CentreValidationFailure = {
  ok: false;
  status: 422;
  error: string;
  fields: Record<string, string>;
};

export type CentreOptionMutationResult =
  | {
      ok: true;
      option: CentreOption;
    }
  | CentreValidationFailure
  | CentreSchemaUnavailable
  | { ok: false; status: 404 | 409; error: string };

export function safeCentreApiError<T extends { ok: false; details?: unknown }>(
  result: T
): Omit<T, "details"> {
  const { details, ...safeResult } = result;
  void details;
  return safeResult;
}

interface CentreOptionCreatePayload {
  optionSetCode: CentreOptionSetCode;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

interface CentreOptionEditPayload {
  label: string;
  sortOrder: number;
  isActive: boolean;
}

interface CentreCreatePayload {
  name: string;
  schoolId: number | null;
  typeCode: string | null;
  categoryCode: string | null;
  subCategoryCode: string | null;
  grade11ExamTrackCodes: ExamTrack[];
  grade12ExamTrackCodes: ExamTrack[];
  isPhysical: boolean;
  isActive: boolean;
  programId: number | null;
}

interface CentreOptionSetQueryRow {
  option_set_id: string | number;
  option_set_code: string;
  option_set_label: string | null;
  allow_multi: boolean | string | null;
  option_set_sort_order: string | number | null;
  option_id: string | number | null;
  option_code: string | null;
  option_label: string | null;
  option_sort_order: string | number | null;
  option_is_active: boolean | string | null;
  option_inserted_at: string | Date | null;
  option_updated_at: string | Date | null;
}

interface CentreOptionMutationRow {
  option_id: string | number | null;
  option_set_code: string | null;
  option_code: string | null;
  option_label: string | null;
  option_sort_order: string | number | null;
  option_is_active: boolean | string | null;
  option_inserted_at: string | Date | null;
  option_updated_at: string | Date | null;
}

interface CentreListQueryRow {
  id: string | number;
  name: string | null;
  school_id: string | number | null;
  type_code: string | null;
  type_label: string | null;
  type_is_active: boolean | string | null;
  category_code: string | null;
  category_label: string | null;
  category_is_active: boolean | string | null;
  sub_category_code: string | null;
  sub_category_label: string | null;
  sub_category_is_active: boolean | string | null;
  grade_11_exam_track_codes: string[] | null;
  grade_12_exam_track_codes: string[] | null;
  is_physical: boolean | string | null;
  is_active: boolean | string | null;
  program_id: string | number | null;
  program_name: string | null;
  inserted_at: string | Date | null;
  updated_at: string | Date | null;
  school_name: string | null;
  school_code: string | null;
  school_udise_code: string | null;
  school_region: string | null;
  school_state: string | null;
  school_district: string | null;
  total_count: string | number | null;
  active_count?: string | number | null;
  linked_count?: string | number | null;
  physical_count?: string | number | null;
}

const FIXED_OPTION_SET_CODES: CentreOptionSetCode[] = [
  "type",
  "category",
  "sub_category",
];

const REQUIRED_CENTRE_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "centre_option_sets", column: "id" },
  { table: "centre_option_sets", column: "code" },
  { table: "centre_option_sets", column: "label" },
  { table: "centre_option_sets", column: "allow_multi" },
  { table: "centre_option_sets", column: "sort_order" },
  { table: "centre_option_sets", column: "inserted_at" },
  { table: "centre_option_sets", column: "updated_at" },
  { table: "centre_options", column: "id" },
  { table: "centre_options", column: "option_set_id" },
  { table: "centre_options", column: "code" },
  { table: "centre_options", column: "label" },
  { table: "centre_options", column: "sort_order" },
  { table: "centre_options", column: "is_active" },
  { table: "centre_options", column: "inserted_at" },
  { table: "centre_options", column: "updated_at" },
  ...CENTRE_COMMON_SCHEMA_COLUMNS,
  { table: "centres", column: "program_id" },
  { table: "centre_exam_tracks", column: "id" },
  { table: "centre_exam_tracks", column: "centre_id" },
  { table: "centre_exam_tracks", column: "grade_id" },
  { table: "centre_exam_tracks", column: "exam_track_code" },
  { table: "centre_exam_tracks", column: "inserted_at" },
  { table: "centre_exam_tracks", column: "updated_at" },
];

export function fixedCentreOptionSetCodes(): CentreOptionSetCode[] {
  return [...FIXED_OPTION_SET_CODES];
}

export function isFixedCentreOptionSetCode(value: unknown): value is CentreOptionSetCode {
  return (
    typeof value === "string" &&
    FIXED_OPTION_SET_CODES.includes(value as CentreOptionSetCode)
  );
}

export function isActiveCentreOptionCode(
  optionSets: CentreOptionSet[],
  optionSetCode: CentreOptionSetCode,
  optionCode: string | null | undefined
): boolean {
  if (!optionCode) return false;
  const optionSet = optionSets.find((set) => set.code === optionSetCode);
  return (
    optionSet?.options.some(
      (option) => option.code === optionCode && option.isActive
    ) ?? false
  );
}

export async function requireCentreAdmin(
  session: CentreAdminSession
): Promise<CentreAdminResult> {
  return requireAdmin(session);
}

const centreSchemaChecker = makeSchemaChecker(loadCentreSchemaStatus);

export function checkCentreManagementSchema(): Promise<CentreSchemaStatus> {
  return centreSchemaChecker.check();
}

export function resetCentreSchemaCheckForTests() {
  centreSchemaChecker.reset();
}

export async function getCentreOptionSets(): Promise<CentreOptionSetsResult> {
  const schema = await checkCentreManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const rows = await query<CentreOptionSetQueryRow>(
    `SELECT
       option_sets.id AS option_set_id,
       option_sets.code AS option_set_code,
       option_sets.label AS option_set_label,
       option_sets.allow_multi,
       option_sets.sort_order AS option_set_sort_order,
       options.id AS option_id,
       options.code AS option_code,
       options.label AS option_label,
       options.sort_order AS option_sort_order,
       options.is_active AS option_is_active,
       options.inserted_at AS option_inserted_at,
       options.updated_at AS option_updated_at
     FROM centre_option_sets option_sets
     LEFT JOIN centre_options options
       ON options.option_set_id = option_sets.id
     WHERE option_sets.code = ANY($1::text[])
     ORDER BY
       array_position($1::text[], option_sets.code),
       options.sort_order ASC NULLS LAST,
       options.label ASC NULLS LAST,
       options.code ASC NULLS LAST`,
    [FIXED_OPTION_SET_CODES]
  );

  return { ok: true, optionSets: mapCentreOptionSetRows(rows) };
}

export function normalizeCentreListParams(searchParams: {
  [key: string]: string | string[] | undefined;
}): CentreListParams {
  const page = positiveInteger(searchParams.page, 1);
  // Default to the max page size so the directory shows every Centre on one
  // page until the count crosses 100, at which point pagination kicks in.
  const limit = clamp(positiveInteger(searchParams.limit, 100), 1, 100);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    filters: {
      search: stringParam(searchParams.search),
      searchTerms: stringArrayParam(searchParams.search_terms),
      active: booleanFilter(searchParams.active),
      schoolLink: schoolLinkFilter(searchParams.school_link),
      typeCode: nullableCodeParam(searchParams.type),
      categoryCode: nullableCodeParam(searchParams.category),
      subCategoryCode: nullableCodeParam(searchParams.sub_category),
      isPhysical: booleanFilter(searchParams.is_physical),
    },
  };
}

export async function getCentreList(params: {
  searchParams: { [key: string]: string | string[] | undefined };
}): Promise<CentreListResult> {
  const schema = await checkCentreManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const normalized = normalizeCentreListParams(params.searchParams);
  const whereClauses: string[] = [];
  const values: unknown[] = [];
  const addParam = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  const searchTerms = [
    ...normalized.filters.searchTerms,
    normalized.filters.search,
  ].filter(Boolean);
  if (searchTerms.length > 0) {
    const termClauses = searchTerms.map((term) => {
      const placeholder = addParam(`%${term}%`);
      return `(centres.name ILIKE ${placeholder}
        OR schools.name ILIKE ${placeholder}
        OR schools.code ILIKE ${placeholder}
        OR schools.udise_code ILIKE ${placeholder})`;
    });
    whereClauses.push(`(${termClauses.join(" OR ")})`);
  }
  if (normalized.filters.active !== "all") {
    whereClauses.push(
      `centres.is_active = ${addParam(normalized.filters.active === "true")}`
    );
  }
  if (normalized.filters.schoolLink === "linked") {
    whereClauses.push("centres.school_id IS NOT NULL");
  } else if (normalized.filters.schoolLink === "unlinked") {
    whereClauses.push("centres.school_id IS NULL");
  }
  if (normalized.filters.typeCode) {
    whereClauses.push(`centres.type_code = ${addParam(normalized.filters.typeCode)}`);
  }
  if (normalized.filters.categoryCode) {
    whereClauses.push(
      `centres.category_code = ${addParam(normalized.filters.categoryCode)}`
    );
  }
  if (normalized.filters.subCategoryCode) {
    whereClauses.push(
      `centres.sub_category_code = ${addParam(
        normalized.filters.subCategoryCode
      )}`
    );
  }
  if (normalized.filters.isPhysical !== "all") {
    whereClauses.push(
      `centres.is_physical = ${addParam(
        normalized.filters.isPhysical === "true"
      )}`
    );
  }

  values.push(normalized.limit, normalized.offset);
  const limitParam = `$${values.length - 1}`;
  const offsetParam = `$${values.length}`;
  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const rows = await query<CentreListQueryRow>(
    `SELECT
       centres.id,
       centres.name,
       centres.school_id,
       centres.type_code,
       type_options.label AS type_label,
       type_options.is_active AS type_is_active,
       centres.category_code,
       category_options.label AS category_label,
       category_options.is_active AS category_is_active,
       centres.sub_category_code,
       sub_category_options.label AS sub_category_label,
       sub_category_options.is_active AS sub_category_is_active,
       COALESCE(exam_tracks.grade_11_codes, '{}'::text[]) AS grade_11_exam_track_codes,
       COALESCE(exam_tracks.grade_12_codes, '{}'::text[]) AS grade_12_exam_track_codes,
       centres.is_physical,
       centres.is_active,
       centres.program_id,
       programs.name AS program_name,
       centres.inserted_at,
       centres.updated_at,
       schools.name AS school_name,
       schools.code AS school_code,
       schools.udise_code AS school_udise_code,
       schools.region AS school_region,
       schools.state AS school_state,
       schools.district AS school_district,
       COUNT(*) OVER() AS total_count,
       COUNT(*) FILTER (WHERE centres.is_active) OVER() AS active_count,
       COUNT(*) FILTER (WHERE centres.school_id IS NOT NULL) OVER() AS linked_count,
       COUNT(*) FILTER (WHERE centres.is_physical) OVER() AS physical_count
     FROM centres
     LEFT JOIN school schools
       ON schools.id = centres.school_id
     LEFT JOIN program programs
       ON programs.id = centres.program_id
     LEFT JOIN centre_option_sets type_set
       ON type_set.code = 'type'
     LEFT JOIN centre_options type_options
       ON type_options.option_set_id = type_set.id
      AND type_options.code = centres.type_code
     LEFT JOIN centre_option_sets category_set
       ON category_set.code = 'category'
     LEFT JOIN centre_options category_options
       ON category_options.option_set_id = category_set.id
      AND category_options.code = centres.category_code
     LEFT JOIN centre_option_sets sub_category_set
       ON sub_category_set.code = 'sub_category'
     LEFT JOIN centre_options sub_category_options
       ON sub_category_options.option_set_id = sub_category_set.id
      AND sub_category_options.code = centres.sub_category_code
     LEFT JOIN LATERAL (
       SELECT
         array_agg(mapping.exam_track_code ORDER BY mapping.exam_track_code)
           FILTER (WHERE grades.number = 11) AS grade_11_codes,
         array_agg(mapping.exam_track_code ORDER BY mapping.exam_track_code)
           FILTER (WHERE grades.number = 12) AS grade_12_codes
       FROM centre_exam_tracks mapping
       JOIN grade grades ON grades.id = mapping.grade_id
       WHERE mapping.centre_id = centres.id
     ) exam_tracks ON true
     ${whereSql}
     ORDER BY centres.name ASC, centres.id ASC
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    values
  );

  const totalRows = numberFromDb(rows[0]?.total_count ?? 0);
  const summary: CentreListSummary = {
    totalCentres: totalRows,
    activeCentres: numberFromDb(rows[0]?.active_count ?? 0),
    linkedCentres: numberFromDb(rows[0]?.linked_count ?? 0),
    physicalCentres: numberFromDb(rows[0]?.physical_count ?? 0),
  };

  return {
    ok: true,
    filters: normalized.filters,
    rows: rows.map(mapCentreListRow),
    summary,
    pagination: {
      page: normalized.page,
      limit: normalized.limit,
      totalRows,
      totalPages: Math.ceil(totalRows / normalized.limit),
    },
  };
}

export async function getCentreSearchSuggestions(params: {
  search: string;
  limit?: number;
}): Promise<CentreSearchSuggestionsResult> {
  const schema = await checkCentreManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const search = params.search.trim();
  if (!search) {
    return { ok: true, suggestions: [] };
  }

  const limit = clamp(params.limit ?? 8, 1, 20);
  const rows = await query<{
    kind: CentreSearchSuggestion["kind"];
    value: string | null;
    label: string | null;
    detail: string | null;
  }>(
    `WITH candidates AS (
       SELECT 'centre_name'::text AS kind,
              centres.name AS value,
              centres.name AS label,
              'Centre name'::text AS detail
       FROM centres
       WHERE centres.name ILIKE $1

       UNION ALL

       SELECT 'school_name'::text AS kind,
              schools.name AS value,
              schools.name AS label,
              'School name'::text AS detail
       FROM centres
       JOIN school schools
         ON schools.id = centres.school_id
       WHERE schools.name ILIKE $1

       UNION ALL

       SELECT 'school_code'::text AS kind,
              schools.code AS value,
              schools.code AS label,
              COALESCE(schools.name, 'School code') AS detail
       FROM centres
       JOIN school schools
         ON schools.id = centres.school_id
       WHERE schools.code ILIKE $1

       UNION ALL

       SELECT 'udise'::text AS kind,
              schools.udise_code AS value,
              schools.udise_code AS label,
              COALESCE(schools.name, 'UDISE') AS detail
       FROM centres
       JOIN school schools
         ON schools.id = centres.school_id
       WHERE schools.udise_code ILIKE $1
     )
     SELECT kind, value, label, detail
     FROM candidates
     WHERE value IS NOT NULL AND value <> ''
     GROUP BY kind, value, label, detail
     ORDER BY
       CASE
         WHEN lower(value) = lower($2) THEN 0
         WHEN lower(value) LIKE lower($3) THEN 1
         ELSE 2
       END,
       length(value) ASC,
       value ASC
     LIMIT $4`,
    [`%${search}%`, search, `${search}%`, limit]
  );

  return {
    ok: true,
    suggestions: rows
      .filter((row) => row.value && row.label)
      .map((row) => ({
        kind: row.kind,
        value: row.value!,
        label: row.label!,
        detail: row.detail ?? "",
      })),
  };
}

export async function createCentre(params: {
  body: unknown;
}): Promise<CentreMutationResult> {
  const schema = await checkCentreManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const payload = normalizeCentrePayload(params.body, null);
  if (!payload.ok) {
    return payload;
  }

  const optionSets = await getCentreOptionSets();
  if (!optionSets.ok) {
    return optionSets;
  }

  const validation = await validateCentreMutationReferences(
    payload.payload,
    optionSets.optionSets,
    null
  );
  if (!validation.ok) return validation;

  const rows = await query<CentreListQueryRow>(
    centreMutationReturningSql(
      `INSERT INTO centres
         (name, school_id, type_code, category_code, sub_category_code, is_physical, is_active, program_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      { grade11: 9, grade12: 10 }
    ),
    [
      payload.payload.name,
      payload.payload.schoolId,
      payload.payload.typeCode,
      payload.payload.categoryCode,
      payload.payload.subCategoryCode,
      payload.payload.isPhysical,
      payload.payload.isActive,
      payload.payload.programId,
      payload.payload.grade11ExamTrackCodes,
      payload.payload.grade12ExamTrackCodes,
    ]
  );

  return { ok: true, centre: mapCentreListRow(rows[0]) };
}

export async function updateCentre(params: {
  id: number;
  body: unknown;
}): Promise<CentreMutationResult> {
  const schema = await checkCentreManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const existing = await getCentreById(params.id);
  if (!existing) {
    return { ok: false, status: 404, error: "Centre not found" };
  }

  const payload = normalizeCentrePayload(params.body, existing);
  if (!payload.ok) {
    return payload;
  }

  const optionSets = await getCentreOptionSets();
  if (!optionSets.ok) {
    return optionSets;
  }

  const validation = await validateCentreMutationReferences(
    payload.payload,
    optionSets.optionSets,
    existing
  );
  if (!validation.ok) return validation;

  const rows = await query<CentreListQueryRow>(
    centreMutationReturningSql(
      `UPDATE centres
       SET name = $2,
           school_id = $3,
           type_code = $4,
           category_code = $5,
           sub_category_code = $6,
           is_physical = $7,
           is_active = $8,
           program_id = $9,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      { grade11: 10, grade12: 11 }
    ),
    [
      params.id,
      payload.payload.name,
      payload.payload.schoolId,
      payload.payload.typeCode,
      payload.payload.categoryCode,
      payload.payload.subCategoryCode,
      payload.payload.isPhysical,
      payload.payload.isActive,
      payload.payload.programId,
      payload.payload.grade11ExamTrackCodes,
      payload.payload.grade12ExamTrackCodes,
    ]
  );

  if (rows.length === 0) {
    return { ok: false, status: 404, error: "Centre not found" };
  }

  return { ok: true, centre: mapCentreListRow(rows[0]) };
}

export async function createCentreOption(params: {
  body: unknown;
}): Promise<CentreOptionMutationResult> {
  const schema = await checkCentreManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const payload = normalizeCentreOptionCreatePayload(params.body);
  if (!payload.ok) {
    return payload;
  }

  let rows: CentreOptionMutationRow[];
  try {
    rows = await query<CentreOptionMutationRow>(
      `WITH selected_set AS (
         SELECT id, code
         FROM centre_option_sets
         WHERE code = $1
       )
       INSERT INTO centre_options (option_set_id, code, label, sort_order, is_active)
       SELECT selected_set.id, $2, $3, $4, $5
       FROM selected_set
       RETURNING
         centre_options.id AS option_id,
         (SELECT code FROM selected_set) AS option_set_code,
         centre_options.code AS option_code,
         centre_options.label AS option_label,
         centre_options.sort_order AS option_sort_order,
         centre_options.is_active AS option_is_active,
         centre_options.inserted_at AS option_inserted_at,
         centre_options.updated_at AS option_updated_at`,
      [
        payload.payload.optionSetCode,
        payload.payload.code,
        payload.payload.label,
        payload.payload.sortOrder,
        payload.payload.isActive,
      ]
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        ok: false,
        status: 409,
        error: "Centre option code already exists in this option set",
      };
    }
    throw error;
  }

  if (rows.length === 0) {
    return { ok: false, status: 404, error: "Centre option set not found" };
  }

  return { ok: true, option: mapCentreOptionMutationRow(rows[0]) };
}

export async function updateCentreOption(params: {
  id: number;
  body: unknown;
}): Promise<CentreOptionMutationResult> {
  if (!Number.isInteger(params.id) || params.id < 1) {
    return { ok: false, status: 404, error: "Centre option not found" };
  }

  const schema = await checkCentreManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const payload = normalizeCentreOptionEditPayload(params.body);
  if (!payload.ok) {
    return payload;
  }

  const rows = await query<CentreOptionMutationRow>(
    `UPDATE centre_options options
     SET label = $2,
         sort_order = $3,
         is_active = $4,
         updated_at = NOW()
     FROM centre_option_sets option_sets
     WHERE options.id = $1
       AND option_sets.id = options.option_set_id
     RETURNING
       options.id AS option_id,
       option_sets.code AS option_set_code,
       options.code AS option_code,
       options.label AS option_label,
       options.sort_order AS option_sort_order,
       options.is_active AS option_is_active,
       options.inserted_at AS option_inserted_at,
       options.updated_at AS option_updated_at`,
    [
      params.id,
      payload.payload.label,
      payload.payload.sortOrder,
      payload.payload.isActive,
    ]
  );

  if (rows.length === 0) {
    return { ok: false, status: 404, error: "Centre option not found" };
  }

  return { ok: true, option: mapCentreOptionMutationRow(rows[0]) };
}

function mapCentreOptionSetRows(rows: CentreOptionSetQueryRow[]): CentreOptionSet[] {
  const byCode = new Map<CentreOptionSetCode, CentreOptionSet>();

  for (const row of rows) {
    if (!isFixedCentreOptionSetCode(row.option_set_code)) continue;

    let optionSet = byCode.get(row.option_set_code);
    if (!optionSet) {
      optionSet = {
        id: numberFromDb(row.option_set_id),
        code: row.option_set_code,
        label: String(row.option_set_label ?? ""),
        allowMulti: booleanFromDb(row.allow_multi),
        sortOrder: numberFromDb(row.option_set_sort_order),
        options: [],
      };
      byCode.set(row.option_set_code, optionSet);
    }

    if (row.option_id === null || row.option_code === null) continue;

    optionSet.options.push({
      id: numberFromDb(row.option_id),
      optionSetCode: row.option_set_code,
      code: row.option_code,
      label: String(row.option_label ?? ""),
      sortOrder: numberFromDb(row.option_sort_order),
      isActive: booleanFromDb(row.option_is_active),
      insertedAt: row.option_inserted_at ? String(row.option_inserted_at) : "",
      updatedAt: row.option_updated_at ? String(row.option_updated_at) : "",
    });
  }

  return FIXED_OPTION_SET_CODES.flatMap((code) => {
    const optionSet = byCode.get(code);
    return optionSet ? [optionSet] : [];
  });
}

function mapCentreOptionMutationRow(row: CentreOptionMutationRow): CentreOption {
  const optionSetCode = isFixedCentreOptionSetCode(row.option_set_code)
    ? row.option_set_code
    : "type";

  return {
    id: numberFromDb(row.option_id),
    optionSetCode,
    code: String(row.option_code ?? ""),
    label: String(row.option_label ?? ""),
    sortOrder: numberFromDb(row.option_sort_order),
    isActive: booleanFromDb(row.option_is_active),
    insertedAt: row.option_inserted_at ? String(row.option_inserted_at) : "",
    updatedAt: row.option_updated_at ? String(row.option_updated_at) : "",
  };
}

// fallow-ignore-next-line complexity
function mapCentreListRow(row: CentreListQueryRow): CentreListRow {
  const schoolId = row.school_id === null ? null : numberFromDb(row.school_id);

  return {
    id: numberFromDb(row.id),
    name: String(row.name ?? ""),
    schoolId,
    typeCode: row.type_code,
    typeLabel: row.type_label,
    typeOptionActive:
      row.type_is_active === null ? null : booleanFromDb(row.type_is_active),
    categoryCode: row.category_code,
    categoryLabel: row.category_label,
    categoryOptionActive:
      row.category_is_active === null
        ? null
        : booleanFromDb(row.category_is_active),
    subCategoryCode: row.sub_category_code,
    subCategoryLabel: row.sub_category_label,
    subCategoryOptionActive:
      row.sub_category_is_active === null
        ? null
        : booleanFromDb(row.sub_category_is_active),
    grade11ExamTrackCodes: examTracksFromDb(row.grade_11_exam_track_codes),
    grade12ExamTrackCodes: examTracksFromDb(row.grade_12_exam_track_codes),
    isPhysical: booleanFromDb(row.is_physical),
    isActive: booleanFromDb(row.is_active),
    programId: row.program_id == null ? null : numberFromDb(row.program_id),
    programName: row.program_name ?? null,
    insertedAt: row.inserted_at ? String(row.inserted_at) : "",
    updatedAt: row.updated_at ? String(row.updated_at) : "",
    school:
      schoolId === null
        ? null
        : {
            id: schoolId,
            name: String(row.school_name ?? ""),
            code: String(row.school_code ?? ""),
            udiseCode: String(row.school_udise_code ?? ""),
            region: String(row.school_region ?? ""),
            state: String(row.school_state ?? ""),
            district: String(row.school_district ?? ""),
          },
  };
}

function normalizeCentreOptionCreatePayload(
  body: unknown
):
  | { ok: true; payload: CentreOptionCreatePayload }
  | CentreValidationFailure {
  const payload = isPlainObject(body) ? body : {};
  const fields: Record<string, string> = {};
  const allowedKeys = new Set([
    "option_set_code",
    "code",
    "label",
    "sort_order",
    "is_active",
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      fields[key] = "Field is not editable";
    }
  }

  const optionSetCode = payload.option_set_code;
  const code = typeof payload.code === "string" ? payload.code.trim() : "";
  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  const sortOrder = integerFromPayload(payload.sort_order);
  const isActive =
    typeof payload.is_active === "boolean" ? payload.is_active : null;

  if (!isFixedCentreOptionSetCode(optionSetCode)) {
    fields.option_set_code = "Invalid Centre option set";
  }
  if (!code) {
    fields.code = "Option code is required";
  }
  if (!label) {
    fields.label = "Option label is required";
  }
  if (sortOrder === null || sortOrder < 0) {
    fields.sort_order = "Sort order must be zero or greater";
  }
  if (isActive === null) {
    fields.is_active = "Active state is required";
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Centre option create payload",
      fields,
    };
  }

  return {
    ok: true,
    payload: {
      optionSetCode: optionSetCode as CentreOptionSetCode,
      code,
      label,
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    },
  };
}

function normalizeCentreOptionEditPayload(
  body: unknown
):
  | { ok: true; payload: CentreOptionEditPayload }
  | CentreValidationFailure {
  const payload = isPlainObject(body) ? body : {};
  const fields: Record<string, string> = {};
  const allowedKeys = new Set(["label", "sort_order", "is_active"]);

  for (const key of Object.keys(payload)) {
    if (allowedKeys.has(key)) continue;
    if (key === "code") {
      fields[key] = "Option code is read-only";
    } else if (key === "option_set_code" || key === "option_set_id") {
      fields[key] = "Option set is read-only";
    } else {
      fields[key] = "Field is not editable";
    }
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Centre option edit payload",
      fields,
    };
  }

  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  const sortOrder = integerFromPayload(payload.sort_order);
  const isActive =
    typeof payload.is_active === "boolean" ? payload.is_active : null;

  if (!label) {
    fields.label = "Option label is required";
  }
  if (sortOrder === null || sortOrder < 0) {
    fields.sort_order = "Sort order must be zero or greater";
  }
  if (isActive === null) {
    fields.is_active = "Active state is required";
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Centre option edit payload",
      fields,
    };
  }

  return {
    ok: true,
    payload: {
      label,
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    },
  };
}

const CENTRE_PAYLOAD_KEYS = new Set([
  "name",
  "school_id",
  "type_code",
  "category_code",
  "sub_category_code",
  "grade_11_exam_track_codes",
  "grade_12_exam_track_codes",
  "is_physical",
  "is_active",
  "program_id",
]);

function addUnknownCentrePayloadErrors(
  payload: Record<string, unknown>,
  fields: Record<string, string>
): void {
  for (const key of Object.keys(payload)) {
    if (!CENTRE_PAYLOAD_KEYS.has(key)) {
      fields[key] = /^grade_\d+_exam_track_codes$/.test(key)
        ? "Only Grade 11 and Grade 12 Exam Tracks are supported"
        : "Field is not editable";
    }
  }
}

function addCentrePayloadValueErrors(params: {
  fields: Record<string, string>;
  requireName: boolean;
  name: string;
  schoolId: number | null | undefined;
  programId: number | null | undefined;
  grade11ExamTrackCodes: ExamTrack[] | null;
  grade12ExamTrackCodes: ExamTrack[] | null;
  isPhysical: boolean | null;
  isActive: boolean | null;
}): void {
  if (params.requireName && !params.name) {
    params.fields.name = "Centre name is required";
  }
  if (params.schoolId === undefined) {
    params.fields.school_id = "School id must be a positive integer or null";
  }
  if (params.programId === undefined) {
    params.fields.program_id = "Program id must be a positive integer or null";
  }
  if (params.grade11ExamTrackCodes === null) {
    params.fields.grade_11_exam_track_codes =
      "Grade 11 Exam Tracks must use supported codes";
  }
  if (params.grade12ExamTrackCodes === null) {
    params.fields.grade_12_exam_track_codes =
      "Grade 12 Exam Tracks must use supported codes";
  }
  if (params.isPhysical === null) {
    params.fields.is_physical = "Physical status is required";
  }
  if (params.isActive === null) {
    params.fields.is_active = "Active state is required";
  }
}

function invalidCentrePayload(fields: Record<string, string>): CentreValidationFailure {
  return { ok: false, status: 422, error: "Invalid Centre payload", fields };
}

function normalizeCentrePayload(
  body: unknown,
  existing: CentreListRow | null
): { ok: true; payload: CentreCreatePayload } | CentreValidationFailure {
  const payload = isPlainObject(body) ? body : {};
  const fields: Record<string, string> = {};
  addUnknownCentrePayloadErrors(payload, fields);

  const values = {
    ...centreIdentityFromPayload(payload, existing, fields),
    ...centreSettingsFromPayload(payload, existing),
  };

  addCentrePayloadValueErrors({
    fields,
    requireName: existing === null || "name" in payload,
    ...values,
  });

  if (Object.keys(fields).length > 0) {
    return invalidCentrePayload(fields);
  }

  return {
    ok: true,
    payload: centrePayloadWithDefaults(values),
  };
}

function centrePayloadWithDefaults(
  values: ReturnType<typeof centreIdentityFromPayload> &
    ReturnType<typeof centreSettingsFromPayload>
): CentreCreatePayload {
  return {
    ...values,
    schoolId: values.schoolId ?? null,
    grade11ExamTrackCodes: values.grade11ExamTrackCodes ?? [],
    grade12ExamTrackCodes: values.grade12ExamTrackCodes ?? [],
    isPhysical: values.isPhysical ?? false,
    isActive: values.isActive ?? true,
    programId: values.programId ?? null,
  };
}

function centreIdentityFromPayload(
  payload: Record<string, unknown>,
  existing: CentreListRow | null,
  fields: Record<string, string>
) {
  const nameValue = payloadValue(payload, "name", existing?.name);
  return {
    name: typeof nameValue === "string" ? nameValue.trim() : "",
    schoolId: nullablePositiveIntegerFromPayload(
      payloadValue(payload, "school_id", existing?.schoolId)
    ),
    programId: nullablePositiveIntegerFromPayload(
      payloadValue(payload, "program_id", existing?.programId)
    ),
    typeCode: nullableStringFromPayload(
      payloadValue(payload, "type_code", existing?.typeCode),
      "type_code",
      fields
    ),
    categoryCode: nullableStringFromPayload(
      payloadValue(payload, "category_code", existing?.categoryCode),
      "category_code",
      fields
    ),
    subCategoryCode: nullableStringFromPayload(
      payloadValue(payload, "sub_category_code", existing?.subCategoryCode),
      "sub_category_code",
      fields
    ),
  };
}

function centreSettingsFromPayload(
  payload: Record<string, unknown>,
  existing: CentreListRow | null
) {
  return {
    grade11ExamTrackCodes: examTrackArrayFromPayload(
      payloadValue(payload, "grade_11_exam_track_codes", existing?.grade11ExamTrackCodes)
    ),
    grade12ExamTrackCodes: examTrackArrayFromPayload(
      payloadValue(payload, "grade_12_exam_track_codes", existing?.grade12ExamTrackCodes)
    ),
    isPhysical: booleanFromPayload(
      payloadValue(payload, "is_physical", existing?.isPhysical)
    ),
    isActive: booleanFromPayload(
      payloadValue(payload, "is_active", existing?.isActive)
    ),
  };
}

function payloadValue(
  payload: Record<string, unknown>,
  key: string,
  fallback: unknown
): unknown {
  return key in payload ? payload[key] : fallback;
}

function booleanFromPayload(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function getCentreById(id: number): Promise<CentreListRow | null> {
  if (!Number.isInteger(id) || id < 1) return null;

  const rows = await query<CentreListQueryRow>(
    centreMutationReturningSql("SELECT * FROM centres WHERE id = $1"),
    [id]
  );

  return rows[0] ? mapCentreListRow(rows[0]) : null;
}

function validateCentreOptionCodes(params: {
  payload: Pick<
    CentreCreatePayload,
    "typeCode" | "categoryCode" | "subCategoryCode"
  >;
  optionSets: CentreOptionSet[];
  existing: CentreListRow | null;
}): { ok: true } | CentreValidationFailure {
  const fields: Record<string, string> = {};

  validateSingleCentreOptionCode({
    optionSets: params.optionSets,
    optionSetCode: "type",
    code: params.payload.typeCode,
    field: "type_code",
    existingCode: params.existing?.typeCode ?? null,
    fields,
  });
  validateSingleCentreOptionCode({
    optionSets: params.optionSets,
    optionSetCode: "category",
    code: params.payload.categoryCode,
    field: "category_code",
    existingCode: params.existing?.categoryCode ?? null,
    fields,
  });
  validateSingleCentreOptionCode({
    optionSets: params.optionSets,
    optionSetCode: "sub_category",
    code: params.payload.subCategoryCode,
    field: "sub_category_code",
    existingCode: params.existing?.subCategoryCode ?? null,
    fields,
  });


  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Centre payload",
      fields,
    };
  }

  return { ok: true };
}

async function validateCentreMutationReferences(
  payload: CentreCreatePayload,
  optionSets: CentreOptionSet[],
  existing: CentreListRow | null
): Promise<{ ok: true } | CentreValidationFailure> {
  const optionValidation = validateCentreOptionCodes({
    payload,
    optionSets,
    existing,
  });
  if (!optionValidation.ok) return optionValidation;

  const schoolValidation = await validateSchoolId(payload.schoolId);
  if (!schoolValidation.ok) return schoolValidation;

  return validateProgramId(payload.programId);
}

function validateSingleCentreOptionCode(params: {
  optionSets: CentreOptionSet[];
  optionSetCode: CentreOptionSetCode;
  code: string | null;
  field: string;
  existingCode: string | null;
  fields: Record<string, string>;
}): void {
  if (!params.code) return;
  if (isSelectableCentreOption(params.optionSets, params.optionSetCode, params.code)) {
    return;
  }
  if (
    params.code === params.existingCode &&
    hasCentreOption(params.optionSets, params.optionSetCode, params.code)
  ) {
    return;
  }

  params.fields[params.field] = `Centre ${params.field} must be an active ${params.optionSetCode} option`;
}

function isSelectableCentreOption(
  optionSets: CentreOptionSet[],
  optionSetCode: CentreOptionSetCode,
  code: string
): boolean {
  return (
    optionSets
      .find((set) => set.code === optionSetCode)
      ?.options.some((option) => option.code === code && option.isActive) ?? false
  );
}

function hasCentreOption(
  optionSets: CentreOptionSet[],
  optionSetCode: CentreOptionSetCode,
  code: string
): boolean {
  return (
    optionSets
      .find((set) => set.code === optionSetCode)
      ?.options.some((option) => option.code === code) ?? false
  );
}

async function validateSchoolId(
  schoolId: number | null
): Promise<{ ok: true } | CentreValidationFailure> {
  if (schoolId === null) return { ok: true };
  const rows = await query<{ id: string | number }>(
    "SELECT id FROM school WHERE id = $1",
    [schoolId]
  );
  if (rows.length > 0) return { ok: true };

  return {
    ok: false,
    status: 422,
    error: "Invalid Centre payload",
    fields: { school_id: "School id does not exist" },
  };
}

export interface ProgramOption {
  id: number;
  name: string;
}

// Programs for the centre↔program selector. `program` is a core db-service
// table (always present), so no schema-readiness gate is needed here. Names are
// plain strings (unlike the jsonb `subject` table).
export async function listPrograms(params?: {
  search?: string;
}): Promise<ProgramOption[]> {
  const search = params?.search?.trim() ?? "";
  const rows = search
    ? await query<{ id: string | number; name: string | null }>(
        `SELECT id, name FROM program WHERE name ILIKE $1 ORDER BY name ASC`,
        [`%${search}%`]
      )
    : await query<{ id: string | number; name: string | null }>(
        `SELECT id, name FROM program ORDER BY name ASC`
      );
  return rows.map((row) => ({
    id: numberFromDb(row.id),
    name: String(row.name ?? ""),
  }));
}

async function validateProgramId(
  programId: number | null
): Promise<{ ok: true } | CentreValidationFailure> {
  if (programId === null) return { ok: true };
  const rows = await query<{ id: string | number }>(
    "SELECT id FROM program WHERE id = $1",
    [programId]
  );
  if (rows.length > 0) return { ok: true };

  return {
    ok: false,
    status: 422,
    error: "Invalid Centre payload",
    fields: { program_id: "Program id does not exist" },
  };
}

function centreMutationReturningSql(
  mutationSql: string,
  mappingParams?: { grade11: number; grade12: number }
): string {
  const mappingCtes = mappingParams
    ? `,
  deleted_exam_tracks AS (
    DELETE FROM centre_exam_tracks mapping
    WHERE mapping.centre_id IN (SELECT id FROM changed)
      AND NOT EXISTS (
        SELECT 1
        FROM grade grades
        WHERE grades.id = mapping.grade_id
          AND (
            (grades.number = 11 AND mapping.exam_track_code = ANY($${mappingParams.grade11}::text[]))
            OR
            (grades.number = 12 AND mapping.exam_track_code = ANY($${mappingParams.grade12}::text[]))
          )
      )
    RETURNING mapping.centre_id
  ),
  inserted_exam_tracks AS (
    INSERT INTO centre_exam_tracks
      (centre_id, grade_id, exam_track_code, inserted_at, updated_at)
    SELECT changed.id,
           grades.id,
           requested.exam_track_code,
           NOW(),
           NOW()
    FROM changed
    JOIN grade grades ON grades.number IN (11, 12)
    CROSS JOIN LATERAL unnest(
      CASE grades.number
        WHEN 11 THEN $${mappingParams.grade11}::text[]
        ELSE $${mappingParams.grade12}::text[]
      END
    ) requested(exam_track_code)
    WHERE (SELECT COUNT(*) FROM deleted_exam_tracks) >= 0
    ON CONFLICT (centre_id, grade_id, exam_track_code) DO NOTHING
  )`
    : "";
  const grade11Codes = mappingParams
    ? `$${mappingParams.grade11}::text[]`
    : "COALESCE(exam_tracks.grade_11_codes, '{}'::text[])";
  const grade12Codes = mappingParams
    ? `$${mappingParams.grade12}::text[]`
    : "COALESCE(exam_tracks.grade_12_codes, '{}'::text[])";
  const examTrackJoin = mappingParams
    ? ""
    : `LEFT JOIN LATERAL (
    SELECT
      array_agg(mapping.exam_track_code ORDER BY mapping.exam_track_code)
        FILTER (WHERE grades.number = 11) AS grade_11_codes,
      array_agg(mapping.exam_track_code ORDER BY mapping.exam_track_code)
        FILTER (WHERE grades.number = 12) AS grade_12_codes
    FROM centre_exam_tracks mapping
    JOIN grade grades ON grades.id = mapping.grade_id
    WHERE mapping.centre_id = changed.id
  ) exam_tracks ON true`;

  return `WITH changed AS (
    ${mutationSql}
  )${mappingCtes}
  SELECT
    changed.id,
    changed.name,
    changed.school_id,
    changed.type_code,
    type_options.label AS type_label,
    type_options.is_active AS type_is_active,
    changed.category_code,
    category_options.label AS category_label,
    category_options.is_active AS category_is_active,
    changed.sub_category_code,
    sub_category_options.label AS sub_category_label,
    sub_category_options.is_active AS sub_category_is_active,
    ${grade11Codes} AS grade_11_exam_track_codes,
    ${grade12Codes} AS grade_12_exam_track_codes,
    changed.is_physical,
    changed.is_active,
    changed.program_id,
    programs.name AS program_name,
    changed.inserted_at,
    changed.updated_at,
    schools.name AS school_name,
    schools.code AS school_code,
    schools.udise_code AS school_udise_code,
    schools.region AS school_region,
    schools.state AS school_state,
    schools.district AS school_district,
    1 AS total_count
  FROM changed
  LEFT JOIN school schools
    ON schools.id = changed.school_id
  LEFT JOIN program programs
    ON programs.id = changed.program_id
  LEFT JOIN centre_option_sets type_set
    ON type_set.code = 'type'
  LEFT JOIN centre_options type_options
    ON type_options.option_set_id = type_set.id
   AND type_options.code = changed.type_code
  LEFT JOIN centre_option_sets category_set
    ON category_set.code = 'category'
  LEFT JOIN centre_options category_options
    ON category_options.option_set_id = category_set.id
   AND category_options.code = changed.category_code
  LEFT JOIN centre_option_sets sub_category_set
    ON sub_category_set.code = 'sub_category'
  LEFT JOIN centre_options sub_category_options
    ON sub_category_options.option_set_id = sub_category_set.id
   AND sub_category_options.code = changed.sub_category_code
  ${examTrackJoin}`;
}

async function loadCentreSchemaStatus(): Promise<CentreSchemaStatus> {
  const details = await findMissingSchemaColumns({ query }, REQUIRED_CENTRE_COLUMNS);

  if (details.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 503,
    error: "Centre management schema unavailable",
    details,
  };
}

function numberFromDb(value: string | number | null): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function booleanFromDb(value: boolean | string | null): boolean {
  return value === true || value === "true";
}

function integerFromPayload(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return null;
}

function positiveInteger(
  value: string | string[] | undefined,
  fallback: number
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = integerFromPayload(raw);
  return parsed && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function stringParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function stringArrayParam(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    return [];
  }
}

function nullableCodeParam(value: string | string[] | undefined): string | null {
  const normalized = stringParam(value);
  return normalized || null;
}

function nullableStringFromPayload(
  value: unknown,
  field: string,
  fields: Record<string, string>
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    fields[field] = "Centre option code must be a string or null";
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function nullablePositiveIntegerFromPayload(
  value: unknown
): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const parsed = integerFromPayload(value);
  return parsed && parsed > 0 ? parsed : undefined;
}

function stringArrayFromPayload(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return normalized.length === value.length ? normalized : null;
}

function examTrackArrayFromPayload(value: unknown): ExamTrack[] | null {
  if (value === undefined) return [];
  const codes = stringArrayFromPayload(value);
  if (
    codes === null ||
    codes.some((code) => !isExamTrack(code)) ||
    new Set(codes).size !== codes.length
  ) {
    return null;
  }
  return codes as ExamTrack[];
}

function examTracksFromDb(value: unknown): ExamTrack[] {
  return Array.isArray(value) ? value.filter(isExamTrack) : [];
}

function booleanFilter(value: string | string[] | undefined): CentreBooleanFilter {
  const normalized = stringParam(value);
  return normalized === "true" || normalized === "false" ? normalized : "all";
}

function schoolLinkFilter(
  value: string | string[] | undefined
): CentreSchoolLinkFilter {
  const normalized = stringParam(value);
  return normalized === "linked" || normalized === "unlinked"
    ? normalized
    : "all";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
