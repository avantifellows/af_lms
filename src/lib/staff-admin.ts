/**
 * Staff Management domain logic (admin-only surface at /admin/staff).
 *
 * Roster = AF teachers (`teacher.is_af_teacher`) UNION non-teaching `staff`
 * UNION user_permission rows not yet backfilled into either table
 * ("pending"). Teachers/PMs without an employee code are a loud state the
 * UI must surface (badge + filter) — a code-less teacher cannot log into
 * Gurukul.
 *
 * Ownership rule: `teacher` is a db-service core entity, so teacher writes
 * go through the db-service REST API (PATCH /teacher/:id). `staff` and
 * `centre_positions` are LMS-owned operational tables written with direct
 * SQL. `user_permission` stays LMS-direct as before.
 */

import type { PoolClient } from "pg";
import { query, withTransaction } from "./db";
import { getUserPermission } from "./permissions";

// --- Sessions / guard (same shape as requireCentreAdmin) ---

export type StaffAdminSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

export type StaffAdminResult =
  | {
      ok: true;
      email: string;
      permission: NonNullable<Awaited<ReturnType<typeof getUserPermission>>>;
    }
  | { ok: false; status: 401 | 403; error: string };

export async function requireStaffAdmin(
  session: StaffAdminSession
): Promise<StaffAdminResult> {
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

// --- Schema readiness ---

export interface StaffSchemaReady {
  ok: true;
}

export interface StaffSchemaUnavailable {
  ok: false;
  status: 503;
  error: "Staff management schema unavailable";
  details: string[];
}

export type StaffSchemaStatus = StaffSchemaReady | StaffSchemaUnavailable;

export const STAFF_REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "staff", column: "id" },
  { table: "staff", column: "user_id" },
  { table: "staff", column: "employee_code" },
  { table: "staff", column: "staff_type" },
  { table: "staff", column: "designation" },
  { table: "staff", column: "exit_date" },
  { table: "centre_positions", column: "id" },
  { table: "centre_positions", column: "centre_id" },
  { table: "centre_positions", column: "role" },
  { table: "centre_positions", column: "user_id" },
  { table: "centre_positions", column: "hr_code" },
  { table: "centre_positions", column: "notes" },
  { table: "centre_positions", column: "deleted_at" },
  { table: "teacher", column: "teacher_id" },
  { table: "teacher", column: "is_af_teacher" },
  { table: "teacher", column: "exit_date" },
  { table: "user_permission", column: "user_id" },
  { table: "user_permission", column: "revoked_at" },
  { table: "centres", column: "id" },
  { table: "centres", column: "name" },
];

let cachedStaffSchemaStatus: Promise<StaffSchemaStatus> | null = null;

