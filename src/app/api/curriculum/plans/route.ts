import { NextRequest, NextResponse } from "next/server";

import {
  createCurriculumPlan,
  listCurriculumPlans,
  normalizeCurriculumPlanListFilters,
} from "@/lib/curriculum-plans";
import { handlePlanRoute } from "./plan-route";

export async function GET(request: NextRequest) {
  const filters = normalizeCurriculumPlanListFilters(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  return handlePlanRoute(
    {},
    () => listCurriculumPlans(filters),
    (result) => NextResponse.json({ filters, plans: result.plans })
  );
}

export async function POST(request: NextRequest) {
  return handlePlanRoute(
    { forWrite: true, request },
    ({ email, body }) => createCurriculumPlan({ adminEmail: email, body }),
    (result) => NextResponse.json({ plan: result.plan }, { status: 201 })
  );
}
