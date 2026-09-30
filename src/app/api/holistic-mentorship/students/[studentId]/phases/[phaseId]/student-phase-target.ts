import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { holisticProgramId, positiveIntegerString } from "../../../../route-helpers";

// Shared by the Student Phase route and its sub-routes so the target and
// query context parse identically.
export type RouteParams = Promise<{ studentId: string; phaseId: string }>;

async function targetFrom(request: NextRequest, params: RouteParams) {
  const raw = await params;
  const studentId = positiveIntegerString(raw.studentId);
  const phaseId = positiveIntegerString(raw.phaseId);
  const searchParams = new URL(request.url).searchParams;
  const schoolCode = searchParams.get("school_code") ?? "";
  const academicYear = searchParams.get("academic_year") ?? "";
  const programId = holisticProgramId(searchParams.get("program_id"));
  return studentId && phaseId && schoolCode && programId &&
    validateAcademicYear(academicYear)
    ? { studentId, phaseId, schoolCode, academicYear, programId }
    : null;
}

export async function authenticatedTarget(request: NextRequest, params: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const target = await targetFrom(request, params);
  if (!target) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Invalid Student, Phase, School, or Academic Year" },
        { status: 422 }
      ),
    };
  }
  return { ok: true as const, session, target };
}