async function loadStaffSchemaStatus(): Promise<StaffSchemaStatus> {
  const rows = await query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
         ${STAFF_REQUIRED_COLUMNS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")}
       )`,
    STAFF_REQUIRED_COLUMNS.flatMap((c) => [c.table, c.column])
  );

  const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  const missing = STAFF_REQUIRED_COLUMNS.filter(
    (c) => !present.has(`${c.table}.${c.column}`)
  ).map((c) => `${c.table}.${c.column}`);

  if (missing.length > 0) {
    return {
      ok: false,
      status: 503,
      error: "Staff management schema unavailable",
      details: missing,
    };
  }
  return { ok: true };
}

export async function checkStaffManagementSchema(): Promise<StaffSchemaStatus> {
  cachedStaffSchemaStatus ??= loadStaffSchemaStatus().then(
    (status) => {
      if (!status.ok) {
        cachedStaffSchemaStatus = null;
      }
      return status;
    },
    (error) => {
      cachedStaffSchemaStatus = null;
      throw error;
    }
  );
  return cachedStaffSchemaStatus;
}

export function resetStaffSchemaCheckForTests() {
  cachedStaffSchemaStatus = null;
}

// --- Shared shapes (client-safe values/types live in staff-shared) ---

import {
  SEAT_ROLES,
  isSeatRole,
  normalizeEmployeeCode,
  type RosterKind,
  type RosterSeat,
  type SeatRole,
  type StaffRosterFilters,
  type StaffRosterRow,
  type StaffRosterSummary,
} from "./staff-shared";

export * from "./staff-shared";

export interface StaffValidationFailure {
  ok: false;
  status: 404 | 409 | 422 | 502;
  error: string;
  fields?: Record<string, string>;
}

export function safeStaffApiError(result: {
  status: number;
  error: string;
  fields?: Record<string, string>;
}): { error: string; fields?: Record<string, string> } {
  return result.fields
    ? { error: result.error, fields: result.fields }
    : { error: result.error };
}

// --- Roster ---

export type StaffRosterResult =
  | {
      ok: true;
      filters: StaffRosterFilters;
      rows: StaffRosterRow[];
      summary: StaffRosterSummary;
    }
  | StaffSchemaUnavailable;

function stringParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStaffRosterParams(searchParams: {
  [key: string]: string | string[] | undefined;
}): StaffRosterFilters {
  const kindRaw = stringParam(searchParams.kind);
  const codeRaw = stringParam(searchParams.code);
  const centreRaw = Number.parseInt(stringParam(searchParams.centre), 10);
  return {
    search: stringParam(searchParams.search),
    kind: (
      ["teacher", "staff", "pending_teacher", "pending_pm"] as const
    ).includes(kindRaw as RosterKind)
      ? (kindRaw as RosterKind)
      : "all",
    code: codeRaw === "missing" || codeRaw === "present" ? codeRaw : "all",
    exited: stringParam(searchParams.exited) === "include" ? "include" : "exclude",
    centreId: Number.isInteger(centreRaw) && centreRaw > 0 ? centreRaw : null,
  };
}

interface RosterQueryRow {
  kind: RosterKind;
  record_id: number;
  user_id: number | null;
  name: string;
  email: string | null;
  employee_code: string | null;
  subject_name: string | null;
  staff_type: string | null;
  designation: string | null;
  exit_date: string | null;
}

const ROSTER_CTE = `
  WITH roster AS (
    SELECT
      'teacher'::text AS kind,
      t.id AS record_id,
      u.id AS user_id,
      trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS name,
      u.email,
      t.teacher_id AS employee_code,
      sub.name->0->>'subject' AS subject_name,
      NULL::varchar AS staff_type,
      t.designation,
      t.exit_date::text AS exit_date
    FROM teacher t
    JOIN "user" u ON u.id = t.user_id
    LEFT JOIN subject sub ON sub.id = t.subject_id
    WHERE t.is_af_teacher = true
    UNION ALL
    SELECT
      'staff', s.id, u.id,
      trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')),
      u.email, s.employee_code, NULL, s.staff_type, s.designation,
      s.exit_date::text
    FROM staff s
    JOIN "user" u ON u.id = s.user_id
    UNION ALL
    SELECT
      CASE WHEN up.role = 'teacher' THEN 'pending_teacher' ELSE 'pending_pm' END,
      up.id, up.user_id, coalesce(up.full_name, ''), lower(up.email),
      NULL, NULL,
      CASE WHEN up.role = 'program_manager' THEN 'program_manager' ELSE NULL END,
      NULL, NULL
    FROM user_permission up
    WHERE up.role IN ('teacher', 'program_manager')
      AND up.revoked_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM teacher t WHERE t.user_id = up.user_id AND t.is_af_teacher = true
      )
      AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id = up.user_id)
  )
