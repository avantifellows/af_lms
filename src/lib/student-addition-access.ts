import { PROGRAM_IDS } from "@/lib/constants";
import { query } from "@/lib/db";
import {
  canAccessSchool,
  canAccessSchoolSync,
  getFeatureAccess,
  getProgramContextSync,
  getResolvedPermission,
  type UserPermission,
  type UserRole,
} from "@/lib/permissions";

const ALLOWED_STUDENT_ADDITION_ROLES: ReadonlySet<UserRole> = new Set([
  "admin",
  "program_manager",
  "program_admin",
]);

export interface StudentAdditionSchool {
  code: string;
  udise_code: string | null;
  region: string | null;
  af_school_category: string | null;
  centre_program_ids?: Array<number | string> | null;
}

interface StudentWriteSession {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
}

export type StudentAdditionAccessResult =
  | {
      ok: true;
      permission: UserPermission;
      programId: typeof PROGRAM_IDS.NVS;
      actor: {
        user_id: number | null;
        email: string;
        login_type: "google";
        role: UserRole;
      };
    }
  | { ok: false; status: 401 | 403; error: string };

export type StudentAdditionStudentAccessResult =
  | {
      ok: true;
      permission: UserPermission;
      programId: typeof PROGRAM_IDS.NVS;
      school: { code: string; udise_code: string | null };
      actor: {
        user_id: number | null;
        email: string;
        login_type: "google";
        role: UserRole;
      };
    }
  | { ok: false; status: 401 | 403; error: string };

export type StudentProgramDropoutAccessResult =
  | {
      ok: true;
      permission: UserPermission;
      programId: number;
      school: { code: string; udise_code: string | null };
      actor: ReturnType<typeof studentWriteActor>;
    }
  | { ok: false; status: 401 | 403; error: string };

export type StudentEditAccessResult =
  | {
      ok: true;
      permission: UserPermission;
      programId: number;
      school: { code: string; udise_code: string | null };
      actor: ReturnType<typeof studentWriteActor>;
    }
  | { ok: false; status: 400 | 401 | 403; error: string };

interface StudentWriteScopeRow {
  code: string;
  udise_code: string | null;
  region: string | null;
  af_school_category: string | null;
  has_program_enrollment: boolean;
  centre_program_ids?: Array<number | string> | null;
}

function deny(
  status: 401 | 403,
  error = "Forbidden",
): { ok: false; status: 401 | 403; error: string } {
  return { ok: false, status, error };
}

function requireGoogleSessionEmail(session: StudentWriteSession | null) {
  if (!session) return deny(401, "Unauthorized");
  if (session.isPasscodeUser) return deny(403);

  const email = session.user?.email;
  return email ? { ok: true as const, email } : deny(403);
}

function studentWriteActor(permission: UserPermission, email: string) {
  return {
    user_id: permission.user_id ?? null,
    email,
    login_type: "google" as const,
    role: permission.role,
  };
}

function allowNvsStudentAccess(
  permission: UserPermission,
  email: string,
  scope: StudentWriteScopeRow,
): Extract<StudentAdditionStudentAccessResult, { ok: true }> {
  return {
    ok: true,
    permission,
    programId: PROGRAM_IDS.NVS,
    school: { code: scope.code, udise_code: scope.udise_code },
    actor: studentWriteActor(permission, email),
  };
}

function actorHasProgramAccess(permission: UserPermission, programId: number) {
  return getProgramContextSync(permission).programIds.includes(programId);
}

async function requireStudentWriteActor(session: StudentWriteSession | null) {
  const sessionEmail = requireGoogleSessionEmail(session);
  if (!sessionEmail.ok) return sessionEmail;

  const permission = await getResolvedPermission(sessionEmail.email);
  if (!permission) return deny(403);
  if (!ALLOWED_STUDENT_ADDITION_ROLES.has(permission.role)) return deny(403);
  if (!getFeatureAccess(permission, "students").canEdit) return deny(403);

  return { ok: true as const, email: sessionEmail.email, permission };
}

// Actor gate for editing an existing student's profile. Unlike the
// student-addition actor, this follows the permission matrix directly: any role
// with students=edit (teacher / program_manager / program_admin / admin, minus
// read_only) may edit. Passcode users are excluded (requireGoogleSessionEmail
// denies them). Program ownership is checked separately, per student.
async function requireStudentEditActor(session: StudentWriteSession | null) {
  const sessionEmail = requireGoogleSessionEmail(session);
  if (!sessionEmail.ok) return sessionEmail;

  const permission = await getResolvedPermission(sessionEmail.email);
  if (!permission) return deny(403);
  if (!getFeatureAccess(permission, "students").canEdit) return deny(403);

  return { ok: true as const, email: sessionEmail.email, permission };
}

