import { NextRequest, NextResponse } from "next/server";

import {
  listPlanAssignmentCentres,
  savePlanAssignmentByPlan,
} from "@/lib/curriculum-plan-assignments";
import { handlePlanRoute } from "../../plan-route";

type Params = { params: Promise<{ id: string }> };

// Eligible Centres for the plan's academic year + Grade, with each Centre's current plan and
// uncovered tracks.
export async function GET(_request: NextRequest, { params }: Params) {
  return handlePlanRoute(
    {},
    async () => listPlanAssignmentCentres(Number((await params).id)),
    (result) => NextResponse.json({ plan: result.plan, centres: result.centres })
  );
}

// Save by plan: `{ centre_ids }` becomes exactly the set of Centres on this plan.
export async function PUT(request: NextRequest, { params }: Params) {
  return handlePlanRoute(
    { forWrite: true, request },
    async ({ email, body }) =>
      savePlanAssignmentByPlan({ id: Number((await params).id), adminEmail: email, body }),
    (result) => NextResponse.json(result)
  );
}