`;

export async function getStaffRoster(params: {
  searchParams: { [key: string]: string | string[] | undefined };
}): Promise<StaffRosterResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) {
    return schema;
  }

  const filters = normalizeStaffRosterParams(params.searchParams);

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(
      `(roster.name ILIKE $${values.length} OR roster.email ILIKE $${values.length} OR roster.employee_code ILIKE $${values.length})`
    );
  }
  if (filters.kind !== "all") {
    values.push(filters.kind);
    conditions.push(`roster.kind = $${values.length}`);
  }
  if (filters.code === "missing") {
    conditions.push(`roster.employee_code IS NULL`);
  } else if (filters.code === "present") {
    conditions.push(`roster.employee_code IS NOT NULL`);
  }
  if (filters.exited === "exclude") {
    conditions.push(`roster.exit_date IS NULL`);
  }
  if (filters.centreId !== null) {
    values.push(filters.centreId);
    conditions.push(
      `EXISTS (
         SELECT 1 FROM centre_positions cp
         WHERE cp.user_id = roster.user_id
           AND cp.centre_id = $${values.length}
           AND cp.deleted_at IS NULL
       )`
    );
  }
  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await query<RosterQueryRow>(
    `${ROSTER_CTE}
     SELECT * FROM roster
     ${whereSql}
     ORDER BY (roster.name = '') ASC, roster.name ASC, roster.record_id ASC`,
    values
  );

  const summaryRows = await query<{
    total: string;
    teachers: string;
    staff: string;
    pending: string;
    missing_code: string;
    exited: string;
  }>(
    `${ROSTER_CTE}
     SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE kind = 'teacher') AS teachers,
       COUNT(*) FILTER (WHERE kind = 'staff') AS staff,
       COUNT(*) FILTER (WHERE kind IN ('pending_teacher', 'pending_pm')) AS pending,
       COUNT(*) FILTER (WHERE employee_code IS NULL AND exit_date IS NULL) AS missing_code,
       COUNT(*) FILTER (WHERE exit_date IS NOT NULL) AS exited
     FROM roster`
  );

  const vacantRows = await query<{ vacant: string }>(
    `SELECT COUNT(*) AS vacant
     FROM centre_positions
     WHERE deleted_at IS NULL AND user_id IS NULL`
  );

  const userIds = [
    ...new Set(
      rows
        .map((r) => (r.user_id === null ? null : Number(r.user_id)))
        .filter((id): id is number => id !== null)
    ),
  ];
  const seatRows =
    userIds.length > 0
      ? await query<{
          id: number;
          centre_id: number;
          centre_name: string;
          role: SeatRole;
          user_id: number;
        }>(
          `SELECT cp.id, cp.centre_id, c.name AS centre_name, cp.role, cp.user_id
           FROM centre_positions cp
           JOIN centres c ON c.id = cp.centre_id
           WHERE cp.deleted_at IS NULL AND cp.user_id = ANY($1)
           ORDER BY c.name ASC, cp.role ASC`,
          [userIds]
        )
      : [];

  const seatsByUserId = new Map<number, RosterSeat[]>();
  for (const seat of seatRows) {
    const userId = Number(seat.user_id);
    const list = seatsByUserId.get(userId) ?? [];
    list.push({
      id: Number(seat.id),
      centreId: Number(seat.centre_id),
      centreName: seat.centre_name,
      role: seat.role,
    });
    seatsByUserId.set(userId, list);
  }

  const summary = summaryRows[0];
  return {
    ok: true,
    filters,
    rows: rows.map((row) => ({
      kind: row.kind,
      recordId: Number(row.record_id),
      userId: row.user_id === null ? null : Number(row.user_id),
      name: row.name,
      email: row.email,
      employeeCode: row.employee_code,
      subjectName: row.subject_name,
      staffType: row.staff_type,
      designation: row.designation,
      exitDate: row.exit_date,
      seats:
        row.user_id === null
          ? []
          : (seatsByUserId.get(Number(row.user_id)) ?? []),
    })),
    summary: {
      total: Number(summary?.total ?? 0),
      teachers: Number(summary?.teachers ?? 0),
      staff: Number(summary?.staff ?? 0),
      pending: Number(summary?.pending ?? 0),
      missingCode: Number(summary?.missing_code ?? 0),
      exited: Number(summary?.exited ?? 0),
      vacantSeats: Number(vacantRows[0]?.vacant ?? 0),
    },
  };
}

// --- Teacher updates (proxied to db-service: core entity) ---

export interface TeacherUpdateBody {
  teacher_id?: unknown;
  designation?: unknown;
  exit_date?: unknown;
}

export type TeacherUpdateResult =
  | { ok: true }
  | StaffSchemaUnavailable
  | StaffValidationFailure;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validateTeacherUpdateBody(body: TeacherUpdateBody): {
  payload: Record<string, string>;
  fields: Record<string, string>;
} {
  const payload: Record<string, string> = {};
  const fields: Record<string, string> = {};

  if (body.teacher_id !== undefined) {
    const code = normalizeEmployeeCode(body.teacher_id);
    if (!code) {
      fields.teacher_id = "Employee code must look like AF123";
    } else {
      payload.teacher_id = code;
    }
  }
  if (body.designation !== undefined) {
    if (typeof body.designation !== "string" || !body.designation.trim()) {
      fields.designation = "Designation must be a non-empty string";
    } else {
      payload.designation = body.designation.trim();
    }
  }
  if (body.exit_date !== undefined) {
    if (!isIsoDate(body.exit_date)) {
      fields.exit_date = "Exit date must be YYYY-MM-DD";
    } else {
      payload.exit_date = body.exit_date;
    }
  }

  return { payload, fields };
}

async function dbServiceTeacherPatch(
  teacherDbId: number,
  payload: Record<string, string>
): Promise<{ ok: true } | StaffValidationFailure> {
  const baseUrl = process.env.DB_SERVICE_URL?.trim();
  const token = process.env.DB_SERVICE_TOKEN?.trim();
  if (!baseUrl || !token) {
    return {
      ok: false,
      status: 502,
      error: "DB service is not configured (DB_SERVICE_URL / DB_SERVICE_TOKEN)",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/teacher/${teacherDbId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, status: 502, error: "DB service is unreachable" };
  }

  if (response.ok) {
    return { ok: true };
  }

  const detail = await response.text();
  if (response.status === 404) {
    return { ok: false, status: 404, error: "Teacher not found" };
  }
  return {
    ok: false,
    status: 422,
    error: `DB service rejected the teacher update: ${detail.slice(0, 300)}`,
  };
}

export async function updateTeacherRecord(params: {
  id: number;
  body: TeacherUpdateBody;
}): Promise<TeacherUpdateResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const { payload, fields } = validateTeacherUpdateBody(params.body);
  if (Object.keys(fields).length > 0) {
    return { ok: false, status: 422, error: "Validation failed", fields };
  }
  if (Object.keys(payload).length === 0) {
    return { ok: false, status: 422, error: "Nothing to update" };
  }

  const existing = await query<{ id: number; user_id: number | null }>(
    `SELECT id, user_id FROM teacher WHERE id = $1 AND is_af_teacher = true`,
    [params.id]
  );
  if (existing.length === 0) {
    return { ok: false, status: 404, error: "Teacher not found" };
  }

  if (payload.teacher_id) {
    const clash = await query<{ id: number }>(
      `SELECT id FROM teacher WHERE teacher_id = $1 AND id <> $2`,
      [payload.teacher_id, params.id]
    );
    if (clash.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `Employee code ${payload.teacher_id} is already used by another teacher`,
      };
    }
  }

  const patched = await dbServiceTeacherPatch(params.id, payload);
  if (!patched.ok) return patched;

  // Exits also vacate seats + revoke LMS access (LMS-owned tables).
  if (payload.exit_date && existing[0].user_id !== null) {
    await withTransaction(async (client) => {
      await vacateSeatsAndRevoke(client, Number(existing[0].user_id));
    });
  }

  return { ok: true };
}

async function vacateSeatsAndRevoke(
  client: PoolClient,
  userId: number
): Promise<void> {
  await client.query(
    `UPDATE centre_positions SET user_id = NULL, updated_at = now()
     WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  await client.query(
    `UPDATE user_permission SET revoked_at = now(), updated_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

// Strict per-user exclusivity: when a person is assigned a centre seat their
// school scope becomes purely seat-derived, so clear any explicit
// school_codes/regions on their user_permission row. This is what makes
// centre_positions the source of truth and prevents the move-doesn't-revoke
// staleness bug — a seated person's home schools must live in exactly one place
// (the seats). A seated person must therefore have ALL their schools
// represented as seats; ops backfills any seat gaps (the one-time migration
// script reports them). The NOT NULL guard keeps this a no-op when nothing is
// set, so re-saving an already-seated person doesn't churn the row.
async function clearExplicitSchoolScope(
  client: PoolClient,
  userId: number
): Promise<void> {
  await client.query(
    `UPDATE user_permission
     SET school_codes = NULL, regions = NULL, updated_at = now()
     WHERE user_id = $1 AND (school_codes IS NOT NULL OR regions IS NOT NULL)`,
    [userId]
  );
}

// --- Staff (non-teaching) members: LMS-direct ---

export interface CreateStaffMemberBody {
  user_permission_id?: unknown;
  employee_code?: unknown;
  designation?: unknown;
}

export type StaffMutationResult =
  | { ok: true }
  | StaffSchemaUnavailable
  | StaffValidationFailure;

export async function createStaffMember(params: {
  body: CreateStaffMemberBody;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const fields: Record<string, string> = {};
  const permissionId = Number(params.body.user_permission_id);
  if (!Number.isInteger(permissionId) || permissionId <= 0) {
    fields.user_permission_id = "user_permission_id is required";
  }
  const code = normalizeEmployeeCode(params.body.employee_code);
  if (!code) {
    fields.employee_code = "Employee code must look like AF123";
  }
  let designation: string | null = null;
  if (params.body.designation !== undefined && params.body.designation !== null) {
    if (typeof params.body.designation !== "string") {
      fields.designation = "Designation must be a string";
    } else {
      designation = params.body.designation.trim() || null;
    }
  }
  if (Object.keys(fields).length > 0) {
    return { ok: false, status: 422, error: "Validation failed", fields };
  }

  const permissions = await query<{
    id: number;
    email: string;
    full_name: string | null;
    role: string;
    user_id: number | null;
  }>(
    `SELECT id, lower(email) AS email, full_name, role, user_id
     FROM user_permission WHERE id = $1`,
    [permissionId]
  );
  if (permissions.length === 0 || permissions[0].role !== "program_manager") {
    return {
      ok: false,
      status: 404,
      error: "Program manager permission row not found",
    };
  }
  const permission = permissions[0];

  const codeClash = await query<{ id: number }>(
    `SELECT id FROM staff WHERE employee_code = $1`,
    [code]
  );
  if (codeClash.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Employee code ${code} is already used by another staff member`,
    };
  }
  if (permission.user_id !== null) {
    const staffClash = await query<{ id: number }>(
      `SELECT id FROM staff WHERE user_id = $1`,
      [permission.user_id]
    );
    if (staffClash.length > 0) {
      return {
        ok: false,
        status: 409,
        error: "This person already has a staff record",
      };
    }
  }

  await withTransaction(async (client) => {
    let userId = permission.user_id === null ? null : Number(permission.user_id);
    if (userId === null) {
      const name = (permission.full_name ?? "").trim();
      const tokens = name.split(/\s+/).filter(Boolean);
      const inserted = await client.query(
        `INSERT INTO "user" (first_name, last_name, email, inserted_at, updated_at)
         VALUES ($1, $2, $3, now(), now()) RETURNING id`,
        [
          tokens[0] ?? null,
          tokens.length > 1 ? tokens.slice(1).join(" ") : null,
          permission.email,
        ]
      );
      userId = Number(inserted.rows[0].id);
      await client.query(
        `UPDATE user_permission SET user_id = $1, updated_at = now() WHERE id = $2`,
        [userId, permission.id]
      );
    }
    await client.query(
      `INSERT INTO staff (user_id, employee_code, staff_type, designation, inserted_at, updated_at)
       VALUES ($1, $2, 'program_manager', $3, now(), now())`,
      [userId, code, designation]
    );
  });

  return { ok: true };
}

