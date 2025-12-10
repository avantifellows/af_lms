import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessPMFeatures, canAccessSchool, getUserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET /api/pm/visits - List visits for current PM
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canAccess = await canAccessPMFeatures(session.user.email);
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const schoolCode = searchParams.get("school_code");
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  let queryText = `
    SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status,
           v.data, v.created_at, v.updated_at,
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

  queryText += ` ORDER BY v.visit_date DESC, v.created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const visits = await query(queryText, params);

  return NextResponse.json({ visits });
}

// POST /api/pm/visits - Create a new visit
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canAccess = await canAccessPMFeatures(session.user.email);
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { school_code, visit_date } = body;

  if (!school_code || !visit_date) {
    return NextResponse.json(
      { error: "school_code and visit_date are required" },
      { status: 400 }
    );
  }

  // Verify PM has access to this school
  const permission = await getUserPermission(session.user.email);
  if (!permission) {
    return NextResponse.json({ error: "No permission record" }, { status: 403 });
  }

  // Get school region for access check
  const schoolResult = await query<{ region: string }>(
    `SELECT region FROM school WHERE code = $1`,
    [school_code]
  );

  if (schoolResult.length === 0) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  const hasAccess = await canAccessSchool(
    session.user.email,
    school_code,
    schoolResult[0].region
  );

  if (!hasAccess) {
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

  const result = await query<{ id: number }>(
    `INSERT INTO lms_pm_school_visits (school_code, pm_email, visit_date, status, data)
     VALUES ($1, $2, $3, 'in_progress', $4)
     RETURNING id`,
    [school_code, session.user.email, visit_date, JSON.stringify(initialData)]
  );

  return NextResponse.json({ id: result[0].id }, { status: 201 });
}
