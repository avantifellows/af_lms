// The page gate shared by the Curriculum Summary and its chapter timeline (server-only): signed
// in, a program manager, program admin or Admin, with Curriculum view access and a CoE or Nodal
// Program. Anyone else is redirected; the APIs and SQL scope do the rest.

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import {
  getFeatureAccess,
  getProgramContextSync,
  getResolvedPermission,
  type UserPermission,
} from "@/lib/permissions";

const SUMMARY_ROLES = ["program_manager", "program_admin", "admin"];

function canViewCurriculumSummary(permission: UserPermission | null): permission is UserPermission {
  return (
    permission !== null &&
    SUMMARY_ROLES.includes(permission.role) &&
    getFeatureAccess(permission, "curriculum").canView &&
    getProgramContextSync(permission).hasCoEOrNodal
  );
}

export async function requireCurriculumSummaryViewer(): Promise<{
  email: string;
  permission: UserPermission;
}> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const permission = await getResolvedPermission(email);
  if (!canViewCurriculumSummary(permission)) redirect("/dashboard");
  return { email, permission };
}
