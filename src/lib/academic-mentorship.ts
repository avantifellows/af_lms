import {
  ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST,
  CURRENT_ACADEMIC_YEAR,
} from "./constants";
import { parse } from "csv-parse/sync";
import { query, withTransaction } from "./db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getAccessibleSchoolCodes,
  getProgramContextSync,
  getResolvedPermission,
  type UserPermission,
} from "./permissions";

export type AcademicMentorshipAction = "view" | "edit";
type QueryRows = <T>(text: string, params?: unknown[]) => Promise<T[]>;

export type AcademicMentorshipSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

export interface AcademicMentorshipSchool {
  id: number;
  code: string;
  name: string;
  region: string | null;
}

export interface AcademicMentorshipProgram {
  id: number;
  name: string;
}

export type AcademicMentorshipAccessResult =
  | { ok: true; email: string; permission: UserPermission; canEdit: boolean; school?: AcademicMentorshipSchool }
  | { ok: false; status: 401 | 403 | 404; error: "Unauthorized" | "Forbidden" | "School not found" };

export function isValidAcademicYear(value: string): boolean {
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  return !!match && Number(match[2]) === Number(match[1]) + 1;
}

export function getAcademicMentorshipAcademicYears(
  currentAcademicYear = CURRENT_ACADEMIC_YEAR
): string[] {
  const start = Number(currentAcademicYear.slice(0, 4));
  return [0, 1, 2].map((offset) => {
    const year = start - offset;
    return `${year}-${year + 1}`;
  });
}

export function isAcademicMentorshipEditableYear(year: string): boolean {
  return year === CURRENT_ACADEMIC_YEAR;
}

interface AcademicMentorshipMappingRow {
  id: number | string;
  mentor_user_id: number | string;
  mentor_name: string | null;
  mentor_email: string | null;
  student_pk_id: number | string;
  mentee_name: string | null;
  mentee_student_id: string | null;
  mentee_grade: number | null;
  program_id: number | string | null;
  assigned_date: string;
  ended_date: string | null;
}

interface AcademicMentorshipTeacherMenteeRow {
  student_pk_id: number | string;
  mentee_name: string | null;
  mentee_student_id: string | null;
  mentee_grade: number | null;
  assigned_date: string;
}

export interface AcademicMentorshipMappingGroup {
  mentor: {
    userId: number;
    name: string;
    email: string | null;
  };
  menteeCount: number;
  mappings: Array<{
    id: number | string;
    mentee: {
      studentPkId: number;
      name: string;
      studentId: string | null;
      grade: number | null;
      programId: number | null;
    };
    assignedDate: string;
    endedDate: string | null;
    status: "active" | "historical";
  }>;
}

export interface AcademicMentorshipTeacherMentee {
  studentPkId: number;
  name: string;
  studentId: string | null;
  grade: number | null;
  assignedDate: string;
}

export interface AcademicMentorshipMentorOption {
  userId: number;
  name: string;
  email: string;
}

interface AcademicMentorshipMentorOptionRow {
  user_id: number | string;
  name: string | null;
  email: string;
}

export interface AcademicMentorshipMenteeOption {
  studentPkId: number;
  name: string;
  studentId: string | null;
  grade: number | null;
  programId: number | null;
}

interface AcademicMentorshipMenteeOptionRow {
  student_pk_id: number | string;
  name: string | null;
  student_id: string | null;
  grade: number | string | null;
  program_id: number | string | null;
}

export type AcademicMentorshipMutationResult =
  | { ok: true; mappingId: number }
  | { ok: false; status: 404 | 409 | 422; error: string };

export type AcademicMentorshipCsvImportResult =
  | { ok: true; insertedCount: number }
  | { ok: false; type: "file"; error: string }
  | {
      ok: false;
      type: "rows";
      errors: Array<{ rowNumber: number; error: string }>;
      errorCsv: string;
    };

interface AcademicMentorshipCsvRow {
  rowNumber: number;
  values: Record<string, string>;
  mentorEmail: string;
  studentId: string;
  errors: string[];
}

interface AcademicMentorshipImportMentorRow {
  email: string;
  user_id: number | string;
}

interface AcademicMentorshipImportMenteeRow {
  student_id: string;
  student_pk_id: number | string;
  program_id: number | string | null;
  active_mapping_id: number | string | null;
}

interface AcademicMentorshipCsvImportParams {
  csvText: string;
  schoolId: number;
  schoolCode: string;
  schoolRegion: string | null;
  academicYear: string;
  assignedByUserId: number;
}

type AcademicMentorshipParsedCsv =
  | { ok: true; header: string[]; rows: AcademicMentorshipCsvRow[] }
  | { ok: false; result: AcademicMentorshipCsvImportResult };

function hasAcademicMentorshipProgramAccess(permission: UserPermission): boolean {
  if (ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST.includes("*")) return true;
  const allowed = new Set<number>(
    ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST.map((id) => Number(id))
  );
  const context = getProgramContextSync(permission);
  return context.programIds.some((id) => allowed.has(id));
}

