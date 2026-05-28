import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  getAccessibleSchoolCodes,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import AcademicMentorshipAdmin from "./AcademicMentorshipAdmin";

interface SchoolOption {
  code: string;
  name: string;
}

async function getSchoolsForAdminPage(
  email: string,
  permission: NonNullable<Awaited<ReturnType<typeof getUserPermission>>>
): Promise<SchoolOption[]> {
  const accessibleSchoolCodes = await getAccessibleSchoolCodes(email, permission);

  if (accessibleSchoolCodes === "all") {
    return query<SchoolOption>(
      `SELECT code, name
       FROM school
       WHERE af_school_category = 'JNV'
       ORDER BY name`
    );
  }

  if (accessibleSchoolCodes.length === 0) return [];

  return query<SchoolOption>(
    `SELECT code, name
     FROM school
     WHERE code = ANY($1)
     ORDER BY name`,
    [accessibleSchoolCodes]
  );
}

export default async function AcademicMentorshipAdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const permission = await getUserPermission(session.user.email);
  const featureAccess = getFeatureAccess(permission, "academic_mentorship");
  if (!permission || !featureAccess.canView) {
    redirect("/dashboard");
  }

  const schools = await getSchoolsForAdminPage(session.user.email, permission);

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-text-muted hover:text-text-primary p-1 -m-1">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">
                Academic Mentorship
              </h1>
              <p className="text-xs text-text-muted">Manage mentor-mentee mappings</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-text-muted font-mono hidden sm:inline">
              {session.user.email}
            </span>
            <Link href="/api/auth/signout" className="text-sm font-bold text-danger hover:text-danger/80">
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <AcademicMentorshipAdmin
          schools={schools}
          canView={featureAccess.canView}
          canEdit={featureAccess.canEdit}
          role={permission.role}
        />
      </main>
    </div>
  );
}
