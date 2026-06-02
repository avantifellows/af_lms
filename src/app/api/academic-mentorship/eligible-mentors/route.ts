import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  canAccessSchool,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import type { TeacherMentorRow } from "@/lib/mentorship-helpers";

function apiError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function actorIsPasscodeUser(session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  return Boolean((session as { isPasscodeUser?: boolean } | null)?.isPasscodeUser);
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return apiError(401, "Unauthorized");
  }

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) {
    return apiError(400, "school_code is required");
  }

  const permission = await getUserPermission(session.user.email);
  const access = getFeatureAccess(permission, "academic_mentorship", {
    isPasscodeUser: actorIsPasscodeUser(session),
  });
  if (!permission || !access.canEdit) {
    return apiError(403, "Forbidden");
  }

  if (!(await canAccessSchool(session.user.email, schoolCode))) {
    return apiError(403, "Forbidden");
  }

  const mentors = await query<TeacherMentorRow>(
    `SELECT id, email, full_name
     FROM user_permission
     WHERE role = 'teacher'
       AND level = 1
       AND cardinality(school_codes) = 1
       AND school_codes @> ARRAY[$1]::text[]
     ORDER BY COALESCE(NULLIF(TRIM(full_name), ''), email)`,
    [schoolCode]
  );

  return NextResponse.json({ mentors });
}
