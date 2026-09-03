import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getAccessibleSchoolCodes,
  getCentreConfinement,
  getResolvedPermission,
} from "@/lib/permissions";
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

  const permission = await getResolvedPermission(session.user.email);

  // Get accessible school codes for this user
  const schoolCodes = await getAccessibleSchoolCodes(session.user.email, permission);

  if (schoolCodes.length === 0) {
    return NextResponse.json([]);
  }

  // A centre-confined user's seat grants school access so school-linked actions
  // (visits) work, which used to make every student at the parent school
  // searchable — name, student id, grade and phone for students outside their
  // centre. Confinement has to hold on the server: the caller passes no scope,
  // so hiding the search UI would leave this endpoint answering in full.
  const confinement = getCentreConfinement(permission);

  const searchPattern = `%${searchQuery}%`;

  // School visibility scope: the historical JNV set PLUS any school linked to an
  // active centre. Mirrors the dashboard `schoolScope` / school-page predicate so
  // the non-JNV centre schools (Punjab CoE / EMRS) those pages now surface are
  // also searchable here — otherwise their students are silently filtered out.
  // (One shared const across all call sites is the better home — deferred.)
  const schoolScope = `(
        sch.af_school_category = 'JNV'
        OR EXISTS (SELECT 1 FROM centres c WHERE c.school_id = sch.id AND c.is_active)
      )`;

  // $1 search pattern, $2 academic year; the scope predicate below appends its
  // own. Only these composed fragments are constant SQL — every value stays a
  // bound parameter.
  const params: unknown[] = [searchPattern, CURRENT_ACADEMIC_YEAR];
  let scopeJoin = "";
  const scopeConditions = [schoolScope];

  if (confinement.confined) {
    // centre_students is the membership source of truth this task added, and the
    // same one the centre roster page reads — so search results and the roster a
    // confined user can actually open cannot disagree.
    params.push(confinement.centreIds);
    scopeJoin = `JOIN centre_students cs ON cs.user_id = u.id
        AND cs.academic_year = $2
        AND cs.centre_id = ANY($${params.length}::int[])`;
  } else if (schoolCodes !== "all") {
    params.push(schoolCodes);
    scopeConditions.push(`sch.code = ANY($${params.length})`);
  }

  const results = await query<StudentSearchResult>(
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
      ${scopeJoin}
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
      WHERE ${scopeConditions.join("\n        AND ")}
        AND (
          u.first_name ILIKE $1
          OR u.last_name ILIKE $1
          OR s.student_id ILIKE $1
          OR u.phone ILIKE $1
          OR s.apaar_id ILIKE $1
        )
      ORDER BY u.first_name, u.last_name
      LIMIT 20`,
    params
  );

  return NextResponse.json(results);
}
