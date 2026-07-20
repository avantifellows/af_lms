import { NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/db";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";

interface FeedbackCentre {
  id: number;
  name: string;
  typeCode: string | null;
}

interface CentreRow {
  // centres.id is a bigint — node-pg returns it as a string, so coerce on read.
  id: number | string;
  name: string;
  type_code: string | null;
}

// GET /api/teacher-feedback/centres?school_code=XXXXX
// The active centres at this school. A school can have multiple (CoE + Nodal);
// teachers map to a centre, not the school, so the PM picks a centre first.
export async function GET(request: NextRequest) {
  const access = await authenticateTeacherFeedback("edit");
  if (!access.ok) {
    return access.response;
  }

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) {
    return NextResponse.json(
      { error: "school_code query parameter is required" },
      { status: 400 }
    );
  }

  const schoolRows = await query<{ id: number }>(
    `SELECT id FROM school WHERE code = $1 LIMIT 1`,
    [schoolCode]
  );
  const school = schoolRows[0];
  if (!school) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }
  if (!(await canAccessQuizSessionSchool(access.permission, school.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await query<CentreRow>(
    `SELECT id, name, type_code
     FROM centres
     WHERE school_id = $1 AND is_active = true
     ORDER BY name`,
    [school.id]
  );

  const centres: FeedbackCentre[] = rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    typeCode: r.type_code,
  }));

  return NextResponse.json({ centres });
}
