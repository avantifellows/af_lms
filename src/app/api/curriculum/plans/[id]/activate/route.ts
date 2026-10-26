import { NextRequest, NextResponse } from "next/server";

import { activateCurriculumPlan } from "@/lib/curriculum-plans";
import { handlePlanRoute } from "../../plan-route";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handlePlanRoute(
    { forWrite: true },
    async ({ email }) => activateCurriculumPlan({ id: Number((await params).id), adminEmail: email }),
    (result) => NextResponse.json({ plan: result.plan, warnings: result.warnings })
  );
}
