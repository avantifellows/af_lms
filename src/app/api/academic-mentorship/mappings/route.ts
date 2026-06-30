import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  isAcademicMentorshipEditableYear,
  isValidAcademicYear,
  listAcademicMentorshipMappings,
  requireAcademicMentorshipAccess,
} from "@/lib/academic-mentorship";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.isPasscodeUser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) {
    return NextResponse.json(
      { error: "school_code query parameter is required" },
      { status: 400 }
    );
  }
  const academicYear =
    request.nextUrl.searchParams.get("academic_year")?.trim() || CURRENT_ACADEMIC_YEAR;
  if (!isValidAcademicYear(academicYear)) {
    return NextResponse.json(
      { error: "academic_year must use YYYY-YYYY format" },
      { status: 400 }
    );
  }

  const access = await requireAcademicMentorshipAccess(session, "view", {
    schoolCode,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const includeHistory = request.nextUrl.searchParams.get("include_history") === "true";
  const groups = await listAcademicMentorshipMappings({
    schoolId: access.school!.id,
    academicYear,
    includeHistory,
  });

  return NextResponse.json({
    school: access.school,
    academicYear,
    includeHistory,
    canEdit: access.canEdit && isAcademicMentorshipEditableYear(academicYear),
    groups,
  });
}