async function hasSchoolAccess(
  permission: UserPermission,
  email: string,
  school: Pick<StudentWriteScopeRow, "code" | "region">,
) {
  if (canAccessSchoolSync(permission, school.code, school.region ?? undefined)) {
    return true;
  }

  return (
    permission.level === 2 &&
    (await canAccessSchool(email, school.code, school.region ?? undefined))
  );
}

async function getStudentProgramDropoutScope(
  studentPkId: number | string,
  programId: number,
) {
  const rows = await query<StudentWriteScopeRow>(
    `SELECT
       sch.code,
       sch.udise_code,
       sch.region,
       sch.af_school_category,
       COALESCE(
         ARRAY_AGG(DISTINCT c.program_id) FILTER (WHERE c.program_id IS NOT NULL),
         ARRAY[]::int[]
       ) AS centre_program_ids,
       EXISTS (
         SELECT 1 FROM enrollment_record er_batch
         JOIN batch b ON b.id = er_batch.group_id
         WHERE er_batch.user_id = s.user_id
           AND er_batch.group_type = 'batch'
           AND er_batch.is_current = true
           AND b.program_id = $2
       ) AS has_program_enrollment
     FROM student s
     JOIN enrollment_record er_school ON er_school.user_id = s.user_id
       AND er_school.group_type = 'school' AND er_school.is_current = true
     JOIN school sch ON sch.id = er_school.group_id
     LEFT JOIN centres c ON c.school_id = sch.id AND c.is_active = true
     WHERE s.id = $1
     GROUP BY sch.code, sch.udise_code, sch.region, sch.af_school_category, s.user_id`,
    [studentPkId, programId],
  );
  return rows.length === 1 ? rows[0] : null;
}

export async function requireStudentProgramDropoutAccess(
  session: StudentWriteSession | null,
  studentPkId: number | string,
  programId: number,
): Promise<StudentProgramDropoutAccessResult> {
  const actor = await requireStudentWriteActor(session);
  if (!actor.ok) return actor;

  const { email, permission } = actor;

  const scope = await getStudentProgramDropoutScope(studentPkId, programId);
  if (!scope) return deny(403);
  if (!(await hasSchoolAccess(permission, email, scope))) return deny(403);
  if (!(scope.centre_program_ids ?? []).map(Number).includes(programId)) return deny(403);
  if (!scope.has_program_enrollment) return deny(403);
  if (permission.role !== "admin" && !actorHasProgramAccess(permission, programId))
    return deny(403);

  return {
    ok: true,
    permission,
    programId,
    school: { code: scope.code, udise_code: scope.udise_code },
    actor: studentWriteActor(permission, email),
  };
}

export function getStudentAdditionAccessFromPermission(
  session: StudentWriteSession | null,
  school: StudentAdditionSchool,
  permission: UserPermission | null,
): StudentAdditionAccessResult {
  if (!session) return deny(401, "Unauthorized");
  if (session.isPasscodeUser) return deny(403);

  const email = session.user?.email;
  if (!email || !permission) return deny(403);
  if (school.af_school_category !== "JNV") return deny(403);
  if (!ALLOWED_STUDENT_ADDITION_ROLES.has(permission.role)) return deny(403);
  if (!canAccessSchoolSync(permission, school.code, school.region ?? undefined))
    return deny(403);
  if (!getFeatureAccess(permission, "students").canEdit) return deny(403);
  if (!getProgramContextSync(permission).programIds.includes(PROGRAM_IDS.NVS))
    return deny(403);

  return {
    ok: true,
    permission,
    programId: PROGRAM_IDS.NVS,
    actor: studentWriteActor(permission, email),
  };
}

export async function requireStudentAdditionAccess(
  session: StudentWriteSession | null,
  school: StudentAdditionSchool,
): Promise<StudentAdditionAccessResult> {
  const sessionEmail = requireGoogleSessionEmail(session);
  if (!sessionEmail.ok) return sessionEmail;

  const permission = await getResolvedPermission(sessionEmail.email);
  return getStudentAdditionAccessFromPermission(session, school, permission);
}

async function getStudentEditScope(
  studentPkId: number | string,
  programId: number,
) {
  const rows = await query<StudentWriteScopeRow>(
    `SELECT
       sch.code,
       sch.udise_code,
       sch.region,
       sch.af_school_category,
       EXISTS (
         SELECT 1
         FROM enrollment_record er_batch
         JOIN batch b ON b.id = er_batch.group_id
         WHERE er_batch.user_id = s.user_id
           AND er_batch.group_type = 'batch'
           AND er_batch.is_current = true
           AND b.program_id = $2
       ) AS has_program_enrollment
     FROM student s
     JOIN enrollment_record er_school ON er_school.user_id = s.user_id
       AND er_school.group_type = 'school'
       AND er_school.is_current = true
     JOIN school sch ON sch.id = er_school.group_id
     WHERE s.id = $1`,
    [studentPkId, programId],
  );
  return rows.length === 1 ? rows[0] : null;
}

