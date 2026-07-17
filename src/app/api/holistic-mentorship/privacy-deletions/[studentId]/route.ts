import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import { deleteHolisticStudentContent } from "@/lib/holistic-privacy";
import { positiveIntegerString, readJsonObject } from "../../route-helpers";

type RouteContext = { params: Promise<{ studentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "privacy_delete");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const studentId = positiveIntegerString((await context.params).studentId);
  const value = await readJsonObject(request);
  const reason = typeof value?.reason === "string" ? value.reason.trim() : "";
  if (!studentId || value?.approved !== true ||
      reason.length < 10 || reason.length > 500) {
    return NextResponse.json({ error: "Approved deletion and reason are required" }, { status: 422 });
  }
  const result = await deleteHolisticStudentContent({ email: access.email, studentId, reason });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    ...result,
    sourceDeletionCoordination: "Quiz/BigQuery source deletion requires separate coordination.",
  });
}