export function isAcademicMentorshipManagementRole(
  permission: UserPermission
): boolean {
  return permission.role === "admin" || permission.role === "program_admin";
}

async function findAcademicMentorshipSchool(
  schoolCode: string
): Promise<AcademicMentorshipSchool | null> {
  const rows = await query<AcademicMentorshipSchool>(
    `SELECT id, code, name, region
     FROM school
     WHERE code = $1
     LIMIT 1`,
    [schoolCode]
  );
  return rows[0] ?? null;
}

export async function requireAcademicMentorshipAccess(
  session: AcademicMentorshipSession,
  _action: AcademicMentorshipAction,
  options: { schoolCode?: string } = {}
): Promise<AcademicMentorshipAccessResult> {
  const email = session?.user?.email;
  if (!email) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (session.isPasscodeUser) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const permission = await getResolvedPermission(email);
  if (!permission || !hasAcademicMentorshipProgramAccess(permission)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const access = getFeatureAccess(permission, "academic_mentorship");
  if (!access.canView || (_action === "edit" && !access.canEdit)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (options.schoolCode) {
    const school = await findAcademicMentorshipSchool(options.schoolCode);
    if (!school) {
      return { ok: false, status: 404, error: "School not found" };
    }
    if (!canAccessSchoolSync(permission, school.code, school.region ?? undefined)) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    return { ok: true, email, permission, canEdit: access.canEdit, school };
  }

  return { ok: true, email, permission, canEdit: access.canEdit };
}

export async function listAcademicMentorshipMappings(params: {
  schoolId: number;
  academicYear: string;
  includeHistory: boolean;
  programId?: number | null;
}): Promise<AcademicMentorshipMappingGroup[]> {
  const rows = await query<AcademicMentorshipMappingRow>(
    `SELECT
       m.id,
       m.mentor_user_id,
       NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), '') AS mentor_name,
       mentor.email AS mentor_email,
       st.id AS student_pk_id,
       NULLIF(TRIM(COALESCE(mentee.first_name, '') || ' ' || COALESCE(mentee.last_name, '')), '') AS mentee_name,
       st.student_id AS mentee_student_id,
       gr.number AS mentee_grade,
       m.program_id,
       m.assigned_at::date::text AS assigned_date,
       m.ended_at::date::text AS ended_date
     FROM academic_mentorship_mentor_mentee_mappings m
     JOIN "user" mentor ON mentor.id = m.mentor_user_id
     JOIN student st ON st.id = m.student_id
     JOIN "user" mentee ON mentee.id = st.user_id
     LEFT JOIN LATERAL (
       SELECT er.group_id
       FROM enrollment_record er
       WHERE er.user_id = mentee.id
         AND er.group_type = 'grade'
         AND er.academic_year = m.academic_year
       ORDER BY er.is_current DESC, er.updated_at DESC NULLS LAST, er.id DESC
       LIMIT 1
     ) er_grade ON true
     LEFT JOIN grade gr ON gr.id = er_grade.group_id
     WHERE m.school_id = $1
       AND m.academic_year = $2
       AND ($3::boolean OR m.ended_at IS NULL)
       AND ($4::int IS NULL OR m.program_id = $4)
     ORDER BY mentor_name ASC NULLS LAST, mentor.email ASC, gr.number ASC NULLS LAST, mentee_name ASC NULLS LAST, st.student_id ASC`,
    [params.schoolId, params.academicYear, params.includeHistory, params.programId ?? null]
  );

  const groups = new Map<number, AcademicMentorshipMappingGroup>();
  for (const row of rows) {
    const mentorUserId = Number(row.mentor_user_id);
    const mentorName = row.mentor_name || row.mentor_email || "Unknown mentor";
    const group =
      groups.get(mentorUserId) ??
      {
        mentor: {
          userId: mentorUserId,
          name: mentorName,
          email: row.mentor_email,
        },
        menteeCount: 0,
        mappings: [],
      };
    group.mappings.push({
      id: row.id,
      mentee: {
        studentPkId: Number(row.student_pk_id),
        name: row.mentee_name || row.mentee_student_id || "Unknown student",
        studentId: row.mentee_student_id,
        grade: row.mentee_grade === null ? null : Number(row.mentee_grade),
        programId: row.program_id === null ? null : Number(row.program_id),
      },
      assignedDate: row.assigned_date,
      endedDate: row.ended_date,
      status: row.ended_date ? "historical" : "active",
    });
    group.menteeCount = group.mappings.length;
    groups.set(mentorUserId, group);
  }

  return [...groups.values()];
}

export async function listAcademicMentorshipTeacherMentees(params: {
  schoolId: number;
  academicYear: string;
  mentorUserId: number;
}): Promise<AcademicMentorshipTeacherMentee[]> {
  const rows = await query<AcademicMentorshipTeacherMenteeRow>(
    `SELECT
       st.id AS student_pk_id,
       NULLIF(TRIM(COALESCE(mentee.first_name, '') || ' ' || COALESCE(mentee.last_name, '')), '') AS mentee_name,
       st.student_id AS mentee_student_id,
       gr.number AS mentee_grade,
       m.assigned_at::date::text AS assigned_date
     FROM academic_mentorship_mentor_mentee_mappings m
     JOIN student st ON st.id = m.student_id
     JOIN "user" mentee ON mentee.id = st.user_id
     LEFT JOIN LATERAL (
       SELECT er.group_id
       FROM enrollment_record er
       WHERE er.user_id = mentee.id
         AND er.group_type = 'grade'
         AND er.academic_year = m.academic_year
       ORDER BY er.is_current DESC, er.updated_at DESC NULLS LAST, er.id DESC
       LIMIT 1
     ) er_grade ON true
     LEFT JOIN grade gr ON gr.id = er_grade.group_id
     WHERE m.school_id = $1
       AND m.academic_year = $2
       AND m.mentor_user_id = $3
       AND m.ended_at IS NULL
     ORDER BY gr.number ASC NULLS LAST, mentee_name ASC NULLS LAST, st.student_id ASC`,
    [params.schoolId, params.academicYear, params.mentorUserId]
  );

  return rows.map((row) => ({
    studentPkId: Number(row.student_pk_id),
    name: row.mentee_name || row.mentee_student_id || "Unknown student",
    studentId: row.mentee_student_id,
    grade: row.mentee_grade === null ? null : Number(row.mentee_grade),
    assignedDate: row.assigned_date,
  }));
}

export async function listAcademicMentorshipMentorOptions(params: {
  schoolId: number;
  schoolCode: string;
  schoolRegion: string | null;
  search?: string;
}): Promise<AcademicMentorshipMentorOption[]> {
  const search = `%${(params.search ?? "").trim()}%`;
  const rows = await query<AcademicMentorshipMentorOptionRow>(
    `SELECT
       u.id AS user_id,
       NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name,
       u.email
     FROM teacher t
     JOIN "user" u ON u.id = t.user_id
     JOIN user_permission up
       ON (up.user_id = u.id OR LOWER(up.email) = LOWER(u.email))
      AND up.role = 'teacher'
      AND up.revoked_at IS NULL
     LEFT JOIN centre_positions cp
       ON cp.user_id = u.id
      AND cp.deleted_at IS NULL
     LEFT JOIN centres c
       ON c.id = cp.centre_id
     WHERE t.is_af_teacher = true
       AND t.exit_date IS NULL
       AND (
         up.level = 3
         OR up.school_codes @> ARRAY[$1]::text[]
         OR ($2::text IS NOT NULL AND up.regions @> ARRAY[$2]::text[])
         OR c.school_id = $3
       )
       AND (
         $4 = '%%'
         OR u.email ILIKE $4
         OR TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $4
       )
     GROUP BY u.id, u.first_name, u.last_name, u.email
     ORDER BY name ASC NULLS LAST, u.email ASC
     LIMIT 50`,
    [params.schoolCode, params.schoolRegion, params.schoolId, search]
  );

  return rows.map((row) => ({
    userId: Number(row.user_id),
    name: row.name || row.email,
    email: row.email,
  }));
}

export async function listAcademicMentorshipMenteeOptions(params: {
  schoolId: number;
  academicYear: string;
  programId?: number | null;
  search?: string;
}): Promise<AcademicMentorshipMenteeOption[]> {
  const search = `%${(params.search ?? "").trim()}%`;
  const rows = await query<AcademicMentorshipMenteeOptionRow>(
    `SELECT
       st.id AS student_pk_id,
       NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name,
       st.student_id,
       gr.number AS grade,
       roster_program.program_id
     FROM group_user gu
     JOIN "group" g ON g.id = gu.group_id
     JOIN "user" u ON u.id = gu.user_id
     JOIN student st ON st.user_id = u.id
     JOIN LATERAL (
       SELECT er.group_id
       FROM enrollment_record er
       WHERE er.user_id = u.id
         AND er.group_type = 'grade'
         AND er.academic_year = $2
       ORDER BY er.is_current DESC, er.updated_at DESC NULLS LAST, er.id DESC
       LIMIT 1
     ) er_grade ON true
     LEFT JOIN grade gr ON gr.id = er_grade.group_id
     LEFT JOIN LATERAL (
       SELECT b.program_id
       FROM group_user gu_batch
       JOIN "group" g_batch ON g_batch.id = gu_batch.group_id AND g_batch.type = 'batch'
       JOIN batch b ON b.id = g_batch.child_id
       WHERE gu_batch.user_id = u.id
       ORDER BY array_position(ARRAY[1, 2, 64]::int[], b.program_id)
       LIMIT 1
     ) roster_program ON true
     LEFT JOIN academic_mentorship_mentor_mentee_mappings active_mapping
       ON active_mapping.school_id = $1
      AND active_mapping.academic_year = $2
      AND active_mapping.student_id = st.id
      AND active_mapping.ended_at IS NULL
     WHERE g.type = 'school'
       AND g.child_id = $1
       AND st.status IS DISTINCT FROM 'dropout'
       AND active_mapping.id IS NULL
       AND ($4::int IS NULL OR roster_program.program_id = $4)
       AND (
         $3 = '%%'
         OR st.student_id ILIKE $3
         OR TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $3
       )
     ORDER BY gr.number ASC NULLS LAST, name ASC NULLS LAST, st.student_id ASC
     LIMIT 50`,
    [params.schoolId, params.academicYear, search, params.programId ?? null]
  );

  return rows.map((row) => ({
    studentPkId: Number(row.student_pk_id),
    name: row.name || row.student_id || "Unknown student",
    studentId: row.student_id,
    grade: row.grade === null ? null : Number(row.grade),
    programId: row.program_id === null ? null : Number(row.program_id),
  }));
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

async function hasEligibleAcademicMentor(params: {
  schoolId: number;
  schoolCode: string;
  schoolRegion: string | null;
  mentorUserId: number;
}): Promise<boolean> {
  const rows = await query<{ user_id: number | string }>(
    `SELECT u.id AS user_id
     FROM teacher t
     JOIN "user" u ON u.id = t.user_id
     JOIN user_permission up
       ON (up.user_id = u.id OR LOWER(up.email) = LOWER(u.email))
      AND up.role = 'teacher'
      AND up.revoked_at IS NULL
     LEFT JOIN centre_positions cp
       ON cp.user_id = u.id
      AND cp.deleted_at IS NULL
     LEFT JOIN centres c
       ON c.id = cp.centre_id
     WHERE t.is_af_teacher = true
       AND t.exit_date IS NULL
       AND u.id = $4
       AND (
         up.level = 3
         OR up.school_codes @> ARRAY[$1]::text[]
         OR ($2::text IS NOT NULL AND up.regions @> ARRAY[$2]::text[])
         OR c.school_id = $3
       )
     LIMIT 1`,
    [params.schoolCode, params.schoolRegion, params.schoolId, params.mentorUserId]
  );
  return rows.length > 0;
}

async function getEligibleMenteeProgramWithQuery(
  runQuery: QueryRows,
  params: {
    schoolId: number;
    academicYear: string;
    studentPkId: number;
  }
): Promise<number | null | undefined> {
  const rows = await runQuery<{
    student_pk_id: number | string;
    program_id: number | string | null;
  }>(
    `SELECT st.id AS student_pk_id, roster_program.program_id
     FROM group_user gu
     JOIN "group" g ON g.id = gu.group_id
     JOIN "user" u ON u.id = gu.user_id
     JOIN student st ON st.user_id = u.id
     JOIN LATERAL (
       SELECT er.group_id
       FROM enrollment_record er
       WHERE er.user_id = u.id
         AND er.group_type = 'grade'
         AND er.academic_year = $2
       ORDER BY er.is_current DESC, er.updated_at DESC NULLS LAST, er.id DESC
       LIMIT 1
     ) er_grade ON true
     LEFT JOIN LATERAL (
       SELECT b.program_id
       FROM group_user gu_batch
       JOIN "group" g_batch ON g_batch.id = gu_batch.group_id AND g_batch.type = 'batch'
       JOIN batch b ON b.id = g_batch.child_id
       WHERE gu_batch.user_id = u.id
       ORDER BY array_position(ARRAY[1, 2, 64]::int[], b.program_id)
       LIMIT 1
     ) roster_program ON true
     WHERE g.type = 'school'
       AND g.child_id = $1
       AND st.id = $3
       AND st.status IS DISTINCT FROM 'dropout'
     LIMIT 1`,
    [params.schoolId, params.academicYear, params.studentPkId]
  );
  if (rows.length === 0) return undefined;
  return rows[0].program_id === null ? null : Number(rows[0].program_id);
}

async function getEligibleMenteeProgram(params: {
  schoolId: number;
  academicYear: string;
  studentPkId: number;
}): Promise<number | null | undefined> {
  return getEligibleMenteeProgramWithQuery(query, params);
}

export async function createAcademicMentorshipMapping(params: {
  schoolId: number;
  schoolCode: string;
  schoolRegion: string | null;
  academicYear: string;
  mentorUserId: number;
  studentPkId: number;
  assignedByUserId: number;
}): Promise<AcademicMentorshipMutationResult> {
  const mentorOk = await hasEligibleAcademicMentor(params);
  if (!mentorOk) {
    return {
      ok: false,
      status: 422,
      error: "Academic Mentor is not eligible for this School",
    };
  }

  const activeRows = await query<{ id: number | string }>(
    `SELECT id
     FROM academic_mentorship_mentor_mentee_mappings
     WHERE school_id = $1
       AND academic_year = $2
       AND student_id = $3
       AND ended_at IS NULL
     LIMIT 1`,
    [params.schoolId, params.academicYear, params.studentPkId]
  );
  if (activeRows.length > 0) {
    return { ok: false, status: 409, error: "Student already has a mentor mapped" };
  }

  const programId = await getEligibleMenteeProgram(params);
  if (programId === undefined) {
    return {
      ok: false,
      status: 422,
      error: "Mentee is not eligible for this School and academic year",
    };
  }

  try {
    const inserted = await query<{ id: number | string }>(
      `INSERT INTO academic_mentorship_mentor_mentee_mappings
         (school_id, academic_year, mentor_user_id, student_id, program_id, assigned_by_user_id, assigned_at, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now(), now())
       RETURNING id`,
      [
        params.schoolId,
        params.academicYear,
        params.mentorUserId,
        params.studentPkId,
        programId,
        params.assignedByUserId,
      ]
    );
    return { ok: true, mappingId: Number(inserted[0].id) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, status: 409, error: "Student already has a mentor mapped" };
    }
    throw error;
  }
}

function csvFileParseFailure(error: string): AcademicMentorshipParsedCsv {
  return { ok: false, result: { ok: false, type: "file", error } };
}

function parseAcademicMentorshipCsvRecords(csvText: string): string[][] | null {
  try {
    return parse(csvText, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as string[][];
  } catch {
    return null;
  }
}

function academicMentorshipCsvHeaderError(header: string[]): string | null {
  if (header.length === 0 || header.every((value) => value === "")) {
    return "CSV file is empty";
  }
  if (!header.includes("mentor_email") || !header.includes("student_id")) {
    return "CSV must include mentor_email and student_id headers";
  }
  return null;
}

function academicMentorshipCsvRowLimitError(rowCount: number): string | null {
  if (rowCount === 0) return "CSV file has no data rows";
  if (rowCount > 2000) return "CSV upload is capped at 2,000 data rows";
  return null;
}

function buildAcademicMentorshipCsvRow(
  header: string[],
  record: string[],
  rowNumber: number
): AcademicMentorshipCsvRow | null {
  if (record.every((value) => value.trim() === "")) return null;
  const values = Object.fromEntries(
    header.map((column, columnIndex) => [column, record[columnIndex] ?? ""])
  );
  const mentorEmail = (values.mentor_email ?? "").trim();
  const studentId = (values.student_id ?? "").trim();
  const errors: string[] = [];
  if (!mentorEmail) errors.push("mentor_email is required");
  if (!studentId) errors.push("student_id is required");
  return { rowNumber, values, mentorEmail, studentId, errors };
}

function buildAcademicMentorshipCsvRows(
  header: string[],
  records: string[][]
): AcademicMentorshipCsvRow[] {
  return records.slice(1).flatMap((record, index) => {
    const row = buildAcademicMentorshipCsvRow(header, record, index + 2);
    return row ? [row] : [];
  });
}

function addDuplicateStudentIdErrors(rows: AcademicMentorshipCsvRow[]) {
  const rowsByStudentId = new Map<string, AcademicMentorshipCsvRow[]>();
  for (const row of rows) {
    if (!row.studentId) continue;
    rowsByStudentId.set(row.studentId, [
      ...(rowsByStudentId.get(row.studentId) ?? []),
      row,
    ]);
  }

  for (const [studentId, duplicateRows] of rowsByStudentId) {
    if (duplicateRows.length < 2) continue;
    const rowNumbers = duplicateRows.map((row) => row.rowNumber).join(", ");
    for (const row of duplicateRows) {
      row.errors.push(`Duplicate student_id ${studentId} in rows ${rowNumbers}`);
    }
  }
}

function academicMentorshipCsvRowsFailure(
  header: string[],
  invalidRows: AcademicMentorshipCsvRow[]
): AcademicMentorshipCsvImportResult {
  return {
    ok: false,
    type: "rows",
    errors: invalidRows.flatMap((row) =>
      row.errors.map((error) => ({ rowNumber: row.rowNumber, error }))
    ),
    errorCsv: buildAcademicMentorshipImportErrorCsv(header, invalidRows),
  };
}

function parseAcademicMentorshipCsv(csvText: string): AcademicMentorshipParsedCsv {
  const records = parseAcademicMentorshipCsvRecords(csvText);
  if (!records) return csvFileParseFailure("CSV could not be parsed");

  const header = records[0]?.map((value) => value.trim()) ?? [];
  const headerError = academicMentorshipCsvHeaderError(header);
  if (headerError) return csvFileParseFailure(headerError);

  const rows = buildAcademicMentorshipCsvRows(header, records);
  const rowLimitError = academicMentorshipCsvRowLimitError(rows.length);
  if (rowLimitError) return csvFileParseFailure(rowLimitError);

  addDuplicateStudentIdErrors(rows);
  const invalidRows = rows.filter((row) => row.errors.length > 0);
  if (invalidRows.length > 0) {
    return { ok: false, result: academicMentorshipCsvRowsFailure(header, invalidRows) };
  }

  return { ok: true, header, rows };
}

function uniqueMentorEmails(rows: AcademicMentorshipCsvRow[]): string[] {
  return [...new Set(rows.map((row) => row.mentorEmail.toLowerCase()))];
}

function uniqueStudentIds(rows: AcademicMentorshipCsvRow[]): string[] {
  return [...new Set(rows.map((row) => row.studentId))];
}

async function loadAcademicMentorshipImportMentors(
  params: AcademicMentorshipCsvImportParams,
  mentorEmails: string[]
): Promise<Map<string, number>> {
  const mentorRows = await query<AcademicMentorshipImportMentorRow>(
    `SELECT LOWER(u.email) AS email, u.id AS user_id
     FROM teacher t
     JOIN "user" u ON u.id = t.user_id
     JOIN user_permission up
       ON (up.user_id = u.id OR LOWER(up.email) = LOWER(u.email))
      AND up.role = 'teacher'
      AND up.revoked_at IS NULL
     LEFT JOIN centre_positions cp
       ON cp.user_id = u.id
      AND cp.deleted_at IS NULL
     LEFT JOIN centres c
       ON c.id = cp.centre_id
     WHERE t.is_af_teacher = true
       AND t.exit_date IS NULL
       AND LOWER(u.email) = ANY($4::text[])
       AND (
         up.level = 3
         OR up.school_codes @> ARRAY[$1]::text[]
         OR ($2::text IS NOT NULL AND up.regions @> ARRAY[$2]::text[])
         OR c.school_id = $3
       )
     GROUP BY u.id, u.email`,
    [params.schoolCode, params.schoolRegion, params.schoolId, mentorEmails]
  );
  return new Map(
    mentorRows.map((row) => [row.email.toLowerCase(), Number(row.user_id)])
  );
}

async function loadAcademicMentorshipImportMentees(
  params: AcademicMentorshipCsvImportParams,
  studentIds: string[]
): Promise<Map<string, AcademicMentorshipImportMenteeRow>> {
  const menteeRows = await query<AcademicMentorshipImportMenteeRow>(
    `SELECT DISTINCT ON (TRIM(st.student_id))
       TRIM(st.student_id) AS student_id,
       st.id AS student_pk_id,
       roster_program.program_id,
       active_mapping.id AS active_mapping_id
     FROM group_user gu
     JOIN "group" g ON g.id = gu.group_id
     JOIN "user" u ON u.id = gu.user_id
     JOIN student st ON st.user_id = u.id
     JOIN LATERAL (
       SELECT er.group_id
       FROM enrollment_record er
       WHERE er.user_id = u.id
         AND er.group_type = 'grade'
         AND er.academic_year = $2
       ORDER BY er.is_current DESC, er.updated_at DESC NULLS LAST, er.id DESC
       LIMIT 1
     ) er_grade ON true
     LEFT JOIN LATERAL (
       SELECT b.program_id
       FROM group_user gu_batch
       JOIN "group" g_batch ON g_batch.id = gu_batch.group_id AND g_batch.type = 'batch'
       JOIN batch b ON b.id = g_batch.child_id
       WHERE gu_batch.user_id = u.id
       ORDER BY array_position(ARRAY[1, 2, 64]::int[], b.program_id)
       LIMIT 1
     ) roster_program ON true
     LEFT JOIN academic_mentorship_mentor_mentee_mappings active_mapping
       ON active_mapping.school_id = $1
      AND active_mapping.academic_year = $2
      AND active_mapping.student_id = st.id
      AND active_mapping.ended_at IS NULL
     WHERE g.type = 'school'
       AND g.child_id = $1
       AND st.status IS DISTINCT FROM 'dropout'
       AND TRIM(st.student_id) = ANY($3::text[])
     ORDER BY TRIM(st.student_id), active_mapping.id NULLS FIRST`,
    [params.schoolId, params.academicYear, studentIds]
  );
  return new Map(menteeRows.map((row) => [row.student_id, row]));
}

function addAcademicMentorshipImportLookupErrors(
  rows: AcademicMentorshipCsvRow[],
  mentorByEmail: Map<string, number>,
  menteeByStudentId: Map<string, AcademicMentorshipImportMenteeRow>
) {
  for (const row of rows) {
    if (!mentorByEmail.has(row.mentorEmail.toLowerCase())) {
      row.errors.push("mentor_email is not an eligible Academic Mentor for this School");
    }
    const mentee = menteeByStudentId.get(row.studentId);
    if (!mentee) {
      row.errors.push("student_id is not an eligible Mentee for this School and academic year");
    } else if (mentee.active_mapping_id != null) {
      row.errors.push("Student already has a mentor mapped");
    }
  }
}

function academicMentorshipImportValues(rowCount: number): string {
  return Array.from({ length: rowCount }, (_, index) => {
    const start = index * 6;
    return `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, now(), now(), now())`;
  }).join(", ");
}

function academicMentorshipImportParams(
  params: AcademicMentorshipCsvImportParams,
  rows: AcademicMentorshipCsvRow[],
  mentorByEmail: Map<string, number>,
  menteeByStudentId: Map<string, AcademicMentorshipImportMenteeRow>
): unknown[] {
  return rows.flatMap((row) => {
    const mentee = menteeByStudentId.get(row.studentId)!;
    return [
      params.schoolId,
      params.academicYear,
      mentorByEmail.get(row.mentorEmail.toLowerCase())!,
      Number(mentee.student_pk_id),
      mentee.program_id === null ? null : Number(mentee.program_id),
      params.assignedByUserId,
    ];
  });
}

async function insertAcademicMentorshipImportRows(
  params: AcademicMentorshipCsvImportParams,
  rows: AcademicMentorshipCsvRow[],
  mentorByEmail: Map<string, number>,
  menteeByStudentId: Map<string, AcademicMentorshipImportMenteeRow>
): Promise<AcademicMentorshipCsvImportResult> {
  try {
    return await withTransaction(async (client) => {
      const values = academicMentorshipImportValues(rows.length);
      const insertParams = academicMentorshipImportParams(
        params,
        rows,
        mentorByEmail,
        menteeByStudentId
      );
      const inserted = await client.query<{ id: number | string }>(
        `INSERT INTO academic_mentorship_mentor_mentee_mappings
           (school_id, academic_year, mentor_user_id, student_id, program_id, assigned_by_user_id, assigned_at, inserted_at, updated_at)
         VALUES ${values}
         RETURNING id`,
        insertParams
      );
      return { ok: true, insertedCount: inserted.rows.length };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, type: "file", error: "Student already has a mentor mapped" };
    }
    throw error;
  }
}

export async function importAcademicMentorshipMappingsFromCsv(
  params: AcademicMentorshipCsvImportParams
): Promise<AcademicMentorshipCsvImportResult> {
  const parsed = parseAcademicMentorshipCsv(params.csvText);
  if (!parsed.ok) return parsed.result;

  const { header, rows } = parsed;
  const mentorByEmail = await loadAcademicMentorshipImportMentors(
    params,
    uniqueMentorEmails(rows)
  );
  const menteeByStudentId = await loadAcademicMentorshipImportMentees(
    params,
    uniqueStudentIds(rows)
  );

  addAcademicMentorshipImportLookupErrors(rows, mentorByEmail, menteeByStudentId);
  const invalidRows = rows.filter((row) => row.errors.length > 0);
  if (invalidRows.length > 0) {
    return academicMentorshipCsvRowsFailure(header, invalidRows);
  }

  return insertAcademicMentorshipImportRows(params, rows, mentorByEmail, menteeByStudentId);
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function buildAcademicMentorshipImportErrorCsv(
  header: string[],
  rows: AcademicMentorshipCsvRow[]
): string {
  const outputHeader = [...header, "error_reason"];
  const lines = [
    outputHeader.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        ...header.map((column) => row.values[column] ?? ""),
        row.errors.join("; "),
      ]
        .map(csvCell)
        .join(",")
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export async function getAcademicMentorshipActorUserId(
  email: string,
  permission: UserPermission
): Promise<number | null> {
  if (permission.user_id != null) return Number(permission.user_id);

  const rows = await query<{ id: number | string }>(
    `SELECT id FROM "user" WHERE LOWER(email) = LOWER($1) ORDER BY id LIMIT 1`,
    [email]
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
}

export async function endAcademicMentorshipMapping(params: {
  schoolId: number;
  academicYear: string;
  mappingId: number;
  endedByUserId: number;
}): Promise<AcademicMentorshipMutationResult> {
  const updated = await query<{ id: number | string }>(
    `UPDATE academic_mentorship_mentor_mentee_mappings
     SET ended_at = now(),
         ended_by_user_id = $4,
         updated_at = now()
     WHERE id = $1
       AND school_id = $2
       AND academic_year = $3
       AND ended_at IS NULL
     RETURNING id`,
    [params.mappingId, params.schoolId, params.academicYear, params.endedByUserId]
  );

  if (updated.length === 0) {
    return { ok: false, status: 404, error: "Active Mapping not found" };
  }

  return { ok: true, mappingId: Number(updated[0].id) };
}

export async function reassignAcademicMentorshipMapping(params: {
  schoolId: number;
  schoolCode: string;
  schoolRegion: string | null;
  academicYear: string;
  mappingId: number;
  replacementMentorUserId: number;
  assignedByUserId: number;
}): Promise<AcademicMentorshipMutationResult> {
  const mentorOk = await hasEligibleAcademicMentor({
    schoolId: params.schoolId,
    schoolCode: params.schoolCode,
    schoolRegion: params.schoolRegion,
    mentorUserId: params.replacementMentorUserId,
  });
  if (!mentorOk) {
    return {
      ok: false,
      status: 422,
      error: "Academic Mentor is not eligible for this School",
    };
  }

  try {
    return await withTransaction(async (client) => {
      const runQuery: QueryRows = async (text, values) => {
        const result = await client.query(text, values);
        return result.rows;
      };
      const activeRows = await runQuery<{
        student_id: number | string;
        mentor_user_id: number | string;
      }>(
        `SELECT student_id, mentor_user_id
         FROM academic_mentorship_mentor_mentee_mappings
         WHERE id = $1
           AND school_id = $2
           AND academic_year = $3
           AND ended_at IS NULL
         FOR UPDATE`,
        [params.mappingId, params.schoolId, params.academicYear]
      );
      if (activeRows.length === 0) {
        return { ok: false, status: 404, error: "Active Mapping not found" };
      }
      if (Number(activeRows[0].mentor_user_id) === params.replacementMentorUserId) {
        return {
          ok: false,
          status: 422,
          error: "Replacement Academic Mentor must be different",
        };
      }

      const studentPkId = Number(activeRows[0].student_id);
      const programId = await getEligibleMenteeProgramWithQuery(runQuery, {
        schoolId: params.schoolId,
        academicYear: params.academicYear,
        studentPkId,
      });
      if (programId === undefined) {
        return {
          ok: false,
          status: 422,
          error: "Mentee is not eligible for this School and academic year",
        };
      }

      const ended = await runQuery<{ id: number | string }>(
        `UPDATE academic_mentorship_mentor_mentee_mappings
         SET ended_at = now(),
             ended_by_user_id = $4,
             updated_at = now()
         WHERE id = $1
           AND school_id = $2
           AND academic_year = $3
           AND ended_at IS NULL
         RETURNING id`,
        [params.mappingId, params.schoolId, params.academicYear, params.assignedByUserId]
      );
      if (ended.length === 0) {
        return { ok: false, status: 404, error: "Active Mapping not found" };
      }

      const inserted = await runQuery<{ id: number | string }>(
        `INSERT INTO academic_mentorship_mentor_mentee_mappings
           (school_id, academic_year, mentor_user_id, student_id, program_id, assigned_by_user_id, assigned_at, inserted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now(), now())
         RETURNING id`,
        [
          params.schoolId,
          params.academicYear,
          params.replacementMentorUserId,
          studentPkId,
          programId,
          params.assignedByUserId,
        ]
      );

      return { ok: true, mappingId: Number(inserted[0].id) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, status: 409, error: "Student already has a mentor mapped" };
    }
    throw error;
  }
}

export async function listAccessibleAcademicMentorshipSchools(
  permission: UserPermission
): Promise<AcademicMentorshipSchool[]> {
  const schoolCodes = await getAccessibleSchoolCodes(permission.email, permission);
  if (schoolCodes !== "all" && schoolCodes.length === 0) return [];

  if (schoolCodes === "all") {
    return query<AcademicMentorshipSchool>(
      `SELECT id, code, name, region
       FROM school
       ORDER BY name ASC, code ASC`
    );
  }

  return query<AcademicMentorshipSchool>(
    `SELECT id, code, name, region
     FROM school
     WHERE code = ANY($1)
     ORDER BY name ASC, code ASC`,
    [schoolCodes]
  );
}

export async function listAcademicMentorshipProgramsForSchools(
  schoolIds: number[],
  academicYear: string
): Promise<AcademicMentorshipProgram[]> {
  if (schoolIds.length === 0) return [];
  return query<AcademicMentorshipProgram>(
    `SELECT DISTINCT p.id::int AS id, p.name
     FROM school s
     JOIN "group" school_group
       ON school_group.child_id = s.id
      AND school_group.type = 'school'
     JOIN group_user school_member
       ON school_member.group_id = school_group.id
     JOIN enrollment_record er
       ON er.user_id = school_member.user_id
      AND er.group_type = 'grade'
      AND er.academic_year = $2
     JOIN group_user batch_member
       ON batch_member.user_id = school_member.user_id
     JOIN "group" batch_group
       ON batch_group.id = batch_member.group_id
      AND batch_group.type = 'batch'
     JOIN batch b
       ON b.id = batch_group.child_id
     JOIN program p
       ON p.id = b.program_id
     WHERE s.id = ANY($1::bigint[])
     ORDER BY p.name ASC`,
    [schoolIds, academicYear]
  );
}

export async function filterAcademicMentorshipSchoolsByProgram(
  schools: AcademicMentorshipSchool[],
  academicYear: string,
  programId: number | null
): Promise<AcademicMentorshipSchool[]> {
  if (programId === null || schools.length === 0) return schools;
  const rows = await query<{ id: number | string }>(
    `SELECT DISTINCT s.id
     FROM school s
     JOIN "group" school_group
       ON school_group.child_id = s.id
      AND school_group.type = 'school'
     JOIN group_user school_member
       ON school_member.group_id = school_group.id
     JOIN enrollment_record er
       ON er.user_id = school_member.user_id
      AND er.group_type = 'grade'
      AND er.academic_year = $2
     JOIN group_user batch_member
       ON batch_member.user_id = school_member.user_id
     JOIN "group" batch_group
       ON batch_group.id = batch_member.group_id
      AND batch_group.type = 'batch'
     JOIN batch b
       ON b.id = batch_group.child_id
     WHERE s.id = ANY($1::bigint[])
       AND b.program_id = $3`,
    [schools.map((school) => school.id), academicYear, programId]
  );
  const matchingIds = new Set(rows.map((row) => Number(row.id)));
  return schools.filter((school) => matchingIds.has(school.id));
}
