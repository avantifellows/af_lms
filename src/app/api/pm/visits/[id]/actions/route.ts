import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { isActionType } from "@/lib/visit-actions";
import {
  apiError,
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
            s.region as school_region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1`,
    [visitId]
  );

  return visits[0] ?? null;
}

// GET /api/pm/visits/[id]/actions - list actions for a visit
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

  return NextResponse.json({ actions });
}

// POST /api/pm/visits/[id]/actions - create a new pending action
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

  const lockError = enforceVisitWriteLock(visit.status);
  if (lockError) {
    return lockError;
  }

  const bodyResult = await parseJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const rawActionType =
    typeof bodyResult.body.action_type === "string" ? bodyResult.body.action_type.trim() : "";
  if (!rawActionType) {
    return apiError(400, "action_type is required");
  }

  if (!isActionType(rawActionType)) {
    return apiError(400, "Invalid action_type");
  }

  const created = await query<VisitActionRow>(
    `INSERT INTO lms_pm_school_visit_actions
       (visit_id, action_type, status, data)
     VALUES ($1, $2, 'pending', '{}'::jsonb)
     RETURNING id, visit_id, action_type, status, data,
               started_at, ended_at, start_accuracy, end_accuracy,
               inserted_at, updated_at`,
    [id, rawActionType]
  );

  return NextResponse.json({ action: created[0] }, { status: 201 });
}
