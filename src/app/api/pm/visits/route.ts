import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { validateGpsReading } from "@/lib/geo-validation";
import {
  apiError,
  buildVisitScopePredicate,
  canAccessVisitSchoolScope,
  isScopedVisitsRole,
  parseJsonBody,
  requireVisitsAccess,
  resolveSchoolRegionForScope,
} from "@/lib/visits-policy";

// GET /api/pm/visits - List visits in actor scope
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireVisitsAccess(session, "view");
  if (!access.ok) {
    return access.response;
  }
  const { actor } = access;

  const searchParams = request.nextUrl.searchParams;
  const schoolCode = searchParams.get("school_code")?.trim() || "";
  const status = searchParams.get("status")?.trim() || "";
  const pmEmail = searchParams.get("pm_email")?.trim() || "";
  const parsedLimit = Number.parseInt(searchParams.get("limit") || "50", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;

  if (pmEmail && actor.role === "program_manager") {
    return apiError(403, "Forbidden");
  }

  const whereClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (actor.role === "program_manager") {
    whereClauses.push(`LOWER(v.pm_email) = LOWER($${paramIndex})`);
    params.push(actor.email);
    paramIndex++;
  } else if (pmEmail) {
    whereClauses.push(`LOWER(v.pm_email) = LOWER($${paramIndex})`);
    params.push(pmEmail);
    paramIndex++;
  }

  if (schoolCode) {
    whereClauses.push(`v.school_code = $${paramIndex}`);
    params.push(schoolCode);
    paramIndex++;
  }

  if (status) {
    whereClauses.push(`v.status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (isScopedVisitsRole(actor)) {
    const scope = buildVisitScopePredicate(actor, {
      startIndex: paramIndex,
      schoolCodeColumn: "v.school_code",
      schoolRegionColumn: "s.region",
    });
    if (scope.clause) {
      whereClauses.push(scope.clause);
      params.push(...scope.params);
      paramIndex += scope.params.length;
    }
  }

  let queryText = `
    SELECT v.id, v.school_code, s.name as school_name, v.pm_email, v.visit_date, v.status,
           v.completed_at, v.inserted_at, v.updated_at
    FROM lms_pm_school_visits v
    LEFT JOIN school s ON s.code = v.school_code
  `;
  if (whereClauses.length > 0) {
    queryText += ` WHERE ${whereClauses.join(" AND ")}`;
  }
  queryText += ` ORDER BY v.visit_date DESC, v.inserted_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const visits = await query(queryText, params);

  return NextResponse.json({ visits });
}

// POST /api/pm/visits - Create a new visit with GPS
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireVisitsAccess(session, "edit");
  if (!access.ok) {
    return access.response;
  }
  const { actor } = access;

  const bodyResult = await parseJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }
  const body = bodyResult.body;
  const schoolCode = typeof body.school_code === "string" ? body.school_code.trim() : "";

  if (!schoolCode) {
    return apiError(400, "school_code is required");
  }

  // Validate GPS reading
  const gps = validateGpsReading(body, "start");
  if (!gps.valid) {
    return apiError(422, gps.error || "Invalid GPS reading");
  }

  // Fetch region only when needed for level 2 access check
  const schoolScope = await resolveSchoolRegionForScope(actor.permission, schoolCode);
  if (!schoolScope.exists) {
    return apiError(404, "School not found");
  }
  const schoolRegion = schoolScope.schoolRegion;

  if (!canAccessVisitSchoolScope(actor, schoolCode, schoolRegion)) {
    return apiError(403, "Forbidden");
  }

  // visit_date derived server-side as IST date; start GPS stored in dedicated columns
  const result = await query<{ id: number; visit_date: string }>(
    `INSERT INTO lms_pm_school_visits
       (school_code, pm_email, visit_date, status,
        start_lat, start_lng, start_accuracy)
     VALUES (
       $1, $2,
       (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
       'in_progress',
       $3, $4, $5
     )
     RETURNING id, visit_date`,
    [
      schoolCode,
      actor.email,
      gps.reading!.lat,
      gps.reading!.lng,
      gps.reading!.accuracy,
    ]
  );

  const response: { id: number; visit_date: string; warning?: string } = {
    id: result[0].id,
    visit_date: result[0].visit_date,
  };
  if (gps.warning) {
    response.warning = gps.warning;
  }

  return NextResponse.json(response, { status: 201 });
}
