import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  listPlanAssignmentCentres,
  savePlanAssignmentByPlan,
} from "@/lib/curriculum-plan-assignments";
import { requireCurriculumPlanAdmin } from "@/lib/curriculum-plans";

// Eligible Centres for the plan's academic year + Grade, with each Centre's current plan and
// uncovered tracks.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const result = await listPlanAssignmentCentres(Number(id));

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({ plan: result.plan, centres: result.centres });
}

// Save by plan: `{ centre_ids }` becomes exactly the set of Centres on this plan.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session, { forWrite: true });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const result = await savePlanAssignmentByPlan({ id: Number(id), adminEmail: access.email, body });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json(result);
}