async function getStudentDropoutUndoScope(studentPkId: number | string) {
  const rows = await query<StudentWriteScopeRow>(
    `SELECT
       sch.code,
       sch.udise_code,
       sch.region,
       sch.af_school_category,
       true AS has_program_enrollment
     FROM student s
     JOIN LATERAL (
       SELECT er.group_id
       FROM enrollment_record er
       WHERE er.user_id = s.user_id AND er.group_type = 'school'
       ORDER BY er.is_current DESC, er.updated_at DESC, er.id DESC
       LIMIT 1
     ) latest_school ON true
     JOIN school sch ON sch.id = latest_school.group_id
     WHERE s.id = $1
       AND EXISTS (
         SELECT 1
         FROM lms_student_write_audits dropout
         WHERE dropout.action = 'student_program_dropout'
           AND dropout.program_id = $2
           AND dropout.school_code = sch.code
           AND (dropout.affected_identifiers ->> 'student_pk_id')::bigint = s.id
           AND dropout.changed_values ? 'batch_enrollment_id'
           AND NOT EXISTS (
             SELECT 1
             FROM lms_student_write_audits undo
             WHERE undo.action = 'student_program_dropout_undo'
               AND (undo.affected_identifiers ->> 'dropout_audit_id')::bigint = dropout.id
           )
       )`,
    [studentPkId, PROGRAM_IDS.NVS],
  );
  return rows.length === 1 ? rows[0] : null;
}

// fallow-ignore-next-line complexity
export async function requireStudentAdditionStudentAccess(
  session: StudentWriteSession | null,
  studentPkId: number | string,
): Promise<StudentAdditionStudentAccessResult> {
  const actor = await requireStudentWriteActor(session);
  if (!actor.ok) return actor;

  const { email, permission } = actor;

  const scope = await getStudentEditScope(studentPkId, PROGRAM_IDS.NVS);
  if (!scope) return deny(403);
  if (scope.af_school_category !== "JNV") return deny(403);
  if (!(await hasSchoolAccess(permission, email, scope))) return deny(403);

  if (!scope.has_program_enrollment) return deny(403);
  if (!actorHasProgramAccess(permission, PROGRAM_IDS.NVS)) return deny(403);

  return allowNvsStudentAccess(permission, email, scope);
}

// General per-student profile edit access, authorized against the student's
// actual program (supplied by the caller from the enrollment view). Mirrors the
// program dropout model — school access + current enrollment in that program +
// program ownership (admin bypass) — but is NOT limited to NVS or JNV schools.
// Who may edit is the permission matrix (requireStudentEditActor); which
// programs they own gates the specific student.
export async function requireStudentEditAccess(
  session: StudentWriteSession | null,
  studentPkId: number | string,
  programId: number | null,
): Promise<StudentEditAccessResult> {
  const actor = await requireStudentEditActor(session);
  if (!actor.ok) return actor;

  const { email, permission } = actor;

  // Number.isInteger also rejects NaN and fractional values (e.g. "12.5" from
  // the request body), which would otherwise 500 on the SQL integer bind.
  if (programId == null || !Number.isInteger(programId)) {
    return { ok: false, status: 400, error: "Program is required" };
  }

  const scope = await getStudentEditScope(studentPkId, programId);
  if (!scope) return deny(403);
  if (!(await hasSchoolAccess(permission, email, scope))) return deny(403);
  if (!scope.has_program_enrollment) return deny(403);
  if (permission.role !== "admin" && !actorHasProgramAccess(permission, programId)) {
    return deny(403);
  }

  return {
    ok: true,
    permission,
    programId,
    school: { code: scope.code, udise_code: scope.udise_code },
    actor: studentWriteActor(permission, email),
  };
}

export async function requireStudentDropoutUndoAccess(
  session: StudentWriteSession | null,
  studentPkId: number | string,
): Promise<StudentAdditionStudentAccessResult> {
  const actor = await requireStudentWriteActor(session);
  if (!actor.ok) return actor;

  const { email, permission } = actor;
  const scope = await getStudentDropoutUndoScope(studentPkId);
  if (!scope || scope.af_school_category !== "JNV") return deny(403);
  if (!(await hasSchoolAccess(permission, email, scope))) return deny(403);
  if (!actorHasProgramAccess(permission, PROGRAM_IDS.NVS)) return deny(403);

  return allowNvsStudentAccess(permission, email, scope);
}
