import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  isValidAcademicYear,
  listAcademicMentorshipMenteeOptions,
  listAcademicMentorshipMentorOptions,
  requireAcademicMentorshipAccess,
} from "@/lib/academic-mentorship";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get("type")?.trim();
  if (type !== "mentors" && type !== "mentees") {
    return NextResponse.json(
      { error: "type must be mentors or mentees" },
      { status: 400 }
    );
  }

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) {
    return NextResponse.json(
      { error: "school_code query parameter is required" },
      { status: 400 }
    );
  }

  const access = await requireAcademicMentorshipAccess(session, "view", {
    schoolCode,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const search = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (type === "mentors") {
    const options = await listAcademicMentorshipMentorOptions({
      schoolId: access.school!.id,
      schoolCode: access.school!.code,
      schoolRegion: access.school!.region,
      search,
    });
    return NextResponse.json({ options });
  }

  const academicYear =
    request.nextUrl.searchParams.get("academic_year")?.trim() || CURRENT_ACADEMIC_YEAR;
  if (!isValidAcademicYear(academicYear)) {
    return NextResponse.json(
      { error: "academic_year must use YYYY-YYYY format" },
      { status: 400 }
    );
  }

  const options = await listAcademicMentorshipMenteeOptions({
    schoolId: access.school!.id,
    academicYear,
    search,
  });
  return NextResponse.json({ options });
}
