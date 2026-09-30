import { NextRequest, NextResponse } from "next/server";

import { addHolisticFollowUpNote } from "@/lib/holistic-follow-up-notes";
import { normalizeHolisticFollowUpAnswers } from "@/lib/holistic-follow-up-questions";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import { readJsonObject } from "../../../../../route-helpers";
import { authenticatedTarget, type RouteParams } from "../student-phase-target";

// Follow-up Notes are immutable: this route only adds them.
export async function POST(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const parsed = await authenticatedTarget(request, params);
  if (!parsed.ok) return parsed.response;
  const { session, target } = parsed;

  const body = await readJsonObject(request);
  const rawAnswers = body?.answers;
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }
  const access = await requireHolisticMentorshipAccess(session, "follow_up_note_add", {
    schoolCode: target.schoolCode,
    studentId: target.studentId,
    academicYear: target.academicYear,
    programId: target.programId,
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const normalized = normalizeHolisticFollowUpAnswers(rawAnswers as Record<string, unknown>);
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 422 });

  const result = await addHolisticFollowUpNote({
    studentId: target.studentId,
    phaseId: target.phaseId,
    schoolId: access.school!.id,
    programId: target.programId,
    academicYear: target.academicYear,
    actorUserId: access.actorUserId!,
    actorEmail: access.email,
    answers: normalized.answers,
  });
  return result.ok
    ? NextResponse.json({ followUpNote: result.followUpNote }, { status: 201 })
    : NextResponse.json({ error: result.error }, { status: result.status });
}
