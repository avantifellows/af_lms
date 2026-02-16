import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserPermission, getFeatureAccess, canAccessSchoolSync } from "@/lib/permissions";
import { query } from "@/lib/db";
import { validateGpsReading } from "@/lib/geo-validation";

// GET /api/pm/visits - List visits for current PM
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permission = await getUserPermission(session.user.email);
  if (!getFeatureAccess(permission, "visits").canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const schoolCode = searchParams.get("school_code");
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  let queryText = `
    SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status,
           v.data, v.inserted_at, v.updated_at, v.ended_at,
           s.name as school_name
    FROM lms_pm_school_visits v
    LEFT JOIN school s ON s.code = v.school_code
    WHERE v.pm_email = $1
  `;
  const params: (string | number)[] = [session.user.email];
  let paramIndex = 2;

  if (schoolCode) {
    queryText += ` AND v.school_code = $${paramIndex}`;
    params.push(schoolCode);
    paramIndex++;
  }

  if (status) {
    queryText += ` AND v.status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  queryText += ` ORDER BY v.visit_date DESC, v.inserted_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const visits = await query(queryText, params);

  return NextResponse.json({ visits });
}

// POST /api/pm/visits - Create a new visit with GPS
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permission = await getUserPermission(session.user.email);
  if (!getFeatureAccess(permission, "visits").canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { school_code } = body;

  if (!school_code) {
    return NextResponse.json(
      { error: "school_code is required" },
      { status: 400 }
    );
  }

  // Validate GPS reading
  const gps = validateGpsReading(body, "start");
  if (!gps.valid) {
    return NextResponse.json({ error: gps.error }, { status: 400 });
  }

  // Verify PM has access to this school using already-fetched permission
  if (!permission) {
    return NextResponse.json({ error: "No permission record" }, { status: 403 });
  }

  // Fetch region only when needed for level 2 access check
  let schoolRegion: string | undefined;
  if (permission.level === 2) {
    const schoolResult = await query<{ region: string }>(
      `SELECT region FROM school WHERE code = $1`,
      [school_code]
    );
    if (schoolResult.length === 0) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }
    schoolRegion = schoolResult[0].region;
  }

  if (!canAccessSchoolSync(permission, school_code, schoolRegion)) {
    return NextResponse.json(
      { error: "You do not have access to this school" },
      { status: 403 }
    );
  }

  // Create initial empty visit data structure
  const initialData = {
    principalMeeting: null,
    leadershipMeetings: null,
    classroomObservations: [],
    studentDiscussions: {
      groupDiscussions: [],
      individualDiscussions: [],
    },
    staffMeetings: {
      individualMeetings: [],
      teamMeeting: null,
    },
    teacherFeedback: [],
    issueLog: [],
  };

  // visit_date derived server-side as IST date; start GPS stored in dedicated columns
  const result = await query<{ id: number; visit_date: string }>(
    `INSERT INTO lms_pm_school_visits
       (school_code, pm_email, visit_date, status, data,
        start_lat, start_lng, start_accuracy)
     VALUES (
       $1, $2,
       (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
       'in_progress', $3,
       $4, $5, $6
     )
     RETURNING id, visit_date`,
    [
      school_code,
      session.user.email,
      JSON.stringify(initialData),
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
