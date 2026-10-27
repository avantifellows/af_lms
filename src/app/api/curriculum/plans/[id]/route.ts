import { NextRequest, NextResponse } from "next/server";

import {
  deleteCurriculumPlan,
  getCurriculumPlan,
  updateCurriculumPlanMetadata,
} from "@/lib/curriculum-plans";
import { handlePlanRoute } from "../plan-route";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  return handlePlanRoute(
    {},
    async () => getCurriculumPlan(Number((await params).id)),
    (result) => NextResponse.json({ plan: result.plan })
  );
}

export async function PATCH(request: NextRequest, { params }: Params) {
  return handlePlanRoute(
    { forWrite: true, request },
    async ({ email, body }) =>
      updateCurriculumPlanMetadata({ id: Number((await params).id), adminEmail: email, body }),
    (result) => NextResponse.json({ plan: result.plan })
  );
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return handlePlanRoute(
    { forWrite: true },
    async () => deleteCurriculumPlan({ id: Number((await params).id) }),
    () => NextResponse.json({ deleted: true })
  );
}
