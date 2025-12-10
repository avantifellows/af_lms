import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessPMFeatures } from "@/lib/permissions";
import { query } from "@/lib/db";

interface Visit {
  id: number;
  school_code: string;
  pm_email: string;
  visit_date: string;
  status: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  school_name?: string;
}

// GET /api/pm/visits/[id] - Get visit details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canAccess = await canAccessPMFeatures(session.user.email);
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const visits = await query<Visit>(
    `SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status,
            v.data, v.created_at, v.updated_at,
            s.name as school_name
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1`,
    [id]
  );

  if (visits.length === 0) {
    return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  }

  const visit = visits[0];

  // Only allow PM who created the visit or admins to view
  if (visit.pm_email !== session.user.email) {
    // Check if user is admin
    const permission = await query<{ role: string }>(
      `SELECT role FROM user_permission WHERE LOWER(email) = LOWER($1)`,
      [session.user.email]
    );
    if (permission.length === 0 || permission[0].role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({ visit });
}

// PATCH /api/pm/visits/[id] - Update a section of the visit
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canAccess = await canAccessPMFeatures(session.user.email);
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Get the visit first
  const visits = await query<Visit>(
    `SELECT id, pm_email, status, data FROM lms_pm_school_visits WHERE id = $1`,
    [id]
  );

  if (visits.length === 0) {
    return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  }

  const visit = visits[0];

  // Only the PM who created the visit can update it
  if (visit.pm_email !== session.user.email) {
    return NextResponse.json(
      { error: "Only the visit creator can update it" },
      { status: 403 }
    );
  }

  // Cannot update completed visits
  if (visit.status === "completed") {
    return NextResponse.json(
      { error: "Cannot update a completed visit" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { section, data: sectionData } = body;

  if (!section || sectionData === undefined) {
    return NextResponse.json(
      { error: "section and data are required" },
      { status: 400 }
    );
  }

  // Valid sections
  const validSections = [
    "principalMeeting",
    "leadershipMeetings",
    "classroomObservations",
    "studentDiscussions",
    "staffMeetings",
    "teacherFeedback",
    "issueLog",
  ];

  if (!validSections.includes(section)) {
    return NextResponse.json(
      { error: `Invalid section. Must be one of: ${validSections.join(", ")}` },
      { status: 400 }
    );
  }

  // Update the specific section in the JSONB data
  await query(
    `UPDATE lms_pm_school_visits
     SET data = jsonb_set(data, $1, $2::jsonb),
         updated_at = NOW()
     WHERE id = $3`,
    [`{${section}}`, JSON.stringify(sectionData), id]
  );

  // Fetch updated visit
  const updatedVisits = await query<Visit>(
    `SELECT id, school_code, pm_email, visit_date, status, data, updated_at
     FROM lms_pm_school_visits WHERE id = $1`,
    [id]
  );

  return NextResponse.json({ visit: updatedVisits[0] });
}

// POST /api/pm/visits/[id]/complete - Mark visit as complete
// (Alternative: could be a separate route file)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;

  if (action !== "complete") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Get the visit
  const visits = await query<Visit>(
    `SELECT id, pm_email, status, data FROM lms_pm_school_visits WHERE id = $1`,
    [id]
  );

  if (visits.length === 0) {
    return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  }

  const visit = visits[0];

  if (visit.pm_email !== session.user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (visit.status === "completed") {
    return NextResponse.json({ error: "Visit already completed" }, { status: 400 });
  }

  // Validate all required sections are filled
  const data = visit.data as {
    principalMeeting: unknown;
    leadershipMeetings: unknown;
    classroomObservations: unknown[];
    studentDiscussions: { groupDiscussions: unknown[]; individualDiscussions: unknown[] };
    staffMeetings: { individualMeetings: unknown[]; teamMeeting: unknown };
    teacherFeedback: unknown[];
    issueLog: unknown[];
  };

  const errors: string[] = [];

  if (!data.principalMeeting) {
    errors.push("Principal meeting is required");
  }
  if (!data.leadershipMeetings) {
    errors.push("Leadership meetings are required");
  }
  if (!data.classroomObservations || data.classroomObservations.length === 0) {
    errors.push("At least one classroom observation is required");
  }
  if (
    !data.studentDiscussions?.groupDiscussions?.length &&
    !data.studentDiscussions?.individualDiscussions?.length
  ) {
    errors.push("At least one student discussion is required");
  }
  if (!data.staffMeetings?.teamMeeting) {
    errors.push("Team meeting is required");
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Visit incomplete", details: errors },
      { status: 400 }
    );
  }

  // Mark as complete
  await query(
    `UPDATE lms_pm_school_visits SET status = 'completed', updated_at = NOW() WHERE id = $1`,
    [id]
  );

  return NextResponse.json({ success: true, status: "completed" });
}
