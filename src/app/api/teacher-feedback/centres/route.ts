import { NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/db";
import { getCentreConfinement } from "@/lib/permissions";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback, requireCentreScope } from "@/lib/teacher-feedback-access";

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

// GET /api/teacher-feedback/centres?school_code=XXXXX[&centre_id=N]
// The active centres at this school. A school can have multiple (CoE + Nodal);
// teachers map to a centre, not the school, so the PM picks a centre first.
//
// centre_id narrows the list to that one centre, for the centre page: a centre
// page shows only its own surfaces, so it must not list a sibling centre. Same
// school-level authorization either way (see D32) — this scopes the view, it is
// not an extra grant.
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

  const centreIdParam = request.nextUrl.searchParams.get("centre_id")?.trim();
  const centreId = centreIdParam ? Number(centreIdParam) : null;
  if (centreIdParam && !Number.isFinite(centreId)) {
    return NextResponse.json(
      { error: "centre_id must be a number" },
      { status: 400 }
    );
  }

  if (centreId !== null) {
    const centreScopeCheck = requireCentreScope(access.permission, centreId);
    if (!centreScopeCheck.ok) {
      return centreScopeCheck.response;
    }
  }

  // With no centre_id a confined caller would get every centre at the school,
  // which is the same sibling-centre exposure by omission. Fall back to their
  // seat centres rather than the school's.
  const confinement = getCentreConfinement(access.permission);
  const allowedCentreIds = confinement.confined ? confinement.centreIds : null;

  const rows = await query<CentreRow>(
    `SELECT id, name, type_code
     FROM centres
     WHERE school_id = $1 AND is_active = true
       AND ($2::bigint IS NULL OR id = $2::bigint)
       AND ($3::int[] IS NULL OR id = ANY($3::int[]))
     ORDER BY name`,
    [school.id, centreId, allowedCentreIds]
  );

  const centres: FeedbackCentre[] = rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    typeCode: r.type_code,
  }));

  return NextResponse.json({ centres });
}
