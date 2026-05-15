import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  apiError,
  enforceVisitReadAccess,
  enforceVisitWriteAccess,
  enforceVisitWriteLock,
  requireVisitsAccess,
} from "@/lib/visits-policy";

interface VisitDetailRow {
  id: number;
  school_code: string;
  pm_email: string;
  visit_date: string;
  status: string;
  completed_at: string | null;
  inserted_at: string;
  updated_at: string;
  school_name: string | null;
  school_region: string | null;
}

interface VisitActionRow {
  id: number;
  visit_id: number;
  action_type: string;
  status: string;
  data: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  start_accuracy: string | null;
  end_accuracy: string | null;
  inserted_at: string;
  updated_at: string;
}

interface VisitAccessRow {
  id: number;
  school_code: string;
  pm_email: string;
  status: string;
  school_region: string | null;
}

interface VisitRaceRow extends VisitAccessRow {
  deleted_at: string | null;
}

async function loadVisitAccessTarget(visitId: string): Promise<VisitAccessRow | null> {
  const visits = await query<VisitAccessRow>(
    `SELECT v.id, v.school_code, v.pm_email, v.status, s.region as school_region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1
       AND v.deleted_at IS NULL`,
    [visitId]
  );

  return visits[0] ?? null;
}

async function loadVisitForDeleteRace(visitId: string): Promise<VisitRaceRow | null> {
  const visits = await query<VisitRaceRow>(
    `SELECT v.id, v.school_code, v.pm_email, v.status, v.deleted_at,
            s.region as school_region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1`,
    [visitId]
  );

  return visits[0] ?? null;
}

// GET /api/pm/visits/[id] - Get visit details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  void request;
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const access = await requireVisitsAccess(session, "view");
  if (!access.ok) {
    return access.response;
  }
  const { actor } = access;

  const visits = await query<VisitDetailRow>(
    `SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status,
            v.completed_at, v.inserted_at, v.updated_at,
            s.name as school_name, s.region as school_region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1
       AND v.deleted_at IS NULL`,
    [id]
  );

  if (visits.length === 0) {
    return apiError(404, "Visit not found");
  }

  const visit = visits[0];
  const readError = enforceVisitReadAccess(actor, {
    pmEmail: visit.pm_email,
    schoolCode: visit.school_code,
    schoolRegion: visit.school_region,
  });
  if (readError) {
    return readError;
  }

  const actions = await query<VisitActionRow>(
    `SELECT id, visit_id, action_type, status, data,
            started_at, ended_at, start_accuracy, end_accuracy,
            inserted_at, updated_at
     FROM lms_pm_school_visit_actions
     WHERE visit_id = $1
       AND deleted_at IS NULL
     ORDER BY inserted_at ASC, id ASC`,
    [id]
  );

  const publicVisit = {
    id: visit.id,
    school_code: visit.school_code,
    pm_email: visit.pm_email,
    visit_date: visit.visit_date,
    status: visit.status,
    completed_at: visit.completed_at,
    inserted_at: visit.inserted_at,
    updated_at: visit.updated_at,
    school_name: visit.school_name,
  };
  return NextResponse.json({ visit: publicVisit, actions });
}

// DELETE /api/pm/visits/[id] - Soft delete an in-progress visit
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  void request;
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const access = await requireVisitsAccess(session, "edit");
  if (!access.ok) {
    return access.response;
  }
  const { actor } = access;

  const visit = await loadVisitAccessTarget(id);
  if (!visit) {
    return apiError(404, "Visit not found");
  }

  const writeError = enforceVisitWriteAccess(actor, {
    pmEmail: visit.pm_email,
    schoolCode: visit.school_code,
    schoolRegion: visit.school_region,
  });
  if (writeError) {
    return writeError;
  }

  const lockError = enforceVisitWriteLock(visit.status);
  if (lockError) {
    return lockError;
  }

  const result = await query<{ id: number }>(
    `WITH deleted_visit AS (
       UPDATE lms_pm_school_visits
       SET deleted_at = (NOW() AT TIME ZONE 'UTC'),
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $1
         AND status = 'in_progress'
         AND deleted_at IS NULL
       RETURNING id
     ),
     deleted_actions AS (
       UPDATE lms_pm_school_visit_actions
       SET status = 'pending',
           started_at = NULL,
           ended_at = NULL,
           start_lat = NULL,
           start_lng = NULL,
           start_accuracy = NULL,
           end_lat = NULL,
           end_lng = NULL,
           end_accuracy = NULL,
           deleted_at = (NOW() AT TIME ZONE 'UTC'),
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE visit_id = (SELECT id FROM deleted_visit)
         AND deleted_at IS NULL
     )
     SELECT id FROM deleted_visit;`,
    [id]
  );

  if (result.length > 0) {
    return NextResponse.json({ success: true });
  }

  const currentVisit = await loadVisitForDeleteRace(id);
  if (!currentVisit || currentVisit.deleted_at) {
    return apiError(404, "Visit not found");
  }
  if (currentVisit.status === "completed") {
    return apiError(409, "Completed visits cannot be deleted");
  }

  return apiError(404, "Visit not found");
}
