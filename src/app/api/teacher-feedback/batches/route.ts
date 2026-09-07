import { NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/db";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback, requireCentreScope } from "@/lib/teacher-feedback-access";
import { getBatchesForCentre, getCentreScope } from "@/lib/teacher-feedback-batches";

// GET /api/teacher-feedback/batches?centre_id=NN
//
// The class batches of ONE centre's cohort. Replaces this tab's earlier use of
// /api/quiz-sessions/batches?schoolId=, which is school-scoped and so offered a
// PM the sibling centre's batches at a school hosting both a CoE and a Nodal.
export async function GET(request: NextRequest) {
  const access = await authenticateTeacherFeedback("edit");
  if (!access.ok) {
    return access.response;
  }

  const centreIdParam = request.nextUrl.searchParams.get("centre_id")?.trim();
  const centreId = Number(centreIdParam);
  if (!centreIdParam || !Number.isInteger(centreId) || centreId <= 0) {
    return NextResponse.json(
      { error: "centre_id query parameter is required" },
      { status: 400 }
    );
  }

  const scope = await getCentreScope(centreId);
  if (!scope) {
    return NextResponse.json({ error: "Centre not found" }, { status: 404 });
  }

  // Authorize on the centre's school, matching the other Teacher Feedback routes.
  if (!(await canAccessQuizSessionSchool(access.permission, scope.schoolId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Teacher Feedback is centre-keyed, so the school check above is not enough:
  // narrow a confined caller to their own seat centres.
  const centreScopeCheck = requireCentreScope(access.permission, scope.centreId);
  if (!centreScopeCheck.ok) {
    return centreScopeCheck.response;
  }

  const batches = await getBatchesForCentre(scope);

  // An empty list is a real answer (a centre with no programme, or no cohorts
  // yet), so tell the client why rather than letting it read as "still loading".
  if (batches.length === 0 && scope.programId === null) {
    const [{ name } = { name: "This centre" }] = await query<{ name: string }>(
      `SELECT name FROM centres WHERE id = $1 LIMIT 1`,
      [scope.centreId]
    );
    return NextResponse.json({
      batches: [],
      reason: `${name} has no programme set, so its batches cannot be identified. Ask an admin to set the centre's programme.`,
    });
  }

  return NextResponse.json({ batches });
}
