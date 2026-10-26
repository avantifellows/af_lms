import { NextRequest, NextResponse } from "next/server";

import { saveCentrePlanAssignments } from "@/lib/curriculum-plan-assignments";
import { handlePlanRoute } from "../../../plan-route";

// Assign by Centre: `{ academic_year, assignments: [{ grade, plan_id | null }] }` sets the
// Centre's plan for each listed Grade, moving it off its previous plan; other Grades are
// untouched.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ centreId: string }> }
) {
  return handlePlanRoute(
    { forWrite: true, request },
    async ({ email, body }) =>
      saveCentrePlanAssignments({
        centreId: Number((await params).centreId),
        adminEmail: email,
        body,
      }),
    (result) => NextResponse.json(result)
  );
}
