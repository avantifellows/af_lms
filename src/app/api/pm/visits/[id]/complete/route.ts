import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
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

interface CompletionAttemptRow {
  id: number;
  status: string;
  completed_at: string | null;
  updated_at: string;
  applied: boolean;
  has_completed_classroom_observation: boolean;
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

  const completionAttempt = await query<CompletionAttemptRow>(
    `WITH action_stats AS (
       SELECT
         EXISTS (
           SELECT 1
           FROM lms_pm_visit_actions a
           WHERE a.visit_id = $1
             AND a.deleted_at IS NULL
             AND a.action_type = 'classroom_observation'
             AND a.status = 'completed'
         ) AS has_completed_classroom_observation,
         EXISTS (
           SELECT 1
           FROM lms_pm_visit_actions a
           WHERE a.visit_id = $1
             AND a.deleted_at IS NULL
             AND a.status = 'in_progress'
         ) AS has_in_progress_actions
     ),
     updated_visit AS (
       UPDATE lms_pm_school_visits v
       SET status = 'completed',
           completed_at = (NOW() AT TIME ZONE 'UTC'),
           end_lat = $2,
           end_lng = $3,
           end_accuracy = $4,
           updated_at = (NOW() AT TIME ZONE 'UTC')
       FROM action_stats stats
       WHERE v.id = $1
         AND v.status = 'in_progress'
         AND stats.has_completed_classroom_observation
         AND NOT stats.has_in_progress_actions
       RETURNING v.id, v.status, v.completed_at, v.updated_at
     )
     SELECT uv.id, uv.status, uv.completed_at, uv.updated_at,
            TRUE AS applied,
            stats.has_completed_classroom_observation,
            stats.has_in_progress_actions
     FROM updated_visit uv
     CROSS JOIN action_stats stats
     UNION ALL
     SELECT v.id, v.status, v.completed_at, v.updated_at,
            FALSE AS applied,
            stats.has_completed_classroom_observation,
            stats.has_in_progress_actions
     FROM lms_pm_school_visits v
     CROSS JOIN action_stats stats
     WHERE v.id = $1
       AND NOT EXISTS (SELECT 1 FROM updated_visit)
     LIMIT 1`,
    [id, gps.reading!.lat, gps.reading!.lng, gps.reading!.accuracy]
  );

  if (completionAttempt.length === 0) {
    return apiError(404, "Visit not found");
  }

  const outcome = completionAttempt[0];
  if (outcome.applied || outcome.status === "completed") {
    return completeResponse(
      {
        id: outcome.id,
        status: outcome.status,
        completed_at: outcome.completed_at,
      },
      gps.warning
    );
  }

  if (outcome.has_in_progress_actions) {
    return apiError(422, "All in-progress action points must be ended before completing visit");
  }

  if (!outcome.has_completed_classroom_observation) {
    return apiError(
      422,
      "At least one completed classroom observation is required to complete visit"
    );
  }

  return apiError(409, "Visit cannot be completed from current state");
}
