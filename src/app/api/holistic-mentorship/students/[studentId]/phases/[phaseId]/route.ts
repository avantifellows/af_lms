import { NextRequest, NextResponse } from "next/server";

import { saveHolisticNotes } from "@/lib/holistic-notes";
import { getHolisticStudentPhase } from "@/lib/holistic-student-phase";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import { positiveInteger, readJsonObject } from "../../../../route-helpers";
import { authenticatedTarget, type RouteParams } from "./student-phase-target";

type NotesMode = "draft" | "submit" | "edit";

function notesMode(value: unknown): NotesMode | null {
  return value === "draft" || value === "submit" || value === "edit" ? value : null;
}

function parseAnswer(value: unknown): { questionId: number; answer: string } | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const questionId = positiveInteger(item.question_id);
  return questionId && typeof item.answer === "string" && item.answer.length <= 10_000
    ? { questionId, answer: item.answer }
    : null;
}

function parseAnswers(value: unknown): Array<{ questionId: number; answer: string }> | null {
  if (!Array.isArray(value)) return null;
  const answers = value.map(parseAnswer);
  if (answers.some((answer) => !answer)) return null;
  const parsed = answers as Array<{ questionId: number; answer: string }>;
  return new Set(parsed.map(({ questionId }) => questionId)).size === parsed.length
    ? parsed
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function currentRevisionTokens(value: Record<string, unknown>, mode: NotesMode) {
  if (mode === "draft") {
    return { expectedMappingId: undefined, expectedPhaseRevision: undefined, confirmed: false };
  }
  const expectedMappingId = positiveInteger(value.expected_mapping_id);
  const expectedPhaseRevision = positiveInteger(value.expected_phase_revision);
  return expectedMappingId && expectedPhaseRevision && value.confirmed === true
    ? { expectedMappingId, expectedPhaseRevision, confirmed: true }
    : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const parsed = await authenticatedTarget(request, params);
  if (!parsed.ok) return parsed.response;
  const { session, target } = parsed;

  const access = await requireHolisticMentorshipAccess(session, "mapped_student_read", {
    schoolCode: target.schoolCode,
    studentId: target.studentId,
    academicYear: target.academicYear,
    programId: target.programId,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const detail = await getHolisticStudentPhase({
    studentId: target.studentId,
    phaseId: target.phaseId,
    schoolId: access.school!.id,
    programId: target.programId,
    academicYear: target.academicYear,
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
  { params }: { params: RouteParams }
) {
  const parsed = await authenticatedTarget(request, params);
  if (!parsed.ok) return parsed.response;
  const { session, target } = parsed;

  const value = await readJsonObject(request);
  if (!value) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }
  const mode = notesMode(value.action);
  if (!mode) return NextResponse.json({ error: "Invalid Notes" }, { status: 422 });
  const access = await requireHolisticMentorshipAccess(session, `notes_${mode}` as "notes_draft" | "notes_submit" | "notes_edit", {
    schoolCode: target.schoolCode,
    studentId: target.studentId,
    academicYear: target.academicYear,
    programId: target.programId,
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const expectedRevision = nonNegativeInteger(value.expected_revision);
  const answers = parseAnswers(value.answers);
  if (expectedRevision === null || !answers) {
    return NextResponse.json({ error: "Invalid Notes" }, { status: 422 });
  }
  const currentTokens = currentRevisionTokens(value, mode);
  if (!currentTokens) {
    return NextResponse.json({ error: "Current revisions and confirmation are required" }, { status: 422 });
  }

  const result = await saveHolisticNotes({
    mode,
    studentId: target.studentId,
    phaseId: target.phaseId,
    schoolId: access.school!.id,
    programId: target.programId,
    academicYear: target.academicYear,
    actorUserId: access.actorUserId!,
    expectedRevision,
    answers,
    ...currentTokens,
  });
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json({ error: result.error, currentRevision: result.currentRevision }, { status: result.status });
}
