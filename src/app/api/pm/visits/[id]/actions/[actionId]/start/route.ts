import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { validateGpsReading } from "@/lib/geo-validation";
import {
  apiError,
  enforceVisitWriteAccess,
  enforceVisitWriteLock,
  parseJsonBody,
  requireVisitsAccess,
} from "@/lib/visits-policy";

interface VisitAccessRow {
  id: number;
  school_code: string;
  pm_email: string;
  status: string;
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
    `SELECT v.id, v.school_code, v.pm_email, v.status,
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

function startResponse(action: VisitActionRow, warning?: string) {
  const response: { action: VisitActionRow; warning?: string } = { action };
  if (warning) {
    response.warning = warning;
  }
  return NextResponse.json(response);
}

// POST /api/pm/visits/[id]/actions/[actionId]/start - start action with start GPS
export async function POST(
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

  const bodyResult = await parseJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const gps = validateGpsReading(bodyResult.body, "start");
  if (!gps.valid) {
    return apiError(422, gps.error || "Invalid GPS reading");
  }

  const existingAction = await loadAction(id, actionId);
  if (!existingAction) {
    return apiError(404, "Action not found");
  }

  if (existingAction.started_at) {
    return startResponse(existingAction, gps.warning);
  }

  const started = await query<VisitActionRow>(
    `UPDATE lms_pm_school_visit_actions
     SET status = 'in_progress',
         started_at = (NOW() AT TIME ZONE 'UTC'),
         start_lat = $3,
         start_lng = $4,
         start_accuracy = $5,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE visit_id = $1
       AND id = $2
       AND deleted_at IS NULL
       AND status = 'pending'
       AND started_at IS NULL
       AND ended_at IS NULL
     RETURNING id, visit_id, action_type, status, data,
               started_at, ended_at, start_accuracy, end_accuracy,
               inserted_at, updated_at`,
    [id, actionId, gps.reading!.lat, gps.reading!.lng, gps.reading!.accuracy]
  );

  if (started.length > 0) {
    return startResponse(started[0], gps.warning);
  }

  // Handle concurrent transition: if action got started elsewhere, return idempotent success.
  const current = await loadAction(id, actionId);
  if (!current) {
    return apiError(404, "Action not found");
  }
  if (current.started_at) {
    return startResponse(current, gps.warning);
  }

  return apiError(409, "Action cannot be started from current state");
}
