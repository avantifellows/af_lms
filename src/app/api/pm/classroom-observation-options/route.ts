import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getClassroomObservationCurriculumOptions,
  isClassroomObservationGrade,
} from "@/lib/classroom-observation-curriculum";
import { apiError, requireVisitsAccess, resolveAccessibleVisitSchoolRegion } from "@/lib/visits-policy";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireVisitsAccess(session, "view");
  if (!access.ok) {
    return access.response;
  }

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) {
    return apiError(400, "school_code query parameter is required");
  }

  const grade = Number.parseInt(request.nextUrl.searchParams.get("grade") || "", 10);
  if (!Number.isFinite(grade) || !isClassroomObservationGrade(grade)) {
    return apiError(400, "grade must be one of: 10, 11, 12");
  }

  const schoolAccess = await resolveAccessibleVisitSchoolRegion(access.actor, schoolCode);
  if (!schoolAccess.ok) {
    return schoolAccess.response;
  }

  const options = await getClassroomObservationCurriculumOptions({ grade });
  return NextResponse.json(options);
}
