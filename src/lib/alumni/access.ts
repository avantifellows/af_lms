import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  canAccessAlumni,
  canAccessSchoolSync,
  getAlumniPermission,
  getFeatureAccess,
  type UserPermission,
} from "@/lib/permissions";

// The gate for /api/alumni routes that aren't about one existing alumnus
// (those use canAccessAlumni): signed in, the `alumni` feature (edit for
// writes — read_only downgrades it to view), and — when the request is about a
// school — that school in scope. Reads the permission through
// getAlumniPermission, because the Student/School gates refuse alumni roles by
// design (ADR 0008).

export type AlumniAuth =
  | { ok: true; email: string; permission: UserPermission }
  | { ok: false; response: NextResponse };

const deny = (status: 401 | 403, error: string): Extract<AlumniAuth, { ok: false }> => ({
  ok: false,
  response: NextResponse.json({ error }, { status }),
});

export async function authorizeAlumni(options: {
  schoolCode?: string;
  requireEdit?: boolean;
} = {}): Promise<AlumniAuth> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!session || !email) return deny(401, "Unauthorized");

  const permission = await getAlumniPermission(email);
  const access = getFeatureAccess(permission, "alumni");
  if (!permission || !access.canView) return deny(403, "Access denied");
  if (options.requireEdit && !access.canEdit) return deny(403, "Read-only access cannot save alumni");

  if (options.schoolCode !== undefined && !(await reachesSchool(permission, options.schoolCode))) {
    return deny(403, "Access denied");
  }
  return { ok: true, email, permission };
}

/**
 * The gate for routes about one existing alumnus (by alumni.id): signed in,
 * a valid id, and canAccessAlumni — never canAccessStudent (ADR 0008).
 */
export async function authorizeAlumnus(
  alumniId: string,
  requireEdit: boolean,
): Promise<{ ok: true; email: string; role: string } | { ok: false; response: NextResponse }> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!session || !email) return deny(401, "Unauthorized");
  if (!/^\d+$/.test(alumniId)) return { ok: false, response: NextResponse.json({ error: "Invalid alumnus." }, { status: 400 }) };
  if (!(await canAccessAlumni(session, alumniId, { requireEdit }))) return deny(403, "Access denied");
  // Who is acting, for the alumni history (actor_role).
  const role = requireEdit ? (await getAlumniPermission(email))?.role ?? "" : "";
  return { ok: true, email, role };
}

/** Is this school in the person's alumni scope? Region users need the school's region. */
export async function reachesSchool(permission: UserPermission, schoolCode: string): Promise<boolean> {
  let region: string | undefined;
  if (permission.level === 2) {
    const [school] = await query<{ region: string | null }>(`SELECT region FROM school WHERE code = $1`, [schoolCode]);
    region = school?.region ?? undefined;
  }
  return canAccessSchoolSync(permission, schoolCode, region);
}
