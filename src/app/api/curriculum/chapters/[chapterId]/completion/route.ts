import { NextRequest, NextResponse } from "next/server";
import {
  parsePositiveInteger,
  requireCurriculumEditBody,
} from "@/lib/curriculum-api";
import { withTransaction } from "@/lib/db";
import {
  markChapterComplete,
  unmarkChapterComplete,
  validateChapterCompletionDeltas,
} from "@/lib/curriculum-chapter-completion";
import { validateCentreExamTrackMapping } from "@/lib/centre-resolver";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ chapterId: string }> }
) {
  const { chapterId: rawChapterId } = await params;
  const chapterId = parsePositiveInteger(rawChapterId);
  if (chapterId === null) {
    return NextResponse.json({ error: "Invalid chapter id" }, { status: 400 });
  }

  const access = await requireCurriculumEditBody(request);
  if (!access.ok) return access.response;
  const { body } = access;

  const schoolCode = typeof body.school_code === "string" ? body.school_code.trim() : "";
  const programId = Number(body.program_id);
  const examTrack = typeof body.exam_track === "string" ? body.exam_track.trim() : "";
  const grade = Number(body.grade);
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const completed = body.completed;

  if (
    !schoolCode ||
    !Number.isFinite(programId) ||
    !examTrack ||
    !Number.isFinite(grade) ||
    !subject ||
    typeof completed !== "boolean"
  ) {
    return NextResponse.json(
      {
        error:
          "school_code, program_id, exam_track, grade, subject, and completed are required",
      },
      { status: 400 }
    );
  }

  const validation = await validateChapterCompletionDeltas({
    schoolCode,
    programId,
    examTrack,
    grade,
    subject,
    completeChapterIds: completed ? [chapterId] : [],
    uncompleteChapterIds: completed ? [] : [chapterId],
    permission: access.permission,
  });
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.status }
    );
  }

  const mapping = await validateCentreExamTrackMapping({
    schoolCode,
    programId,
    grade: validation.grade,
    examTrack: validation.examTrack,
  });
  if (!mapping.ok) {
    return NextResponse.json({ error: mapping.error }, { status: 422 });
  }

  const result = await withTransaction((client) =>
    completed
      ? markChapterComplete(client, {
          schoolCode,
          programId,
          chapterId,
          examTrack: validation.examTrack,
          actorEmail: access.email,
        })
      : unmarkChapterComplete(client, {
          schoolCode,
          programId,
          chapterId,
          examTrack: validation.examTrack,
          actorEmail: access.email,
        })
  );

  return NextResponse.json(result);
}
