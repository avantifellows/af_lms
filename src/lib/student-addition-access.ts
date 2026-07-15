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

interface StudentAdditionSession {
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
      actor: ReturnType<typeof studentAdditionActor>;
    }
  | { ok: false; status: 401 | 403; error: string };

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

function requireGoogleSessionEmail(session: StudentAdditionSession | null) {
  if (!session) return deny(401, "Unauthorized");
  if (session.isPasscodeUser) return deny(403);

  const email = session.user?.email;
  return email ? { ok: true as const, email } : deny(403);
}

function studentAdditionActor(permission: UserPermission, email: string) {
  return {
    user_id: permission.user_id ?? null,
    email,
    login_type: "google" as const,
    role: permission.role,
  };
}

function actorHasProgramAccess(permission: UserPermission, programId: number) {
  return getProgramContextSync(permission).programIds.includes(programId);
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
  session: StudentAdditionSession | null,
  studentPkId: number | string,
  programId: number,
): Promise<StudentProgramDropoutAccessResult> {
  const sessionEmail = requireGoogleSessionEmail(session);
  if (!sessionEmail.ok) return sessionEmail;

  const { email } = sessionEmail;
  const permission = await getResolvedPermission(email);
  if (!permission) return deny(403);
  if (!ALLOWED_STUDENT_ADDITION_ROLES.has(permission.role)) return deny(403);
  if (!getFeatureAccess(permission, "students").canEdit) return deny(403);

  const scope = await getStudentProgramDropoutScope(studentPkId, programId);
  if (!scope) return deny(403);
  if (!canAccessSchoolSync(permission, scope.code, scope.region ?? undefined)) {
    if (
      permission.level !== 2 ||
      !(await canAccessSchool(email, scope.code, scope.region ?? undefined))
    ) return deny(403);
  }
  if (!(scope.centre_program_ids ?? []).map(Number).includes(programId)) return deny(403);
  if (!scope.has_program_enrollment) return deny(403);
  if (permission.role !== "admin" && !actorHasProgramAccess(permission, programId))
    return deny(403);

  return {
    ok: true,
    permission,
    programId,
    school: { code: scope.code, udise_code: scope.udise_code },
    actor: studentAdditionActor(permission, email),
  };
}

export function getStudentAdditionAccessFromPermission(
  session: StudentAdditionSession | null,
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
    actor: studentAdditionActor(permission, email),
  };
}

export async function requireStudentAdditionAccess(
  session: StudentAdditionSession | null,
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

// fallow-ignore-next-line complexity
export async function requireStudentAdditionStudentAccess(
  session: StudentAdditionSession | null,
  studentPkId: number | string,
): Promise<StudentAdditionStudentAccessResult> {
  const sessionEmail = requireGoogleSessionEmail(session);
  if (!sessionEmail.ok) return sessionEmail;

  const { email } = sessionEmail;
  const permission = await getResolvedPermission(email);
  if (!permission) return deny(403);
  if (!ALLOWED_STUDENT_ADDITION_ROLES.has(permission.role)) return deny(403);
  if (!getFeatureAccess(permission, "students").canEdit) return deny(403);

  const scope = await getStudentEditScope(studentPkId, PROGRAM_IDS.NVS);
  if (!scope) return deny(403);
  if (scope.af_school_category !== "JNV") return deny(403);
  if (!canAccessSchoolSync(permission, scope.code, scope.region ?? undefined)) {
    if (
      permission.level !== 2 ||
      !(await canAccessSchool(email, scope.code, scope.region ?? undefined))
    ) {
      return deny(403);
    }
  }

  if (!scope.has_program_enrollment) return deny(403);
  if (!actorHasProgramAccess(permission, PROGRAM_IDS.NVS)) return deny(403);

  return {
    ok: true,
    permission,
    programId: PROGRAM_IDS.NVS,
    school: { code: scope.code, udise_code: scope.udise_code },
    actor: studentAdditionActor(permission, email),
  };
}
