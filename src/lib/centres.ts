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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
