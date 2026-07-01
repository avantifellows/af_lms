import { PROGRAM_IDS } from "@/lib/constants";
import {
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

function deny(status: 401 | 403, error = "Forbidden"): StudentAdditionAccessResult {
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
