import { NextResponse } from "next/server";

import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { getHolisticProfileAdmin, requestHolisticProfileRegeneration } from "@/lib/holistic-profiles";
import {
  holisticRouteAccess,
  positiveIntegerString,
  readJsonObject,
} from "../../route-helpers";

type RouteContext = { params: Promise<{ studentId: string }> };

async function studentIdFrom(context: RouteContext): Promise<number | null> {
  return positiveIntegerString((await context.params).studentId);
}

export async function GET(request: Request, context: RouteContext) {
  const access = await holisticRouteAccess("program_read");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const studentId = await studentIdFrom(context);
  const academicYear = new URL(request.url).searchParams.get("academic_year") ?? "";
  if (!studentId || !validateAcademicYear(academicYear)) {
    return NextResponse.json({ error: "Invalid Student or Academic Year" }, { status: 422 });
  }
  return NextResponse.json(await getHolisticProfileAdmin(studentId, academicYear));
}

export async function POST(request: Request, context: RouteContext) {
  const access = await holisticRouteAccess("profile_regenerate");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const studentId = await studentIdFrom(context);
  const value = await readJsonObject(request);
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
