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
  program_ids?: number[] | null;
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

interface StudentWriteScopeRow {
  code: string;
  udise_code: string | null;
  region: string | null;
  program_ids: number[] | null;
  student_program_ids: Array<number | string> | null;
}

function deny(status: 401 | 403, error = "Forbidden"): { ok: false; status: 401 | 403; error: string } {
  return { ok: false, status, error };
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
  if (!ALLOWED_STUDENT_ADDITION_ROLES.has(permission.role)) return deny(403);
  if (!canAccessSchoolSync(permission, school.code, school.region ?? undefined)) return deny(403);
  if (!getFeatureAccess(permission, "students").canEdit) return deny(403);
  if (!(school.program_ids ?? []).includes(PROGRAM_IDS.NVS)) return deny(403);
  if (!getProgramContextSync(permission).programIds.includes(PROGRAM_IDS.NVS)) return deny(403);

  return {
    ok: true,
    permission,
    programId: PROGRAM_IDS.NVS,
    actor: {
      user_id: permission.user_id ?? null,
      email,
      login_type: "google",
      role: permission.role,
    },
  };
}

export async function requireStudentAdditionAccess(
  session: StudentAdditionSession | null,
  school: StudentAdditionSchool,
): Promise<StudentAdditionAccessResult> {
  if (!session) return deny(401, "Unauthorized");
  if (session.isPasscodeUser) return deny(403);

  const email = session.user?.email;
  if (!email) return deny(403);

  const permission = await getResolvedPermission(email);
  return getStudentAdditionAccessFromPermission(session, school, permission);
}

async function getStudentWriteScope(studentPkId: number | string) {
  const rows = await query<StudentWriteScopeRow>(
    `SELECT
       sch.code,
       sch.udise_code,
       sch.region,
       sch.program_ids,
       COALESCE(
         ARRAY_AGG(DISTINCT b.program_id) FILTER (WHERE b.program_id IS NOT NULL),
         ARRAY[]::int[]
       ) AS student_program_ids
     FROM student s
     JOIN group_user gu_sch ON gu_sch.user_id = s.user_id
     JOIN "group" g_sch ON g_sch.id = gu_sch.group_id AND g_sch.type = 'school'
     JOIN school sch ON sch.id = g_sch.child_id
     LEFT JOIN enrollment_record er_batch
       ON er_batch.user_id = s.user_id
       AND er_batch.group_type = 'batch'
       AND er_batch.is_current = true
     LEFT JOIN "group" g_batch ON g_batch.id = er_batch.group_id AND g_batch.type = 'batch'
     LEFT JOIN batch b ON b.id = g_batch.child_id
     WHERE s.id = $1
     GROUP BY sch.code, sch.udise_code, sch.region, sch.program_ids
     LIMIT 1`,
    [studentPkId],
  );
  return rows[0] ?? null;
}

export async function requireStudentAdditionStudentAccess(
  session: StudentAdditionSession | null,
  studentPkId: number | string,
): Promise<StudentAdditionStudentAccessResult> {
  if (!session) return deny(401, "Unauthorized");
  if (session.isPasscodeUser) return deny(403);

  const email = session.user?.email;
  if (!email) return deny(403);

  const permission = await getResolvedPermission(email);
  if (!permission) return deny(403);
  if (!ALLOWED_STUDENT_ADDITION_ROLES.has(permission.role)) return deny(403);
  if (!getFeatureAccess(permission, "students").canEdit) return deny(403);

  const scope = await getStudentWriteScope(studentPkId);
  if (!scope) return deny(403);
  if (!canAccessSchoolSync(permission, scope.code, scope.region ?? undefined)) {
    if (permission.level !== 2 || !(await canAccessSchool(email, scope.code, scope.region ?? undefined))) {
      return deny(403);
    }
  }

  const studentProgramIds = (scope.student_program_ids ?? []).map(Number);
  if (studentProgramIds.length > 0 && !studentProgramIds.includes(PROGRAM_IDS.NVS)) {
    return deny(403);
  }
  if (!(scope.program_ids ?? []).includes(PROGRAM_IDS.NVS)) return deny(403);
  if (!getProgramContextSync(permission).programIds.includes(PROGRAM_IDS.NVS)) return deny(403);

  return {
    ok: true,
    permission,
    programId: PROGRAM_IDS.NVS,
    school: { code: scope.code, udise_code: scope.udise_code },
    actor: {
      user_id: permission.user_id ?? null,
      email,
      login_type: "google",
      role: permission.role,
    },
  };
}
