import { NextRequest, NextResponse } from "next/server";

import { copyCurriculumPlan } from "@/lib/curriculum-plans";
import { handlePlanRoute } from "../../plan-route";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handlePlanRoute(
    { forWrite: true, request },
    async ({ email, body }) =>
      copyCurriculumPlan({ id: Number((await params).id), adminEmail: email, body }),
    (result) => NextResponse.json({ plan: result.plan }, { status: 201 })
  );
}
