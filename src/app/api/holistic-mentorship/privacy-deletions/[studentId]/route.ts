import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import { deleteHolisticStudentContent } from "@/lib/holistic-privacy";

type RouteContext = { params: Promise<{ studentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "privacy_delete");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const studentId = Number((await context.params).studentId);
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const value = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : null;
  const reason = typeof value?.reason === "string" ? value.reason.trim() : "";
  if (!Number.isSafeInteger(studentId) || studentId < 1 || value?.approved !== true ||
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
