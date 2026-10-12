import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  canAccessSchool,
  getFeatureAccess,
  getResolvedPermission,
  type UserPermission,
} from "@/lib/permissions";

// The one gate for every /api/alumni route: signed in, the `alumni` feature
// (edit for writes — read_only downgrades it to view), and — when the request
// is about a school — access to that school.

export type AlumniAuth =
  | { ok: true; email: string; permission: UserPermission }
  | { ok: false; response: NextResponse };

const deny = (status: 401 | 403, error: string): AlumniAuth => ({
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

  const permission = await getResolvedPermission(email);
  const access = getFeatureAccess(permission, "alumni");
  if (!permission || !access.canView) return deny(403, "Access denied");
  if (options.requireEdit && !access.canEdit) return deny(403, "Read-only access cannot save alumni");

  if (options.schoolCode !== undefined && !(await canAccessSchool(email, options.schoolCode))) {
    return deny(403, "Access denied");
  }
  return { ok: true, email, permission };
}
