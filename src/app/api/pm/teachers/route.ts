import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { apiError, requireVisitsAccess, resolveAccessibleVisitSchoolRegion } from "@/lib/visits-policy";
import { getVisitTeachersForSchool } from "@/lib/visit-teachers";

// GET /api/pm/teachers?school_code=XXXXX
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

  const schoolAccess = await resolveAccessibleVisitSchoolRegion(access.actor, schoolCode);
  if (!schoolAccess.ok) {
    return schoolAccess.response;
  }

  const teachers = await getVisitTeachersForSchool(schoolCode);

  return NextResponse.json({ teachers });
}
