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
import {
  type AdminGuardResult,
  type AdminSession,
  makeSchemaChecker,
  requireAdmin,
} from "./admin-guard";

// --- Sessions / guard (shared with the Centre management surface) ---

export type StaffAdminSession = AdminSession;
export type StaffAdminResult = AdminGuardResult;

export async function requireStaffAdmin(
  session: StaffAdminSession
): Promise<StaffAdminResult> {
  return requireAdmin(session);
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

const staffSchemaChecker = makeSchemaChecker(loadStaffSchemaStatus);

export function checkStaffManagementSchema(): Promise<StaffSchemaStatus> {
  return staffSchemaChecker.check();
}

export function resetStaffSchemaCheckForTests() {
  staffSchemaChecker.reset();
}

// --- Shared shapes (client-safe values/types live in staff-shared) ---

import {
  PM_SEAT_ROLES,
  SEAT_ROLES,
  isSeatRole,
  isSubjectSeatRole,
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
  // Machine-readable discriminator for failures the client handles specially
  // (e.g. "last_seat" → offer a force-confirm). Absent for ordinary failures.
  code?: string;
}

export function safeStaffApiError(result: {
  status: number;
  error: string;
  fields?: Record<string, string>;
  code?: string;
}): { error: string; fields?: Record<string, string>; code?: string } {
  return {
    error: result.error,
    ...(result.fields ? { fields: result.fields } : {}),
    ...(result.code ? { code: result.code } : {}),
  };
}

interface AcademicMentorshipBlockerTarget {
  school_code: string | null;
  academic_year: string;
}

interface AcademicMentorshipBlockerRow extends AcademicMentorshipBlockerTarget {
  mentee_count: string | number;
}

function academicMentorshipManagementLink(
  row: AcademicMentorshipBlockerTarget | undefined
): string {
  if (!row?.school_code || !row.academic_year) {
    return "/admin/academic-mentorship";
  }
  return `/admin/academic-mentorship?school_code=${encodeURIComponent(
    row.school_code
  )}&academic_year=${encodeURIComponent(row.academic_year)}`;
}

function isMissingAcademicMentorshipMappingSchema(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "42703";
}

async function queryAcademicMentorshipBlockers<T>(
  sql: string,
  mentorUserId: number
): Promise<T[]> {
  try {
    return await query<T>(sql, [mentorUserId]);
  } catch (error) {
    if (isMissingAcademicMentorshipMappingSchema(error)) return [];
    throw error;
  }
}

async function blockIfActiveAcademicMentees(
  mentorUserId: number
): Promise<StaffValidationFailure | null> {
  const rows = await queryAcademicMentorshipBlockers<AcademicMentorshipBlockerRow>(
    `SELECT s.code AS school_code,
            m.academic_year,
            COUNT(*) AS mentee_count
     FROM academic_mentorship_mentor_mentee_mappings m
     JOIN school s ON s.id = m.school_id
     WHERE m.mentor_user_id = $1
       AND m.ended_at IS NULL
     GROUP BY s.code, m.academic_year
     ORDER BY m.academic_year DESC, s.code ASC`,
    mentorUserId
  );
  if (rows.length === 0) return null;

  const count = rows.reduce((total, row) => total + Number(row.mentee_count), 0);
  return {
    ok: false,
    status: 409,
    code: "active_academic_mentees",
    error: `This Teacher has ${count} active ${count === 1 ? "Mentee" : "Mentees"}. Remove or reassign them before exiting the Teacher: ${academicMentorshipManagementLink(rows[0])}`,
  };
}

export async function blockIfAcademicMentorshipHistory(
  mentorUserId: number
): Promise<StaffValidationFailure | null> {
  const rows = await queryAcademicMentorshipBlockers<AcademicMentorshipBlockerTarget>(
    `SELECT s.code AS school_code,
            m.academic_year
     FROM academic_mentorship_mentor_mentee_mappings m
     JOIN school s ON s.id = m.school_id
     WHERE m.mentor_user_id = $1
     GROUP BY s.code, m.academic_year
     ORDER BY m.academic_year DESC, s.code ASC`,
    mentorUserId
  );
  if (rows.length === 0) return null;

  return {
    ok: false,
    status: 409,
    code: "academic_mentorship_history",
    error: `This Teacher has Academic Mentor-Mentee Mapping history. Deleting the Teacher is blocked to preserve audit history: ${academicMentorshipManagementLink(rows[0])}`,
  };
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
      -- An active user_permission is the source of truth for personhood:
      -- deleting a user from the permissions screen removes them from the roster
      -- (and orphaned teacher/staff rows with no live permission stay hidden).
      AND EXISTS (
        SELECT 1 FROM user_permission up
        WHERE (up.user_id = u.id OR LOWER(up.email) = LOWER(u.email))
          AND up.revoked_at IS NULL
      )
    UNION ALL
    SELECT
      'staff', s.id, u.id,
      trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')),
      u.email, s.employee_code, NULL, s.staff_type, s.designation,
      s.exit_date::text
    FROM staff s
    JOIN "user" u ON u.id = s.user_id
    WHERE EXISTS (
      SELECT 1 FROM user_permission up
      WHERE (up.user_id = u.id OR LOWER(up.email) = LOWER(u.email))
        AND up.revoked_at IS NULL
    )
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
      -- A permission row is "pending" only if no real teacher/staff record
      -- exists for this person. Match by user_id OR email: an orphaned
      -- user_permission (user_id never linked) whose email already has a
      -- teacher/staff record is the SAME person, not a second account — keying
      -- on email too dedupes that phantom out of the roster.
      AND NOT EXISTS (
        SELECT 1 FROM teacher t
        JOIN "user" u ON u.id = t.user_id
        WHERE t.is_af_teacher = true
          AND (t.user_id = up.user_id OR LOWER(u.email) = LOWER(up.email))
      )
      AND NOT EXISTS (
        SELECT 1 FROM staff s
        JOIN "user" u ON u.id = s.user_id
        WHERE (s.user_id = up.user_id OR LOWER(u.email) = LOWER(up.email))
      )
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

  if (payload.exit_date && existing[0].user_id !== null) {
    const blocker = await blockIfActiveAcademicMentees(Number(existing[0].user_id));
    if (blocker) return blocker;
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

// Strict region/seat exclusivity (#1): a region-level (level-2) user's scope is
// their regions, which seat assignment would wipe with no way to reconstitute.
// Reject seating such a user up front rather than silently collapsing their
// access to a single school. Returns a failure to surface, or null if allowed.
async function rejectIfRegionLevelUser(
  userId: number
): Promise<StaffValidationFailure | null> {
  const rows = await query<{ level: number }>(
    `SELECT level FROM user_permission WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  if (rows.some((r) => r.level === 2)) {
    return {
      ok: false,
      status: 422,
      error:
        "Region-level users can't hold centre seats — their access is scoped by region, not by seat.",
      fields: { user_id: "This user has region-level access" },
    };
  }
  return null;
}

// Whether `userId`'s only remaining active seat is `excludePositionId` — i.e.
// removing/vacating that seat would leave them with no seat-derived scope.
// Strict exclusivity already cleared their explicit school_codes, so this is a
// total access loss (#2): callers block it unless `force` is set.
async function isLastActiveSeat(
  userId: number,
  excludePositionId: number
): Promise<boolean> {
  const others = await query<{ id: number }>(
    `SELECT id FROM centre_positions
     WHERE user_id = $1 AND deleted_at IS NULL AND id <> $2
     LIMIT 1`,
    [userId, excludePositionId]
  );
  return others.length === 0;
}

const LAST_SEAT_BLOCK: StaffValidationFailure = {
  ok: false,
  status: 409,
  error:
    "This is the person's only centre seat — removing it leaves them with no access. Re-assign them to another seat first, or confirm to remove anyway.",
  code: "last_seat",
};

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
  // Resolve the effective user identity. If user_permission.user_id is unset, a
  // "user" row may still exist for this email (e.g. a prior backfill linked by
  // email but never wrote user_permission.user_id). Reuse it rather than
  // minting a duplicate identity that would orphan their teacher/seat links
  // (#3). null here means "no user exists yet — create one in the transaction".
  let existingUserId: number | null =
    permission.user_id === null ? null : Number(permission.user_id);
  if (existingUserId === null) {
    const found = await query<{ id: number | string }>(
      `SELECT id FROM "user" WHERE LOWER(email) = $1 ORDER BY id LIMIT 1`,
      [permission.email]
    );
    if (found.length > 0) existingUserId = Number(found[0].id);
  }

  if (existingUserId !== null) {
    const staffClash = await query<{ id: number }>(
      `SELECT id FROM staff WHERE user_id = $1`,
      [existingUserId]
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
    let userId = existingUserId;
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
    }
    if (userId !== permission.user_id) {
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

// --- Teachers: LMS-direct create + seat (closes the pending_teacher dead-end) ---

export interface CreateTeacherBody {
  user_permission_id?: unknown;
  subject_id?: unknown;
  centre_id?: unknown;
  teacher_id?: unknown; // optional AF code; blank => not-yet-hired (TBH)
}

// Complete a pending_teacher (a role=teacher user_permission with no teacher
// row) entirely from the UI: create/reuse the user, link it, create the teacher
// record (subject required), and seat them at a centre — mirroring the PM path
// (createStaffMember + createPosition) and preserving the seat-as-source-of-truth
// invariant (clear explicit school scope on seat creation).
export async function createTeacher(params: {
  body: CreateTeacherBody;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const fields: Record<string, string> = {};
  const permissionId = Number(params.body.user_permission_id);
  if (!Number.isInteger(permissionId) || permissionId <= 0) {
    fields.user_permission_id = "user_permission_id is required";
  }
  const subjectId = Number(params.body.subject_id);
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    fields.subject_id = "Subject is required";
  }
  const centreId = Number(params.body.centre_id);
  if (!Number.isInteger(centreId) || centreId <= 0) {
    fields.centre_id = "Centre is required";
  }
  // AF id is optional — blank means a not-yet-hired teacher, set later via edit.
  let code: string | null = null;
  const rawCode = params.body.teacher_id;
  if (rawCode !== undefined && rawCode !== null && String(rawCode).trim() !== "") {
    code = normalizeEmployeeCode(rawCode);
    if (!code) {
      fields.teacher_id = "AF id must look like AF123";
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
    level: number | null;
    user_id: number | null;
  }>(
    `SELECT id, lower(email) AS email, full_name, role, level, user_id
     FROM user_permission WHERE id = $1`,
    [permissionId]
  );
  if (permissions.length === 0 || permissions[0].role !== "teacher") {
    return { ok: false, status: 404, error: "Teacher permission row not found" };
  }
  const permission = permissions[0];

  // Region-level (level 2) users are scoped by region, not by centre seat —
  // mirror rejectIfRegionLevelUser, but read level off the permission row since
  // a pending teacher's user_id may not be linked yet.
  if (permission.level === 2) {
    return {
      ok: false,
      status: 422,
      error:
        "Region-level users can't hold centre seats — their access is scoped by region, not by seat.",
      fields: { user_id: "This user has region-level access" },
    };
  }

  const subjects = await query<{ id: number }>(
    `SELECT id FROM subject WHERE id = $1`,
    [subjectId]
  );
  if (subjects.length === 0) {
    return { ok: false, status: 404, error: "Subject not found" };
  }

  const centres = await query<{ id: number }>(
    `SELECT id FROM centres WHERE id = $1`,
    [centreId]
  );
  if (centres.length === 0) {
    return { ok: false, status: 404, error: "Centre not found" };
  }

  if (code) {
    const codeClash = await query<{ id: number }>(
      `SELECT id FROM teacher WHERE teacher_id = $1`,
      [code]
    );
    if (codeClash.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `AF id ${code} is already used by another teacher`,
      };
    }
  }

  // Resolve the effective user identity (reuse-by-email; mirrors
  // createStaffMember) so we never mint a duplicate that orphans links.
  let existingUserId: number | null =
    permission.user_id === null ? null : Number(permission.user_id);
  if (existingUserId === null) {
    const found = await query<{ id: number | string }>(
      `SELECT id FROM "user" WHERE LOWER(email) = $1 ORDER BY id LIMIT 1`,
      [permission.email]
    );
    if (found.length > 0) existingUserId = Number(found[0].id);
  }

  if (existingUserId !== null) {
    const teacherClash = await query<{ id: number }>(
      `SELECT id FROM teacher WHERE user_id = $1 AND is_af_teacher = true`,
      [existingUserId]
    );
    if (teacherClash.length > 0) {
      return {
        ok: false,
        status: 409,
        error: "This person already has a teacher record",
      };
    }
  }

  await withTransaction(async (client) => {
    let userId = existingUserId;
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
    }
    if (userId !== permission.user_id) {
      await client.query(
        `UPDATE user_permission SET user_id = $1, updated_at = now() WHERE id = $2`,
        [userId, permission.id]
      );
    }
    // Teacher seats carry role 'subject_tbd' (the displayed subject lives in
    // teacher.subject_id, not the seat role) — same shape seat-pending-teachers.ts uses.
    await client.query(
      `INSERT INTO teacher (user_id, is_af_teacher, subject_id, teacher_id, inserted_at, updated_at)
       VALUES ($1, true, $2, $3, now(), now())`,
      [userId, subjectId, code]
    );
    await client.query(
      `INSERT INTO centre_positions (centre_id, role, user_id, inserted_at, updated_at)
       VALUES ($1, 'subject_tbd', $2, now(), now())`,
      [centreId, userId]
    );
    await clearExplicitSchoolScope(client, userId);
  });

  return { ok: true };
}

// --- Add centre staff from scratch (self-contained Staff Management) ---

export interface CreateSeatedUserBody {
  email?: unknown;
  full_name?: unknown;
  kind?: unknown; // "teacher" | "staff"
  centre_id?: unknown;
  subject_id?: unknown; // teacher only (required)
  role?: unknown; // staff only: PM tier (apm/pm/spm/ph)
  af_id?: unknown; // optional AF code
}

function isPmSeatRole(value: unknown): value is SeatRole {
  return (
    typeof value === "string" &&
    (PM_SEAT_ROLES as readonly string[]).includes(value)
  );
}

// Create a brand-new centre-staff person and seat them in ONE transaction —
// permission + user + teacher/staff record + centre seat — so the Staff
// Management page is self-contained (no separate Add User on /admin/users).
// Centre staff are level-1, seat-scoped: program_ids derive from the centre's
// program and explicit school scope is left NULL (resolveScope uses the seat).
// Atomic by design: a failure rolls back the whole thing rather than leaving an
// orphaned user_permission (the phantom-duplicate failure mode).
export async function createSeatedUser(params: {
  body: CreateSeatedUserBody;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const fields: Record<string, string> = {};
  const email =
    typeof params.body.email === "string" ? params.body.email.trim() : "";
  if (!email || !email.includes("@")) {
    fields.email = "A valid email is required";
  }
  const kind = params.body.kind;
  if (kind !== "teacher" && kind !== "staff") {
    fields.kind = "kind must be 'teacher' or 'staff'";
  }
  const centreId = Number(params.body.centre_id);
  if (!Number.isInteger(centreId) || centreId <= 0) {
    fields.centre_id = "Centre is required";
  }
  let subjectId: number | null = null;
  let seatRole: SeatRole = "subject_tbd";
  if (kind === "teacher") {
    subjectId = Number(params.body.subject_id);
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      fields.subject_id = "Subject is required";
    }
    seatRole = "subject_tbd";
  } else if (kind === "staff") {
    if (!isPmSeatRole(params.body.role)) {
      fields.role = `Role must be one of: ${PM_SEAT_ROLES.join(", ")}`;
    } else {
      seatRole = params.body.role as SeatRole;
    }
  }
  let code: string | null = null;
  const rawCode = params.body.af_id;
  if (rawCode !== undefined && rawCode !== null && String(rawCode).trim() !== "") {
    code = normalizeEmployeeCode(rawCode);
    if (!code) {
      fields.af_id = "AF id must look like AF123";
    }
  }
  if (Object.keys(fields).length > 0) {
    return { ok: false, status: 422, error: "Validation failed", fields };
  }

  const fullName =
    typeof params.body.full_name === "string"
      ? params.body.full_name.trim()
      : "";

  // The centre supplies the program scope (level-1 centre staff see students by
  // program ∩ school). A centre with no program can't seed program_ids.
  const centres = await query<{ id: number; program_id: number | null }>(
    `SELECT id, program_id FROM centres WHERE id = $1`,
    [centreId]
  );
  if (centres.length === 0) {
    return { ok: false, status: 404, error: "Centre not found" };
  }
  const programId = centres[0].program_id;
  if (programId == null) {
    return {
      ok: false,
      status: 422,
      error:
        "This centre has no program set — set its program in Centres first, then add staff.",
      fields: { centre_id: "Centre has no program" },
    };
  }

  // "Add" is for NEW people. Refuse (case-insensitively, closing the
  // case-variant dup gap for this path) when a permission already exists — the
  // admin should edit that person from the roster instead.
  const existingPerm = await query<{ id: number }>(
    `SELECT id FROM user_permission WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (existingPerm.length > 0) {
    return {
      ok: false,
      status: 409,
      error:
        "A user with this email already exists — edit them from the roster instead of adding again.",
    };
  }

  if (code) {
    const codeClash = await query<{ id: number }>(
      kind === "teacher"
        ? `SELECT id FROM teacher WHERE teacher_id = $1`
        : `SELECT id FROM staff WHERE employee_code = $1`,
      [code]
    );
    if (codeClash.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `AF id ${code} is already in use`,
      };
    }
  }

  const role = kind === "teacher" ? "teacher" : "program_manager";

  await withTransaction(async (client) => {
    const permIns = await client.query(
      `INSERT INTO user_permission
         (email, level, role, school_codes, regions, program_ids, read_only, full_name, inserted_at, updated_at)
       VALUES ($1, 1, $2, NULL, NULL, $3, false, $4, now(), now())
       RETURNING id`,
      [email, role, [programId], fullName || null]
    );
    const permissionId = Number(permIns.rows[0].id);

    // Reuse an existing user row for this email if one somehow exists; else mint.
    let userId: number | null = null;
    const foundUser = await client.query<{ id: number | string }>(
      `SELECT id FROM "user" WHERE LOWER(email) = LOWER($1) ORDER BY id LIMIT 1`,
      [email]
    );
    if (foundUser.rows.length > 0) {
      userId = Number(foundUser.rows[0].id);
    } else {
      const tokens = fullName.split(/\s+/).filter(Boolean);
      const userIns = await client.query(
        `INSERT INTO "user" (first_name, last_name, email, inserted_at, updated_at)
         VALUES ($1, $2, $3, now(), now()) RETURNING id`,
        [tokens[0] ?? null, tokens.length > 1 ? tokens.slice(1).join(" ") : null, email]
      );
      userId = Number(userIns.rows[0].id);
    }

    await client.query(
      `UPDATE user_permission SET user_id = $1, updated_at = now() WHERE id = $2`,
      [userId, permissionId]
    );

    // Reuse a dormant teacher/staff record if one exists (e.g. left behind when
    // this person was previously removed) rather than inserting a duplicate —
    // this is what makes remove → re-add seamless and dup-free.
    if (kind === "teacher") {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM teacher WHERE user_id = $1 AND is_af_teacher = true ORDER BY id LIMIT 1`,
        [userId]
      );
      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE teacher SET subject_id = $1, teacher_id = COALESCE($2, teacher_id),
             is_af_teacher = true, exit_date = NULL, updated_at = now()
           WHERE id = $3`,
          [subjectId, code, existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO teacher (user_id, is_af_teacher, subject_id, teacher_id, inserted_at, updated_at)
           VALUES ($1, true, $2, $3, now(), now())`,
          [userId, subjectId, code]
        );
      }
    } else {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM staff WHERE user_id = $1 ORDER BY id LIMIT 1`,
        [userId]
      );
      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE staff SET employee_code = COALESCE($1, employee_code),
             exit_date = NULL, updated_at = now()
           WHERE id = $2`,
          [code, existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO staff (user_id, employee_code, staff_type, inserted_at, updated_at)
           VALUES ($1, $2, 'program_manager', now(), now())`,
          [userId, code]
        );
      }
    }

    await client.query(
      `INSERT INTO centre_positions (centre_id, role, user_id, inserted_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [centreId, seatRole, userId]
    );
  });

  return { ok: true };
}

// Subject options for the create-teacher dropdown. `subject.name` is a
// multilingual jsonb array; the English label is name->0->>'subject'.
export async function getSubjectOptions(): Promise<
  { id: number; name: string }[]
> {
  const rows = await query<{ id: number | string; name: string | null }>(
    `SELECT id, name->0->>'subject' AS name FROM subject
     WHERE name->0->>'subject' IS NOT NULL
     ORDER BY name->0->>'subject'`
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name ?? "" }));
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

export interface UpdateStaffNameBody {
  user_id?: unknown;
  permission_id?: unknown;
  full_name?: unknown;
}

// A person's name lives in two places depending on the roster kind: the shared
// `user` table (teacher/staff rows show first_name + last_name) and
// `user_permission.full_name` (pending rows, plus what the Users screen and
// login display). Editing a name here writes BOTH — splitting the full name
// into first/last for `user` and mirroring the whole string to full_name — so
// the name stays consistent everywhere instead of drifting between screens.
export async function updateStaffName(params: {
  body: UpdateStaffNameBody;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const fullName =
    typeof params.body.full_name === "string" ? params.body.full_name.trim() : "";
  if (!fullName) {
    return {
      ok: false,
      status: 422,
      error: "Validation failed",
      fields: { full_name: "Name can't be empty" },
    };
  }
  const tokens = fullName.split(/\s+/).filter(Boolean);
  const normalized = tokens.join(" ");
  const firstName = tokens[0] ?? null;
  const lastName = tokens.length > 1 ? tokens.slice(1).join(" ") : null;

  const userId =
    params.body.user_id === undefined || params.body.user_id === null
      ? null
      : Number(params.body.user_id);
  if (userId !== null && (!Number.isInteger(userId) || userId <= 0)) {
    return {
      ok: false,
      status: 422,
      error: "Validation failed",
      fields: { user_id: "user_id must be a positive integer" },
    };
  }
  const permissionId =
    params.body.permission_id === undefined || params.body.permission_id === null
      ? null
      : Number(params.body.permission_id);
  if (permissionId !== null && (!Number.isInteger(permissionId) || permissionId <= 0)) {
    return {
      ok: false,
      status: 422,
      error: "Validation failed",
      fields: { permission_id: "permission_id must be a positive integer" },
    };
  }
  if (userId === null && permissionId === null) {
    return {
      ok: false,
      status: 422,
      error: "Provide user_id or permission_id to identify the person",
    };
  }

  let touched = 0;
  await withTransaction(async (client) => {
    if (userId !== null) {
      const userUpdate = await client.query(
        `UPDATE "user" SET first_name = $1, last_name = $2, updated_at = now()
         WHERE id = $3`,
        [firstName, lastName, userId]
      );
      touched += userUpdate.rowCount ?? 0;
      const permUpdate = await client.query(
        `UPDATE user_permission SET full_name = $1, updated_at = now()
         WHERE user_id = $2 AND revoked_at IS NULL`,
        [normalized, userId]
      );
      touched += permUpdate.rowCount ?? 0;
    }
    if (permissionId !== null) {
      const permUpdate = await client.query(
        `UPDATE user_permission SET full_name = $1, updated_at = now()
         WHERE id = $2`,
        [normalized, permissionId]
      );
      touched += permUpdate.rowCount ?? 0;
    }
  });

  if (touched === 0) {
    return { ok: false, status: 404, error: "Person not found" };
  }
  return { ok: true };
}

// --- Centre positions (seats): LMS-direct ---

export interface CreatePositionBody {
  centre_id?: unknown;
  role?: unknown;
  user_id?: unknown;
}

// Keep `teacher.subject_id` — the source the roster Subject column reads — in
// sync when a teacher is seated with a subject role (chemistry, physics, ...).
// The seat-role names map case-insensitively onto `subject.name`. No-op for PM
// tiers / `subject_tbd` / `apc` and for users without an AF teacher record.
async function syncTeacherSubjectFromRole(
  client: PoolClient,
  userId: number,
  role: SeatRole
): Promise<void> {
  if (!isSubjectSeatRole(role)) return;
  const subjects = await client.query<{ id: number }>(
    `SELECT id FROM subject WHERE LOWER(name->0->>'subject') = $1 LIMIT 1`,
    [role]
  );
  if (subjects.rows.length === 0) return;
  await client.query(
    `UPDATE teacher SET subject_id = $1, updated_at = now()
     WHERE user_id = $2 AND is_af_teacher = true`,
    [subjects.rows[0].id, userId]
  );
}

// Keep `user_permission.role` — the app-level role that gates the UI (Start
// Visit button, PM dashboard; see getFeatureAccess) — in sync with the person's
// centre seats. The seat is the source of truth: holding any PM-tier seat
// (apm/pm/spm/ph) makes the person a program_manager; with no PM-tier seat left
// they fall back to teacher. Both directions apply — gaining a PM seat promotes
// teacher→program_manager, losing the last one demotes program_manager→teacher.
//
// Only ever moves WITHIN the {teacher, program_manager} band. A manually
// elevated program_admin/admin is org-level (not seat-derived) and is left
// untouched, so this never demotes a real admin who happens to hold a ph seat.
// Only ever rewrites the live (revoked_at IS NULL) permission row — the same
// row the gating read uses — so cleaning up an exited person's seats never
// mutates their revoked row's role. No-ops when the user has no live
// user_permission row (a seated person who can't yet log in) or when the role
// already matches. Call after every seat write, once per affected user (both
// the new and prior occupant on a move).
async function syncAppRoleFromSeats(
  client: PoolClient,
  userId: number
): Promise<void> {
  const pmSeat = await client.query(
    `SELECT 1 FROM centre_positions
     WHERE user_id = $1 AND deleted_at IS NULL AND role = ANY($2)
     LIMIT 1`,
    [userId, [...PM_SEAT_ROLES]]
  );
  const desired = pmSeat.rows.length > 0 ? "program_manager" : "teacher";
  await client.query(
    `UPDATE user_permission
     SET role = $2, updated_at = now()
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND role IN ('teacher', 'program_manager')
       AND role <> $2`,
    [userId, desired]
  );
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
    const regionBlock = await rejectIfRegionLevelUser(userId);
    if (regionBlock) return regionBlock;
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
      await syncTeacherSubjectFromRole(client, userId, role);
      await clearExplicitSchoolScope(client, userId);
      await syncAppRoleFromSeats(client, userId);
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
  force?: boolean;
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
    user_id: number | null;
  }>(
    `SELECT id, centre_id, role, user_id FROM centre_positions
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
    const regionBlock = await rejectIfRegionLevelUser(userId);
    if (regionBlock) return regionBlock;
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

  // Vacating the seat: refuse if it's the occupant's only seat (would strand
  // them with no scope), unless the caller explicitly forces it (#2).
  if (
    userId === null &&
    position.user_id !== null &&
    !params.force &&
    (await isLastActiveSeat(position.user_id, params.id))
  ) {
    return LAST_SEAT_BLOCK;
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE centre_positions SET user_id = $1, updated_at = now() WHERE id = $2`,
      [userId, params.id]
    );
    if (userId !== null) {
      await clearExplicitSchoolScope(client, userId);
      await syncAppRoleFromSeats(client, userId);
    }
    // The prior occupant just lost this seat — re-derive their app role too,
    // in case this was their last PM-tier seat (program_manager → teacher).
    if (position.user_id !== null && position.user_id !== userId) {
      await syncAppRoleFromSeats(client, position.user_id);
    }
  });

  return { ok: true };
}

// Org tier (PM/APM/SPM/PH) is a person-level attribute, not per-centre: someone
// is the same tier at every centre they sit at. It is physically stored on each
// centre_positions row, so setting a person's role updates *all* their active
// seats at once, keeping them uniform.
export interface SetUserRoleBody {
  user_id?: unknown;
  role?: unknown;
}

export async function setUserRole(params: {
  body: SetUserRoleBody;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const fields: Record<string, string> = {};
  const userId = Number(params.body.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    fields.user_id = "user_id is required";
  }
  if (!isSeatRole(params.body.role)) {
    fields.role = `Role must be one of: ${SEAT_ROLES.join(", ")}`;
  }
  if (Object.keys(fields).length > 0) {
    return { ok: false, status: 422, error: "Validation failed", fields };
  }
  const role = params.body.role as SeatRole;

  let updatedCount = 0;
  await withTransaction(async (client) => {
    const updated = await client.query<{ id: number }>(
      `UPDATE centre_positions SET role = $1, updated_at = now()
       WHERE user_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [role, userId]
    );
    updatedCount = updated.rows.length;
    if (updatedCount === 0) return;
    await syncTeacherSubjectFromRole(client, userId, role);
    await syncAppRoleFromSeats(client, userId);
  });
  if (updatedCount === 0) {
    return {
      ok: false,
      status: 404,
      error: "This person has no centre assignments to set a role on",
    };
  }

  return { ok: true };
}

export async function deletePosition(params: {
  id: number;
  force?: boolean;
}): Promise<StaffMutationResult> {
  const schema = await checkStaffManagementSchema();
  if (!schema.ok) return schema;

  const positions = await query<{ id: number; user_id: number | null }>(
    `SELECT id, user_id FROM centre_positions WHERE id = $1 AND deleted_at IS NULL`,
    [params.id]
  );
  if (positions.length === 0) {
    return { ok: false, status: 404, error: "Position not found" };
  }
  const position = positions[0];

  // Deleting an occupied seat that is the occupant's last one strands them
  // (#2) — block unless forced. Empty seats delete freely.
  if (
    position.user_id !== null &&
    !params.force &&
    (await isLastActiveSeat(position.user_id, params.id))
  ) {
    return LAST_SEAT_BLOCK;
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE centre_positions SET deleted_at = now(), updated_at = now() WHERE id = $1`,
      [params.id]
    );
    // The occupant just lost this seat — re-derive their app role in case it
    // was their last PM-tier seat (program_manager → teacher).
    if (position.user_id !== null) {
      await syncAppRoleFromSeats(client, position.user_id);
    }
  });

  return { ok: true };
}
