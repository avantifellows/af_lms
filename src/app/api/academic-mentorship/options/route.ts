import { NextRequest, NextResponse } from "next/server";

import {
  listAcademicMentorshipMenteeOptions,
  listAcademicMentorshipMentorOptions,
} from "@/lib/academic-mentorship";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import {
  academicMentorshipError,
  getAcademicMentorshipSession,
  parseAcademicYear,
  parseSchoolCode,
  requireAcademicMentorshipRouteAccess,
} from "../route-helpers";

export async function GET(request: NextRequest) {
  const session = await getAcademicMentorshipSession();
  if (!session.ok) return session.response;

  const type = request.nextUrl.searchParams.get("type")?.trim();
  if (type !== "mentors" && type !== "mentees") {
    return academicMentorshipError("type must be mentors or mentees", 400);
  }

  const schoolCode = parseSchoolCode(
    request.nextUrl.searchParams.get("school_code"),
    "school_code query parameter is required"
  );
  if (!schoolCode.ok) return schoolCode.response;

  const access = await requireAcademicMentorshipRouteAccess(
    session.value,
    "edit",
    schoolCode.value
  );
  if (!access.ok) return access.response;

  const search = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (type === "mentors") {
    const options = await listAcademicMentorshipMentorOptions({
      schoolId: access.value.school!.id,
      schoolCode: access.value.school!.code,
      schoolRegion: access.value.school!.region,
      search,
    });
    return NextResponse.json({ options });
  }

  const academicYear = parseAcademicYear(
    request.nextUrl.searchParams.get("academic_year"),
    { defaultAcademicYear: CURRENT_ACADEMIC_YEAR }
  );
  if (!academicYear.ok) return academicYear.response;

  const options = await listAcademicMentorshipMenteeOptions({
    schoolId: access.value.school!.id,
    academicYear: academicYear.value,
    search,
  });
  return NextResponse.json({ options });
}