export interface UpdateStaffMemberBody {
  employee_code?: unknown;
  designation?: unknown;
  exit_date?: unknown;
}

export async function updateStaffMember(params: {
  id: number;
  body: UpdateStaffMemberBody;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const fields: Record<string, string> = {};
  const updates: string[] = [];
  const values: unknown[] = [];

  if (params.body.employee_code !== undefined) {
    const code = normalizeEmployeeCode(params.body.employee_code);
    if (!code) {
      fields.employee_code = "Employee code must look like AF123";
    } else {
      values.push(code);
      updates.push(`employee_code = $${values.length}`);
    }
  }
  if (params.body.designation !== undefined) {
    if (typeof params.body.designation !== "string") {
      fields.designation = "Designation must be a string";
    } else {
      values.push(params.body.designation.trim() || null);
      updates.push(`designation = $${values.length}`);
    }
  }
  if (params.body.exit_date !== undefined) {
    if (!isIsoDate(params.body.exit_date)) {
      fields.exit_date = "Exit date must be YYYY-MM-DD";
    } else {
      values.push(params.body.exit_date);
      updates.push(`exit_date = $${values.length}`);
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, status: 422, error: "Validation failed", fields };
  }
  if (updates.length === 0) {
    return { ok: false, status: 422, error: "Nothing to update" };
  }

  const existing = await query<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM staff WHERE id = $1`,
    [params.id]
  );
  if (existing.length === 0) {
    return { ok: false, status: 404, error: "Staff member not found" };
  }

  if (params.body.employee_code !== undefined) {
    const code = normalizeEmployeeCode(params.body.employee_code);
    const clash = await query<{ id: number }>(
      `SELECT id FROM staff WHERE employee_code = $1 AND id <> $2`,
      [code, params.id]
    );
    if (clash.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `Employee code ${code} is already used by another staff member`,
      };
    }
  }

  await withTransaction(async (client) => {
    values.push(params.id);
    await client.query(
      `UPDATE staff SET ${updates.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
    if (
      params.body.exit_date !== undefined &&
      isIsoDate(params.body.exit_date)
    ) {
      await vacateSeatsAndRevoke(client, Number(existing[0].user_id));
    }
  });

  return { ok: true };
}

