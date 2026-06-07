import { query } from "./db";
import { getUserPermission, type UserPermission } from "./permissions";

export type CentreOptionSetCode = "type" | "category" | "sub_category" | "stream";

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
  active: CentreBooleanFilter;
  schoolLink: CentreSchoolLinkFilter;
  typeCode: string | null;
  categoryCode: string | null;
  subCategoryCode: string | null;
  streamCode: string | null;
  isPhysical: CentreBooleanFilter;
}

export interface CentreListParams {
  page: number;
  limit: number;
  offset: number;
  filters: CentreListFilters;
}

export interface CentreStreamDisplay {
  code: string;
  label: string;
  isActive: boolean | null;
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
  streamCodes: string[];
  streams: CentreStreamDisplay[];
  isPhysical: boolean;
  isActive: boolean;
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
      pagination: {
        page: number;
        limit: number;
        totalRows: number;
        totalPages: number;
      };
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
  streamCodes: string[];
  isPhysical: boolean;
  isActive: boolean;
}

type CentreEditPayload = CentreCreatePayload;

interface MissingColumnRow {
  table_name: string;
  column_name: string;
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
  stream_codes: string[] | null;
  stream_options: unknown;
  is_physical: boolean | string | null;
  is_active: boolean | string | null;
  inserted_at: string | Date | null;
  updated_at: string | Date | null;
  school_name: string | null;
  school_code: string | null;
  school_udise_code: string | null;
  school_region: string | null;
  school_state: string | null;
  school_district: string | null;
  total_count: string | number | null;
}

const FIXED_OPTION_SET_CODES: CentreOptionSetCode[] = [
  "type",
  "category",
  "sub_category",
  "stream",
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
  { table: "centres", column: "id" },
  { table: "centres", column: "name" },
  { table: "centres", column: "school_id" },
  { table: "centres", column: "type_code" },
  { table: "centres", column: "category_code" },
  { table: "centres", column: "sub_category_code" },
  { table: "centres", column: "stream_codes" },
  { table: "centres", column: "is_physical" },
  { table: "centres", column: "is_active" },
  { table: "centres", column: "inserted_at" },
  { table: "centres", column: "updated_at" },
];

let cachedCentreSchemaStatus: Promise<CentreSchemaStatus> | null = null;

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

export async function checkCentreManagementSchema(): Promise<CentreSchemaStatus> {
  cachedCentreSchemaStatus ??= loadCentreSchemaStatus().then(
    (status) => {
      if (!status.ok) {
        cachedCentreSchemaStatus = null;
      }
      return status;
    },
    (error) => {
      cachedCentreSchemaStatus = null;
      throw error;
    }
  );
  return cachedCentreSchemaStatus;
}

