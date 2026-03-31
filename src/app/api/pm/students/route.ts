import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError, canAccessVisitSchoolScope, requireVisitsAccess } from "@/lib/visits-policy";

interface StudentRow {
  id: number;
  full_name: string | null;
  student_id: string | null;
  grade: number | null;
}

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

  // Query students via join chain: group_user → group(school) → user → student → enrollment_record → grade
  const students = await query<StudentRow>(
    `SELECT DISTINCT u.id,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS full_name,
            s.student_id,
            gr.number AS grade
     FROM group_user gu
     JOIN "group" g ON g.id = gu.group_id AND g.type = 'school'
     JOIN "user" u ON gu.user_id = u.id
     LEFT JOIN student s ON s.user_id = u.id
     LEFT JOIN enrollment_record er ON er.user_id = u.id
       AND er.group_type = 'grade'
       AND er.is_current = true
     LEFT JOIN grade gr ON er.group_id = gr.id
     WHERE g.child_id = $1
       AND ($2::INT IS NULL OR gr.number = $2)
       AND (s.status IS NULL OR s.status != 'dropout')
     ORDER BY gr.number NULLS LAST, full_name NULLS LAST`,
    [school.id, grade]
  );

  return NextResponse.json({ students });
}
