import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { saveHolisticNotes } from "@/lib/holistic-notes";
import { getHolisticStudentPhase } from "@/lib/holistic-student-phase";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string; phaseId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    canEdit: access.canEdit,
  });
  return detail
    ? NextResponse.json(detail)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string; phaseId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { studentId: rawStudentId, phaseId: rawPhaseId } = await params;
  const studentId = Number(rawStudentId);
  const phaseId = Number(rawPhaseId);
  const searchParams = new URL(request.url).searchParams;
  const schoolCode = searchParams.get("school_code") ?? "";
  const academicYear = searchParams.get("academic_year") ?? "";
  if (!Number.isSafeInteger(studentId) || studentId < 1 || !Number.isSafeInteger(phaseId) || phaseId < 1 ||
      !schoolCode || !validateAcademicYear(academicYear)) {
    return NextResponse.json({ error: "Invalid Student, Phase, School, or Academic Year" }, { status: 422 });
  }

  let value: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    value = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }
  const action = value.action;
  const mode = action === "draft" || action === "submit" || action === "edit" ? action : null;
  if (!mode) return NextResponse.json({ error: "Invalid Notes" }, { status: 422 });
  const access = await requireHolisticMentorshipAccess(session, `notes_${mode}` as "notes_draft" | "notes_submit" | "notes_edit", {
    schoolCode,
    studentId,
    academicYear,
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const expectedRevision = value.expected_revision;
  const rawAnswers = value.answers;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !Array.isArray(rawAnswers) || rawAnswers.length > 4) {
    return NextResponse.json({ error: "Invalid Notes" }, { status: 422 });
  }
  const answers = rawAnswers.map((answer) => {
    if (!answer || typeof answer !== "object") return null;
    const item = answer as Record<string, unknown>;
    return typeof item.question_id === "number" && Number.isSafeInteger(item.question_id) && item.question_id > 0 &&
      typeof item.answer === "string" && item.answer.length <= 10_000
      ? { questionId: item.question_id, answer: item.answer }
      : null;
  });
  if (answers.some((answer) => !answer) || new Set(answers.map((answer) => answer?.questionId)).size !== answers.length) {
    return NextResponse.json({ error: "Invalid Notes" }, { status: 422 });
  }
  if (mode !== "draft" && (
    typeof value.expected_mapping_id !== "number" || !Number.isSafeInteger(value.expected_mapping_id) || value.expected_mapping_id < 1 ||
    typeof value.expected_phase_revision !== "number" || !Number.isSafeInteger(value.expected_phase_revision) || value.expected_phase_revision < 1 ||
    value.confirmed !== true
  )) {
    return NextResponse.json({ error: "Current revisions and confirmation are required" }, { status: 422 });
  }

  const result = await saveHolisticNotes({
    mode,
    studentId,
    phaseId,
    schoolId: access.school!.id,
    academicYear,
    actorUserId: access.actorUserId!,
    expectedRevision,
    answers: answers as Array<{ questionId: number; answer: string }>,
    expectedMappingId: typeof value.expected_mapping_id === "number" ? value.expected_mapping_id : undefined,
    expectedPhaseRevision: typeof value.expected_phase_revision === "number" ? value.expected_phase_revision : undefined,
    confirmed: value.confirmed === true,
  });
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json({ error: result.error, currentRevision: result.currentRevision }, { status: result.status });
}
