import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  createCurriculumPlan,
  listCurriculumPlans,
  normalizeCurriculumPlanListFilters,
  requireCurriculumPlanAdmin,
} from "@/lib/curriculum-plans";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const filters = normalizeCurriculumPlanListFilters(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const result = await listCurriculumPlans(filters);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({ filters, plans: result.plans });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session, { forWrite: true });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = await createCurriculumPlan({ adminEmail: access.email, body });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({ plan: result.plan }, { status: 201 });
}
