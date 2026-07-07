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

interface StudentWriteScopeRow {
  code: string;
  udise_code: string | null;
  region: string | null;
  centre_program_ids: Array<number | string> | null;
}

function deny(status: 401 | 403, error = "Forbidden"): { ok: false; status: 401 | 403; error: string } {
  return { ok: false, status, error };
}

function hasNvsCentreContext(school: StudentAdditionSchool) {
  return (school.centre_program_ids ?? []).map(Number).includes(PROGRAM_IDS.NVS);
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

function actorHasNvsProgramAccess(permission: UserPermission) {
  return permission.role === "admin" ||
    getProgramContextSync(permission).programIds.includes(PROGRAM_IDS.NVS);
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
  if (!hasNvsCentreContext(school)) return deny(403);
  if (!actorHasNvsProgramAccess(permission)) return deny(403);

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

async function getStudentWriteScope(studentPkId: number | string) {
  const rows = await query<StudentWriteScopeRow>(
    `SELECT
       sch.code,
       sch.udise_code,
       sch.region,
       COALESCE(
         ARRAY_AGG(DISTINCT c.program_id) FILTER (WHERE c.program_id IS NOT NULL),
         ARRAY[]::int[]
       ) AS centre_program_ids
     FROM student s
     JOIN group_user gu_sch ON gu_sch.user_id = s.user_id
     JOIN "group" g_sch ON g_sch.id = gu_sch.group_id AND g_sch.type = 'school'
     JOIN school sch ON sch.id = g_sch.child_id
     LEFT JOIN centres c ON c.school_id = sch.id AND c.is_active = true
     WHERE s.id = $1
     GROUP BY sch.code, sch.udise_code, sch.region
     LIMIT 1`,
    [studentPkId],
  );
  return rows[0] ?? null;
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

  const scope = await getStudentWriteScope(studentPkId);
  if (!scope) return deny(403);
  if (!canAccessSchoolSync(permission, scope.code, scope.region ?? undefined)) {
    if (permission.level !== 2 || !(await canAccessSchool(email, scope.code, scope.region ?? undefined))) {
      return deny(403);
    }
  }

  if (!hasNvsCentreContext(scope)) return deny(403);
  if (!actorHasNvsProgramAccess(permission)) return deny(403);

  return {
    ok: true,
    permission,
    programId: PROGRAM_IDS.NVS,
    school: { code: scope.code, udise_code: scope.udise_code },
    actor: studentAdditionActor(permission, email),
  };
}
