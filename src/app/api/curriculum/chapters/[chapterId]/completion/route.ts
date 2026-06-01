import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkCurriculumSchema } from "@/lib/curriculum-schema";
import { withTransaction } from "@/lib/db";
import {
  markChapterComplete,
  unmarkChapterComplete,
  validateChapterCompletionDeltas,
} from "@/lib/curriculum-chapter-completion";
import { getFeatureAccess, getUserPermission } from "@/lib/permissions";

type CurriculumSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

async function requireCurriculumEditAccess(session: CurriculumSession) {
  if (!session?.user?.email) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.isPasscodeUser) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const permission = await getUserPermission(session.user.email);
  const access = getFeatureAccess(permission, "curriculum");
  if (!permission || !access.canEdit) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, permission, email: session.user.email };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ chapterId: string }> }
) {
  const { chapterId: rawChapterId } = await params;
  const chapterId = Number.parseInt(rawChapterId, 10);
  if (!Number.isInteger(chapterId) || chapterId <= 0) {
    return NextResponse.json({ error: "Invalid chapter id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await requireCurriculumEditAccess(session);
  if (!access.ok) return access.response;

  const schema = await checkCurriculumSchema();
  if (!schema.ok) {
    return NextResponse.json(schema, { status: schema.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

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