export function resetCentreSchemaCheckForTests() {
  cachedCentreSchemaStatus = null;
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
  const limit = clamp(positiveInteger(searchParams.limit, 25), 1, 100);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    filters: {
      search: stringParam(searchParams.search),
      active: booleanFilter(searchParams.active),
      schoolLink: schoolLinkFilter(searchParams.school_link),
      typeCode: nullableCodeParam(searchParams.type),
      categoryCode: nullableCodeParam(searchParams.category),
      subCategoryCode: nullableCodeParam(searchParams.sub_category),
      streamCode: nullableCodeParam(searchParams.stream),
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

  if (normalized.filters.search) {
    const placeholder = addParam(`%${normalized.filters.search}%`);
    whereClauses.push(
      `(centres.name ILIKE ${placeholder}
        OR schools.name ILIKE ${placeholder}
        OR schools.code ILIKE ${placeholder}
        OR schools.udise_code ILIKE ${placeholder})`
    );
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
  if (normalized.filters.streamCode) {
    whereClauses.push(
      `${addParam(normalized.filters.streamCode)} = ANY(centres.stream_codes)`
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
       centres.stream_codes,
       COALESCE(streams.stream_options, '[]'::jsonb) AS stream_options,
       centres.is_physical,
       centres.is_active,
       centres.inserted_at,
       centres.updated_at,
       schools.name AS school_name,
       schools.code AS school_code,
       schools.udise_code AS school_udise_code,
       schools.region AS school_region,
       schools.state AS school_state,
       schools.district AS school_district,
       COUNT(*) OVER() AS total_count
     FROM centres
     LEFT JOIN school schools
       ON schools.id = centres.school_id
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
       SELECT jsonb_agg(
                jsonb_build_object(
                  'code', stream_code.code,
                  'label', stream_options.label,
                  'is_active', stream_options.is_active
                )
                ORDER BY stream_code.ordinality
              ) AS stream_options
       FROM unnest(centres.stream_codes) WITH ORDINALITY AS stream_code(code, ordinality)
       LEFT JOIN centre_option_sets stream_set
         ON stream_set.code = 'stream'
       LEFT JOIN centre_options stream_options
         ON stream_options.option_set_id = stream_set.id
        AND stream_options.code = stream_code.code
     ) streams ON true
     ${whereSql}
     ORDER BY centres.name ASC, centres.id ASC
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    values
  );

  const totalRows = numberFromDb(rows[0]?.total_count ?? 0);

  return {
    ok: true,
    filters: normalized.filters,
    rows: rows.map(mapCentreListRow),
    pagination: {
      page: normalized.page,
      limit: normalized.limit,
      totalRows,
      totalPages: Math.ceil(totalRows / normalized.limit),
    },
  };
}

export async function createCentre(params: {
  body: unknown;
}): Promise<CentreMutationResult> {
  const schema = await checkCentreManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const payload = normalizeCentreCreatePayload(params.body);
  if (!payload.ok) {
    return payload;
  }

  const optionSets = await getCentreOptionSets();
  if (!optionSets.ok) {
    return optionSets;
  }

  const optionValidation = validateCentreOptionCodes({
    payload: payload.payload,
    optionSets: optionSets.optionSets,
    existing: null,
  });
  if (!optionValidation.ok) {
    return optionValidation;
  }

  const schoolValidation = await validateSchoolId(payload.payload.schoolId);
  if (!schoolValidation.ok) {
    return schoolValidation;
  }

  const rows = await query<CentreListQueryRow>(
    centreMutationReturningSql(
      `INSERT INTO centres
         (name, school_id, type_code, category_code, sub_category_code, stream_codes, is_physical, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`
    ),
    [
      payload.payload.name,
      payload.payload.schoolId,
      payload.payload.typeCode,
      payload.payload.categoryCode,
      payload.payload.subCategoryCode,
      payload.payload.streamCodes,
      payload.payload.isPhysical,
      payload.payload.isActive,
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

  const payload = normalizeCentreEditPayload(params.body, existing);
  if (!payload.ok) {
    return payload;
  }

  const optionSets = await getCentreOptionSets();
  if (!optionSets.ok) {
    return optionSets;
  }

  const optionValidation = validateCentreOptionCodes({
    payload: payload.payload,
    optionSets: optionSets.optionSets,
    existing,
  });
  if (!optionValidation.ok) {
    return optionValidation;
  }

  const schoolValidation = await validateSchoolId(payload.payload.schoolId);
  if (!schoolValidation.ok) {
    return schoolValidation;
  }

  const rows = await query<CentreListQueryRow>(
    centreMutationReturningSql(
      `UPDATE centres
       SET name = $2,
           school_id = $3,
           type_code = $4,
           category_code = $5,
           sub_category_code = $6,
           stream_codes = $7,
           is_physical = $8,
           is_active = $9,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`
    ),
    [
      params.id,
      payload.payload.name,
      payload.payload.schoolId,
      payload.payload.typeCode,
      payload.payload.categoryCode,
      payload.payload.subCategoryCode,
      payload.payload.streamCodes,
      payload.payload.isPhysical,
      payload.payload.isActive,
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
    streamCodes: Array.isArray(row.stream_codes) ? row.stream_codes : [],
    streams: streamOptionsFromDb(row.stream_options),
    isPhysical: booleanFromDb(row.is_physical),
    isActive: booleanFromDb(row.is_active),
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

function streamOptionsFromDb(value: unknown): CentreStreamDisplay[] {
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry) => {
    if (!isPlainObject(entry) || typeof entry.code !== "string") return [];
    return [
      {
        code: entry.code,
        label: typeof entry.label === "string" ? entry.label : "",
        isActive:
          typeof entry.is_active === "boolean"
            ? entry.is_active
            : entry.is_active === null
              ? null
              : booleanFromDb(entry.is_active as string | boolean | null),
      },
    ];
  });
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

function normalizeCentreCreatePayload(
  body: unknown
): { ok: true; payload: CentreCreatePayload } | CentreValidationFailure {
  const payload = isPlainObject(body) ? body : {};
  const fields: Record<string, string> = {};
  const allowedKeys = new Set([
    "name",
    "school_id",
    "type_code",
    "category_code",
    "sub_category_code",
    "stream_codes",
    "is_physical",
    "is_active",
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      fields[key] = "Field is not editable";
    }
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const schoolId = nullablePositiveIntegerFromPayload(payload.school_id);
  const typeCode = nullableStringFromPayload(payload.type_code);
  const categoryCode = nullableStringFromPayload(payload.category_code);
  const subCategoryCode = nullableStringFromPayload(payload.sub_category_code);
  const streamCodes = stringArrayFromPayload(payload.stream_codes);
  const isPhysical =
    typeof payload.is_physical === "boolean" ? payload.is_physical : null;
  const isActive =
    typeof payload.is_active === "boolean" ? payload.is_active : null;

  if (!name) {
    fields.name = "Centre name is required";
  }
  if (schoolId === undefined) {
    fields.school_id = "School id must be a positive integer or null";
  }
  if (streamCodes === null) {
    fields.stream_codes = "Centre Stream codes must be an array of strings";
  }
  if (isPhysical === null) {
    fields.is_physical = "Physical status is required";
  }
  if (isActive === null) {
    fields.is_active = "Active state is required";
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Centre payload",
      fields,
    };
  }

  return {
    ok: true,
    payload: {
      name,
      schoolId: schoolId ?? null,
      typeCode,
      categoryCode,
      subCategoryCode,
      streamCodes: streamCodes ?? [],
      isPhysical: isPhysical ?? false,
      isActive: isActive ?? true,
    },
  };
}

function normalizeCentreEditPayload(
  body: unknown,
  existing: CentreListRow
): { ok: true; payload: CentreEditPayload } | CentreValidationFailure {
  const payload = isPlainObject(body) ? body : {};
  const fields: Record<string, string> = {};
  const allowedKeys = new Set([
    "name",
    "school_id",
    "type_code",
    "category_code",
    "sub_category_code",
    "stream_codes",
    "is_physical",
    "is_active",
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      fields[key] = "Field is not editable";
    }
  }

  const name =
    "name" in payload && typeof payload.name === "string"
      ? payload.name.trim()
      : existing.name;
  const schoolId =
    "school_id" in payload
      ? nullablePositiveIntegerFromPayload(payload.school_id)
      : existing.schoolId;
  const streamCodes =
    "stream_codes" in payload
      ? stringArrayFromPayload(payload.stream_codes)
      : existing.streamCodes;
  const isPhysical =
    "is_physical" in payload
      ? typeof payload.is_physical === "boolean"
        ? payload.is_physical
        : null
      : existing.isPhysical;
  const isActive =
    "is_active" in payload
      ? typeof payload.is_active === "boolean"
        ? payload.is_active
        : null
      : existing.isActive;

  if ("name" in payload && !name) {
    fields.name = "Centre name is required";
  }
  if (schoolId === undefined) {
    fields.school_id = "School id must be a positive integer or null";
  }
  if (streamCodes === null) {
    fields.stream_codes = "Centre Stream codes must be an array of strings";
  }
  if (isPhysical === null) {
    fields.is_physical = "Physical status is required";
  }
  if (isActive === null) {
    fields.is_active = "Active state is required";
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Invalid Centre payload",
      fields,
    };
  }

  return {
    ok: true,
    payload: {
      name,
      schoolId: schoolId ?? null,
      typeCode:
        "type_code" in payload
          ? nullableStringFromPayload(payload.type_code)
          : existing.typeCode,
      categoryCode:
        "category_code" in payload
          ? nullableStringFromPayload(payload.category_code)
          : existing.categoryCode,
      subCategoryCode:
        "sub_category_code" in payload
          ? nullableStringFromPayload(payload.sub_category_code)
          : existing.subCategoryCode,
      streamCodes: streamCodes ?? [],
      isPhysical: isPhysical ?? existing.isPhysical,
      isActive: isActive ?? existing.isActive,
    },
  };
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
    "typeCode" | "categoryCode" | "subCategoryCode" | "streamCodes"
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

  const existingStreamCodes = new Set(params.existing?.streamCodes ?? []);
  for (const code of params.payload.streamCodes) {
    if (isSelectableCentreOption(params.optionSets, "stream", code)) continue;
    if (existingStreamCodes.has(code) && hasCentreOption(params.optionSets, "stream", code)) {
      continue;
    }
    fields.stream_codes = "Centre Stream codes must be active stream options";
    break;
  }

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

function centreMutationReturningSql(mutationSql: string): string {
  return `WITH changed AS (
    ${mutationSql}
  )
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
    changed.stream_codes,
    COALESCE(streams.stream_options, '[]'::jsonb) AS stream_options,
    changed.is_physical,
    changed.is_active,
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
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'code', stream_code.code,
               'label', stream_options.label,
               'is_active', stream_options.is_active
             )
             ORDER BY stream_code.ordinality
           ) AS stream_options
    FROM unnest(changed.stream_codes) WITH ORDINALITY AS stream_code(code, ordinality)
    LEFT JOIN centre_option_sets stream_set
      ON stream_set.code = 'stream'
    LEFT JOIN centre_options stream_options
      ON stream_options.option_set_id = stream_set.id
     AND stream_options.code = stream_code.code
  ) streams ON true`;
}

async function loadCentreSchemaStatus(): Promise<CentreSchemaStatus> {
  const values = REQUIRED_CENTRE_COLUMNS.map(
    (_column, index) => `($${index * 2 + 1}, $${index * 2 + 2})`
  ).join(", ");
  const params = REQUIRED_CENTRE_COLUMNS.flatMap(({ table, column }) => [
    table,
    column,
  ]);

  const missing = await query<MissingColumnRow>(
    `WITH required(table_name, column_name) AS (VALUES ${values})
     SELECT required.table_name, required.column_name
     FROM required
     LEFT JOIN information_schema.columns cols
       ON cols.table_schema = 'public'
      AND cols.table_name = required.table_name
      AND cols.column_name = required.column_name
     WHERE cols.column_name IS NULL
     ORDER BY required.table_name, required.column_name`,
    params
  );

  if (missing.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 503,
    error: "Centre management schema unavailable",
    details: missing.map((row) => `${row.table_name}.${row.column_name}`),
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

function nullableCodeParam(value: string | string[] | undefined): string | null {
  const normalized = stringParam(value);
  return normalized || null;
}

function nullableStringFromPayload(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
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

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
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