// --- Centre positions (seats): LMS-direct ---

export interface CreatePositionBody {
  centre_id?: unknown;
  role?: unknown;
  user_id?: unknown;
}

export async function createPosition(params: {
  body: CreatePositionBody;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const fields: Record<string, string> = {};
  const centreId = Number(params.body.centre_id);
  if (!Number.isInteger(centreId) || centreId <= 0) {
    fields.centre_id = "centre_id is required";
  }
  if (!isSeatRole(params.body.role)) {
    fields.role = `Role must be one of: ${SEAT_ROLES.join(", ")}`;
  }
  let userId: number | null = null;
  if (params.body.user_id !== undefined && params.body.user_id !== null) {
    userId = Number(params.body.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      fields.user_id = "user_id must be a positive integer";
    }
  }
  if (Object.keys(fields).length > 0) {
    return { ok: false, status: 422, error: "Validation failed", fields };
  }
  const role = params.body.role as SeatRole;

  const centres = await query<{ id: number }>(
    `SELECT id FROM centres WHERE id = $1`,
    [centreId]
  );
  if (centres.length === 0) {
    return { ok: false, status: 404, error: "Centre not found" };
  }

  if (userId !== null) {
    const users = await query<{ id: number }>(
      `SELECT id FROM "user" WHERE id = $1`,
      [userId]
    );
    if (users.length === 0) {
      return { ok: false, status: 404, error: "User not found" };
    }
    const duplicate = await query<{ id: number }>(
      `SELECT id FROM centre_positions
       WHERE centre_id = $1 AND role = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [centreId, role, userId]
    );
    if (duplicate.length > 0) {
      return {
        ok: false,
        status: 409,
        error: "This person already holds this seat",
      };
    }
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO centre_positions (centre_id, role, user_id, inserted_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [centreId, role, userId]
    );
    if (userId !== null) {
      await clearExplicitSchoolScope(client, userId);
    }
  });

  return { ok: true };
}

export interface UpdatePositionBody {
  user_id?: unknown;
}

export async function updatePosition(params: {
  id: number;
  body: UpdatePositionBody;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  if (!("user_id" in params.body)) {
    return {
      ok: false,
      status: 422,
      error: "Provide user_id (a user to fill the seat, or null to vacate)",
    };
  }

  const positions = await query<{
    id: number;
    centre_id: number;
    role: SeatRole;
  }>(
    `SELECT id, centre_id, role FROM centre_positions
     WHERE id = $1 AND deleted_at IS NULL`,
    [params.id]
  );
  if (positions.length === 0) {
    return { ok: false, status: 404, error: "Position not found" };
  }
  const position = positions[0];

  let userId: number | null = null;
  if (params.body.user_id !== null) {
    userId = Number(params.body.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return {
        ok: false,
        status: 422,
        error: "Validation failed",
        fields: { user_id: "user_id must be a positive integer or null" },
      };
    }
    const users = await query<{ id: number }>(
      `SELECT id FROM "user" WHERE id = $1`,
      [userId]
    );
    if (users.length === 0) {
      return { ok: false, status: 404, error: "User not found" };
    }
    const duplicate = await query<{ id: number }>(
      `SELECT id FROM centre_positions
       WHERE centre_id = $1 AND role = $2 AND user_id = $3
         AND deleted_at IS NULL AND id <> $4`,
      [position.centre_id, position.role, userId, params.id]
    );
    if (duplicate.length > 0) {
      return {
        ok: false,
        status: 409,
        error: "This person already holds this seat",
      };
    }
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE centre_positions SET user_id = $1, updated_at = now() WHERE id = $2`,
      [userId, params.id]
    );
    if (userId !== null) {
      await clearExplicitSchoolScope(client, userId);
    }
  });

  return { ok: true };
}

export async function deletePosition(params: {
  id: number;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const positions = await query<{ id: number }>(
    `SELECT id FROM centre_positions WHERE id = $1 AND deleted_at IS NULL`,
    [params.id]
  );
  if (positions.length === 0) {
    return { ok: false, status: 404, error: "Position not found" };
  }

  await query(
    `UPDATE centre_positions SET deleted_at = now(), updated_at = now() WHERE id = $1`,
    [params.id]
  );

  return { ok: true };
}
