import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { validateClassroomObservationComplete } from "@/lib/classroom-observation-rubric";
import { query } from "@/lib/db";
import { validateGpsReading } from "@/lib/geo-validation";
import {
  apiError,
  enforceVisitWriteAccess,
  parseJsonBody,
  requireVisitsAccess,
} from "@/lib/visits-policy";

interface VisitAccessRow {
  id: number;
  school_code: string;
  pm_email: string;
  status: string;
  completed_at: string | null;
  school_region: string | null;
}

interface CompletedClassroomActionRow {
  id: number;
  data: unknown;
}

interface InProgressActionStateRow {
  has_in_progress_actions: boolean;
}

async function loadVisitAccessTarget(visitId: string): Promise<VisitAccessRow | null> {
  const visits = await query<VisitAccessRow>(
    `SELECT v.id, v.school_code, v.pm_email, v.status, v.completed_at,
            s.region AS school_region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1`,
    [visitId]
  );

  return visits[0] ?? null;
}

function completeResponse(
  visit: Pick<VisitAccessRow, "id" | "status" | "completed_at">,
  warning?: string
) {
  const response: {
    visit: Pick<VisitAccessRow, "id" | "status" | "completed_at">;
    warning?: string;
  } = { visit };

  if (warning) {
    response.warning = warning;
  }

  return NextResponse.json(response);
}

// POST /api/pm/visits/[id]/complete - complete visit with end GPS
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const bodyResult = await parseJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const gps = validateGpsReading(bodyResult.body, "end");
  if (!gps.valid) {
    return apiError(422, gps.error || "Invalid GPS reading");
  }

  // Idempotent complete: keep existing completion timestamp and avoid overwriting GPS.
  if (visit.status === "completed") {
    return completeResponse(
      {
        id: visit.id,
        status: visit.status,
        completed_at: visit.completed_at,
      },
      gps.warning
    );
  }

  const actionState = await query<InProgressActionStateRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM lms_pm_school_visit_actions a
       WHERE a.visit_id = $1
         AND a.deleted_at IS NULL
         AND a.status = 'in_progress'
     ) AS has_in_progress_actions`,
    [id]
  );
  const hasInProgressActions = actionState[0]?.has_in_progress_actions === true;
  if (hasInProgressActions) {
    return apiError(422, "All in-progress action points must be ended before completing visit");
  }

  const completedClassroomActions = await query<CompletedClassroomActionRow>(
    `SELECT a.id, a.data
     FROM lms_pm_school_visit_actions a
     WHERE a.visit_id = $1
       AND a.deleted_at IS NULL
       AND a.action_type = 'classroom_observation'
       AND a.status = 'completed'
     ORDER BY a.id ASC`,
    [id]
  );

  if (completedClassroomActions.length === 0) {
    return apiError(
      422,
      "At least one completed classroom observation is required to complete visit",
      ["No completed classroom observation action found for this visit"]
    );
  }

  let hasValidCompletedClassroomObservation = false;
  let firstInvalidDetails: string[] = [];

  for (const action of completedClassroomActions) {
    const validation = validateClassroomObservationComplete(action.data);
    if (validation.valid) {
      hasValidCompletedClassroomObservation = true;
      break;
    }

    if (firstInvalidDetails.length === 0) {
      firstInvalidDetails = validation.errors.map((error) => `Action ${action.id}: ${error}`);
    }
  }

  if (!hasValidCompletedClassroomObservation) {
    return apiError(
      422,
      "At least one completed classroom observation is required to complete visit",
      firstInvalidDetails
    );
  }

  const updatedVisit = await query<Pick<VisitAccessRow, "id" | "status" | "completed_at">>(
    `UPDATE lms_pm_school_visits v
     SET status = 'completed',
         completed_at = (NOW() AT TIME ZONE 'UTC'),
         end_lat = $2,
         end_lng = $3,
         end_accuracy = $4,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE v.id = $1
       AND v.status = 'in_progress'
       AND NOT EXISTS (
         SELECT 1
         FROM lms_pm_school_visit_actions a
         WHERE a.visit_id = $1
           AND a.deleted_at IS NULL
           AND a.status = 'in_progress'
       )
     RETURNING v.id, v.status, v.completed_at`,
    [id, gps.reading!.lat, gps.reading!.lng, gps.reading!.accuracy]
  );

  if (updatedVisit.length > 0) {
    return completeResponse(
      {
        id: updatedVisit[0].id,
        status: updatedVisit[0].status,
        completed_at: updatedVisit[0].completed_at,
      },
      gps.warning
    );
  }

  const currentVisit = await loadVisitAccessTarget(id);
  if (!currentVisit) {
    return apiError(404, "Visit not found");
  }

  if (currentVisit.status === "completed") {
    return completeResponse(
      {
        id: currentVisit.id,
        status: currentVisit.status,
        completed_at: currentVisit.completed_at,
      },
      gps.warning
    );
  }

  const latestActionState = await query<InProgressActionStateRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM lms_pm_school_visit_actions a
       WHERE a.visit_id = $1
         AND a.deleted_at IS NULL
         AND a.status = 'in_progress'
     ) AS has_in_progress_actions`,
    [id]
  );
  const stillHasInProgressActions = latestActionState[0]?.has_in_progress_actions === true;
  if (stillHasInProgressActions) {
    return apiError(422, "All in-progress action points must be ended before completing visit");
  }

  return apiError(409, "Visit cannot be completed from current state");
}
