import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { getHolisticStudentPhase } from "@/lib/holistic-student-phase";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string; phaseId: string }> }
) {
  const session = await getServerSession(authOptions);
  const { studentId: rawStudentId, phaseId: rawPhaseId } = await params;
  const studentId = Number(rawStudentId);
  const phaseId = Number(rawPhaseId);
  const searchParams = new URL(request.url).searchParams;
  const schoolCode = searchParams.get("school_code") ?? "";
  const academicYear = searchParams.get("academic_year") ?? "";
  if (!Number.isInteger(studentId) || studentId < 1 || !Number.isInteger(phaseId) || phaseId < 1 ||
      !schoolCode || !validateAcademicYear(academicYear)) {
    return NextResponse.json({ error: "Invalid Student, Phase, School, or Academic Year" }, { status: 422 });
  }

  const access = await requireHolisticMentorshipAccess(session, "mapped_student_read", {
    schoolCode,
    studentId,
    academicYear,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const detail = await getHolisticStudentPhase({
    studentId,
    phaseId,
    schoolId: access.school!.id,
    academicYear,
    actorUserId: access.actorUserId,
    role: access.permission.role,
  });
  return detail
    ? NextResponse.json(detail)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
