import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { saveCentrePlanAssignments } from "@/lib/curriculum-plan-assignments";
import { requireCurriculumPlanAdmin } from "@/lib/curriculum-plans";

// Assign by Centre: `{ academic_year, assignments: [{ grade, plan_id | null }] }` sets the
// Centre's plan for each listed Grade, moving it off its previous plan; other Grades are
// untouched.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ centreId: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session, { forWrite: true });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { centreId } = await params;
  const body = await request.json().catch(() => null);
  const result = await saveCentrePlanAssignments({
    centreId: Number(centreId),
    adminEmail: access.email,
    body,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json(result);
}
