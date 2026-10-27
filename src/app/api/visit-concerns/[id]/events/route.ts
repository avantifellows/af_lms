import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import {
  VisitConcernEventError,
  commentOnConcern,
  reopenConcern,
  resolveConcern,
} from "@/lib/visit-concern-events";
import { findVisitSummaryConcern, getConcernCardState } from "@/lib/visit-concerns";
import { isVisitConcernAction, validateConcernEventBody, type VisitConcernAction } from "@/lib/visit-concern-event-types";
import { apiError, canViewVisitSummary, parseJsonBody, requireVisitsAccess } from "@/lib/visits-policy";

const WRITES: Record<VisitConcernAction, typeof resolveConcern> = {
  resolve: resolveConcern,
  comment: commentOnConcern,
  reopen: reopenConcern,
};

// POST /api/visit-concerns/[id]/events  { action: "resolve" | "comment" | "reopen", body }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  const access = await requireVisitsAccess(session, "edit");
  if (!access.ok) return access.response;
  if (!canViewVisitSummary(access.actor)) return apiError(403, "Forbidden");

  const concernId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(concernId) || concernId <= 0) {
    return apiError(400, "Invalid concern id");
  }
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { action } = parsed.body;
  if (!isVisitConcernAction(action)) {
    return apiError(400, "action must be resolve, comment or reopen");
  }
  const body = validateConcernEventBody(parsed.body.body);
  if (!body.ok) return apiError(400, body.error);

  const concern = await findVisitSummaryConcern(access.actor, concernId);
  if (!concern) return apiError(404, "Concern not found");

  const write = WRITES[action];
  try {
    await withTransaction((client) =>
      write(client, { concernId: concern.id, actorEmail: access.actor.email, body: body.body })
    );
  } catch (error) {
    if (error instanceof VisitConcernEventError) return apiError(error.status, error.message);
    throw error;
  }

  return NextResponse.json(await getConcernCardState(concern.id), { status: 201 });
}
