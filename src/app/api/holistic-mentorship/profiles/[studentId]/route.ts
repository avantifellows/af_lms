import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { getHolisticProfileAdmin, requestHolisticProfileRegeneration } from "@/lib/holistic-profiles";

type RouteContext = { params: Promise<{ studentId: string }> };

async function studentIdFrom(context: RouteContext): Promise<number | null> {
  const studentId = Number((await context.params).studentId);
  return Number.isSafeInteger(studentId) && studentId > 0 ? studentId : null;
}

export async function GET(request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "program_read");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const studentId = await studentIdFrom(context);
  const academicYear = new URL(request.url).searchParams.get("academic_year") ?? "";
  if (!studentId || !validateAcademicYear(academicYear)) {
    return NextResponse.json({ error: "Invalid Student or Academic Year" }, { status: 422 });
  }
  return NextResponse.json(await getHolisticProfileAdmin(studentId, academicYear));
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "profile_regenerate");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const studentId = await studentIdFrom(context);
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const value = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const requestKey = value?.request_key;
  if (!studentId || typeof requestKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey) ||
      value?.force !== true) {
    return NextResponse.json({ error: "Invalid regeneration request" }, { status: 422 });
  }
  const result = await requestHolisticProfileRegeneration({
    email: access.email, studentId, requestKey, force: true,
  });
  return result.ok
    ? NextResponse.json(result, { status: 202 })
    : NextResponse.json({ error: result.error }, { status: result.status });
}
