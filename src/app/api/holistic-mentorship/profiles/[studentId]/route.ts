import { NextResponse } from "next/server";

import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { getHolisticProfileAdmin, requestHolisticProfileRegeneration } from "@/lib/holistic-profiles";
import {
  holisticRouteAccess,
  holisticProgramId,
  positiveIntegerString,
  readJsonObject,
  validSchoolCode,
} from "../../route-helpers";

type RouteContext = { params: Promise<{ studentId: string }> };

async function studentIdFrom(context: RouteContext): Promise<number | null> {
  return positiveIntegerString((await context.params).studentId);
}

export async function GET(request: Request, context: RouteContext) {
  const studentId = await studentIdFrom(context);
  const params = new URL(request.url).searchParams;
  const academicYear = params.get("academic_year") ?? "";
  const programId = holisticProgramId(params.get("program_id"));
  const schoolCode = params.get("school_code");
  if (!studentId || !programId || !validSchoolCode(schoolCode) || !validateAcademicYear(academicYear)) {
    return NextResponse.json({ error: "Invalid Student or Academic Year" }, { status: 422 });
  }
  const access = await holisticRouteAccess("mapped_student_read", {
    schoolCode,
    studentId,
    academicYear,
    programId,
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json(
    await getHolisticProfileAdmin(studentId, academicYear, programId),
  );
}

export async function POST(request: Request, context: RouteContext) {
  const studentId = await studentIdFrom(context);
  const programId = holisticProgramId(
    new URL(request.url).searchParams.get("program_id"),
  );
  const value = await readJsonObject(request);
  const requestKey = value?.request_key;
  if (!studentId || !programId || typeof requestKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey) ||
      value?.force !== true) {
    return NextResponse.json({ error: "Invalid regeneration request" }, { status: 422 });
  }
  const access = await holisticRouteAccess("profile_regenerate", { programId });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const result = await requestHolisticProfileRegeneration({
    email: access.email, studentId, programId, requestKey, force: true,
  });
  return result.ok
    ? NextResponse.json(result, { status: 202 })
    : NextResponse.json({ error: result.error }, { status: result.status });
}
