import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { validateGpsReading } from "@/lib/geo-validation";
import { getFeatureAccess } from "@/lib/permissions";
import {
  apiError,
  buildOwnOrManagedVisitPredicate,
  buildVisitScopePredicate,
  canAccessVisitSchoolScope,
  canEditVisit,
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

  const whereClauses: string[] = ["v.deleted_at IS NULL"];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (actor.role === "program_manager") {
    // Own Visits plus every Visit at their visit-manager Centres' Schools (#291).
    const scope = buildOwnOrManagedVisitPredicate(actor, {
      startIndex: paramIndex,
      pmEmailColumn: "v.pm_email",
      schoolCodeColumn: "v.school_code",
    });
    whereClauses.push(scope.clause);
    params.push(...scope.params);
    paramIndex += scope.params.length;
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

  // pm_name resolves the visitor's display name from user_permission. The match
  // is case-insensitive, and user_permission.email is only unique case-sensitively,
  // so a scalar subquery (not a JOIN) keeps one row per visit if case variants of
  // an email exist; the active (non-revoked) row's name is preferred.
  let queryText = `
    SELECT v.id, v.school_code, s.name as school_name, v.pm_email,
           (SELECT up.full_name
              FROM user_permission up
             WHERE LOWER(up.email) = LOWER(v.pm_email)
               AND up.full_name IS NOT NULL
             ORDER BY (up.revoked_at IS NULL) DESC
             LIMIT 1) AS pm_name,
           v.visit_date, v.status,
           v.completed_at, v.inserted_at, v.updated_at,
           s.region AS school_region
    FROM lms_pm_school_visits v
    LEFT JOIN school s ON s.code = v.school_code
  `;
  if (whereClauses.length > 0) {
    queryText += ` WHERE ${whereClauses.join(" AND ")}`;
  }
  queryText += ` ORDER BY v.visit_date DESC, v.inserted_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const rows = await query<{
    pm_email: string;
    school_code: string;
    school_region: string | null;
  }>(queryText, params);

  // can_edit tells the list whether to offer Continue: a manager now sees other
  // people's Visits at their Centres (#291), which open read-only. Same verdict
  // as the Visit page: feature edit access AND the per-Visit edit policy.
  const featureCanEdit = getFeatureAccess(actor.permission, "visits").canEdit;
  const visits = rows.map(({ school_region, ...visit }) => ({
    ...visit,
    can_edit: featureCanEdit && canEditVisit(actor, {
      pmEmail: visit.pm_email,
      schoolCode: visit.school_code,
      schoolRegion: school_region,
    }),
  }));

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
