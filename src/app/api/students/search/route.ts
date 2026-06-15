import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAccessibleSchoolCodes } from "@/lib/permissions";
import { query } from "@/lib/db";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

interface StudentSearchResult {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  student_id: string | null;
  phone: string | null;
  school_name: string;
  school_code: string;
  grade: number | null;
}

// GET /api/students/search?q=searchterm
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const searchQuery = searchParams.get("q") || "";

  if (searchQuery.length < 2) {
    return NextResponse.json([]);
  }

  // Get accessible school codes for this user
  const schoolCodes = await getAccessibleSchoolCodes(session.user.email);

  if (schoolCodes.length === 0) {
    return NextResponse.json([]);
  }

  const searchPattern = `%${searchQuery}%`;

  let results: StudentSearchResult[];

  if (schoolCodes === "all") {
    // User has access to all schools
    results = await query<StudentSearchResult>(
      `SELECT DISTINCT
        u.id as user_id,
        u.first_name,
        u.last_name,
        u.phone,
        s.student_id,
        sch.name as school_name,
        sch.code as school_code,
        gr.number as grade
      FROM "user" u
      JOIN student s ON s.user_id = u.id
      JOIN group_user gu ON gu.user_id = u.id
      JOIN "group" g ON gu.group_id = g.id AND g.type = 'school'
      JOIN school sch ON g.child_id = sch.id
      -- Same current-cohort rule as the canonical school roster: only
      -- students enrolled for the current academic year. Passed-out cohorts
      -- keep is_current=true grade records forever, so the year filter is
      -- what excludes them. Grade comes from the enrollment record (the
      -- roster's source), not the stale student.grade_id column.
      JOIN enrollment_record er ON er.user_id = u.id
        AND er.group_type = 'grade'
        AND er.is_current = true
        AND er.academic_year = $2
      LEFT JOIN grade gr ON er.group_id = gr.id
      WHERE sch.af_school_category = 'JNV'
        AND (
          u.first_name ILIKE $1
          OR u.last_name ILIKE $1
          OR s.student_id ILIKE $1
          OR u.phone ILIKE $1
          OR s.apaar_id ILIKE $1
        )
      ORDER BY u.first_name, u.last_name
      LIMIT 20`,
      [searchPattern, CURRENT_ACADEMIC_YEAR]
    );
  } else {
    // User has access to specific schools only
    results = await query<StudentSearchResult>(
      `SELECT DISTINCT
        u.id as user_id,
        u.first_name,
        u.last_name,
        u.phone,
        s.student_id,
        sch.name as school_name,
        sch.code as school_code,
        gr.number as grade
      FROM "user" u
      JOIN student s ON s.user_id = u.id
      JOIN group_user gu ON gu.user_id = u.id
      JOIN "group" g ON gu.group_id = g.id AND g.type = 'school'
      JOIN school sch ON g.child_id = sch.id
      -- See the all-schools query above: current-cohort rule shared with the
      -- canonical school roster.
      JOIN enrollment_record er ON er.user_id = u.id
        AND er.group_type = 'grade'
        AND er.is_current = true
        AND er.academic_year = $3
      LEFT JOIN grade gr ON er.group_id = gr.id
      WHERE sch.code = ANY($1)
        AND sch.af_school_category = 'JNV'
        AND (
          u.first_name ILIKE $2
          OR u.last_name ILIKE $2
          OR s.student_id ILIKE $2
          OR u.phone ILIKE $2
          OR s.apaar_id ILIKE $2
        )
      ORDER BY u.first_name, u.last_name
      LIMIT 20`,
      [schoolCodes, searchPattern, CURRENT_ACADEMIC_YEAR]
    );
  }

  return NextResponse.json(results);
}
