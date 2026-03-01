import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError, requireVisitsAccess } from "@/lib/visits-policy";

interface TeacherRow {
  id: number;
  email: string;
  full_name: string | null;
}

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

  // Find the school's region so we can include region-level teachers
  const schoolRows = await query<{ region: string | null }>(
    `SELECT region FROM school WHERE code = $1`,
    [schoolCode]
  );
  const schoolRegion = schoolRows[0]?.region ?? null;

  // Match teachers who either:
  // 1. Have this school_code in their school_codes array (level 1), OR
  // 2. Have the school's region in their regions array (level 2), OR
  // 3. Have level 3 (all-schools access)
  const teachers = await query<TeacherRow>(
    `SELECT id, email, full_name
     FROM user_permission
     WHERE role = 'teacher'
       AND (
         school_codes @> ARRAY[$1]::TEXT[]
         OR ($2::TEXT IS NOT NULL AND regions @> ARRAY[$2]::TEXT[])
         OR level = 3
       )
     ORDER BY full_name NULLS LAST, email`,
    [schoolCode, schoolRegion]
  );

  return NextResponse.json({ teachers });
}
