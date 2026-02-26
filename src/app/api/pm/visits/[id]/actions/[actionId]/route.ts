import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  validateClassroomObservationComplete,
  validateClassroomObservationSave,
} from "@/lib/classroom-observation-rubric";
import { query } from "@/lib/db";
import {
  apiError,
  canEditCompletedActionData,
  enforceVisitReadAccess,
  enforceVisitWriteAccess,
  enforceVisitWriteLock,
  parseJsonBody,
  requireVisitsAccess,
} from "@/lib/visits-policy";

interface VisitAccessRow {
  id: number;
  school_code: string;
  pm_email: string;
  visit_date: string;
  status: string;
  completed_at: string | null;
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

async function loadVisitAccessTarget(visitId: string): Promise<VisitAccessRow | null> {
  const visits = await query<VisitAccessRow>(
    `SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status, v.completed_at,
            s.region AS school_region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1`,
    [visitId]
  );

  return visits[0] ?? null;
}

async function loadAction(visitId: string, actionId: string): Promise<VisitActionRow | null> {
  const actions = await query<VisitActionRow>(
    `SELECT id, visit_id, action_type, status, data,
            started_at, ended_at, start_accuracy, end_accuracy,
            inserted_at, updated_at
     FROM lms_pm_school_visit_actions
     WHERE visit_id = $1
       AND id = $2
       AND deleted_at IS NULL`,
    [visitId, actionId]
  );

  return actions[0] ?? null;
}

function toVisitResponse(visit: VisitAccessRow) {
  return {
    id: visit.id,
    school_code: visit.school_code,
    pm_email: visit.pm_email,
    visit_date: visit.visit_date,
    status: visit.status,
    completed_at: visit.completed_at,
  };
}

// GET /api/pm/visits/[id]/actions/[actionId] - fetch one action for dynamic action page
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  void request;
  const { id, actionId } = await params;

  const session = await getServerSession(authOptions);
  const access = await requireVisitsAccess(session, "view");
  if (!access.ok) {
    return access.response;
  }
  const { actor } = access;

  const visit = await loadVisitAccessTarget(id);
  if (!visit) {
    return apiError(404, "Visit not found");
  }

  const readError = enforceVisitReadAccess(actor, {
    pmEmail: visit.pm_email,
    schoolCode: visit.school_code,
    schoolRegion: visit.school_region,
  });
  if (readError) {
    return readError;
  }

  const action = await loadAction(id, actionId);
  if (!action) {
    return apiError(404, "Action not found");
  }

  return NextResponse.json({
    visit: toVisitResponse(visit),
    action,
  });
}

// PATCH /api/pm/visits/[id]/actions/[actionId] - update action data only
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  const { id, actionId } = await params;

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

  const action = await loadAction(id, actionId);
  if (!action) {
    return apiError(404, "Action not found");
  }

  if (action.status === "completed" && !canEditCompletedActionData(actor)) {
    return apiError(409, "Completed actions are read-only");
  }

  const bodyResult = await parseJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const { data } = bodyResult.body;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return apiError(400, "data must be an object");
  }

  if (action.action_type === "classroom_observation") {
    const validation =
      action.status === "completed"
        ? validateClassroomObservationComplete(data)
        : validateClassroomObservationSave(data);

    if (!validation.valid) {
      return apiError(422, "Invalid classroom observation data", validation.errors);
    }
  }

  const updated = await query<VisitActionRow>(
    `UPDATE lms_pm_school_visit_actions
     SET data = $3::jsonb,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE visit_id = $1
       AND id = $2
       AND deleted_at IS NULL
     RETURNING id, visit_id, action_type, status, data,
               started_at, ended_at, start_accuracy, end_accuracy,
               inserted_at, updated_at`,
    [id, actionId, JSON.stringify(data)]
  );

  if (updated.length === 0) {
    return apiError(404, "Action not found");
  }

  return NextResponse.json({ action: updated[0] });
}

// DELETE /api/pm/visits/[id]/actions/[actionId] - soft delete pending action
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  void request;
  const { id, actionId } = await params;

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

  const action = await loadAction(id, actionId);
  if (!action) {
    return apiError(404, "Action not found");
  }

  if (action.status !== "pending") {
    return apiError(409, "Only pending actions can be deleted");
  }

  const deleted = await query<{ id: number }>(
    `UPDATE lms_pm_school_visit_actions
     SET deleted_at = (NOW() AT TIME ZONE 'UTC'),
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE visit_id = $1
       AND id = $2
       AND deleted_at IS NULL
     RETURNING id`,
    [id, actionId]
  );

  if (deleted.length === 0) {
    return apiError(404, "Action not found");
  }

  return NextResponse.json({ success: true });
}
