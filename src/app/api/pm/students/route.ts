import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  getSchoolRoster,
  filterActiveRosterStudents,
} from "@/lib/school-students";
import { apiError, canAccessVisitSchoolScope, requireVisitsAccess } from "@/lib/visits-policy";

// GET /api/pm/students?school_code=XXXXX&grade=11
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

  const gradeParam = request.nextUrl.searchParams.get("grade");
  const grade = gradeParam ? Number(gradeParam) : null;
  if (grade !== null && (!Number.isInteger(grade) || grade < 1)) {
    return apiError(400, "grade must be a positive integer");
  }

  // Resolve school_code → school.id + region
  const schoolRows = await query<{ id: number; region: string | null }>(
    `SELECT id, region FROM school WHERE code = $1`,
    [schoolCode]
  );
  if (schoolRows.length === 0) {
    return apiError(404, "School not found");
  }
  const school = schoolRows[0];

  if (!canAccessVisitSchoolScope(access.actor, schoolCode, school.region)) {
    return apiError(403, "Forbidden");
  }

  // Canonical roster (the exact list the Enrollment tab shows) narrowed to
  // active students of the requested grade. The roster's academic-year filter
  // is what keeps passed-out cohorts — whose grade enrollment records stay
  // is_current forever — out of the visit form's student picker.
  const { students: roster } = await getSchoolRoster(school.id);
  const students = filterActiveRosterStudents(
    roster,
    grade !== null ? { grade } : {}
  )
    .map((s) => {
      const fullName = [s.first_name, s.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
      return {
        id: s.user_id,
        full_name: fullName || null,
        student_id: s.student_id,
        grade: s.grade,
      };
    })
    .sort(
      (a, b) =>
        (a.grade ?? Number.MAX_SAFE_INTEGER) -
          (b.grade ?? Number.MAX_SAFE_INTEGER) ||
        (a.full_name ?? "").localeCompare(b.full_name ?? "")
    );

  return NextResponse.json({ students });
}
