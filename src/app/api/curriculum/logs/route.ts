import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkCurriculumSchema } from "@/lib/curriculum-schema";
import { createCurriculumLog, getCurriculumLogs } from "@/lib/curriculum-logs";
import { getFeatureAccess, getResolvedPermission } from "@/lib/permissions";

type CurriculumSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

async function requireCurriculumAccess(
  session: CurriculumSession,
  mode: "view" | "edit"
) {
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

  const permission = await getResolvedPermission(session.user.email);
  const access = getFeatureAccess(permission, "curriculum");
  const allowed = mode === "view" ? access.canView : access.canEdit;
  if (!permission || !allowed) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, permission, email: session.user.email };
}

function requiredParams(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const schoolCode = searchParams.get("school_code")?.trim() || "";
  const programId = Number.parseInt(searchParams.get("program_id") || "", 10);
  const examTrack = searchParams.get("exam_track")?.trim() || "";
  const grade = Number.parseInt(searchParams.get("grade") || "", 10);
  const subject = searchParams.get("subject")?.trim() || "";

  if (!schoolCode || !Number.isFinite(programId) || !examTrack || !Number.isFinite(grade) || !subject) {
    return { ok: false as const };
  }

  return { ok: true as const, schoolCode, programId, examTrack, grade, subject };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumAccess(session, "view");
  if (!access.ok) return access.response;

  const schema = await checkCurriculumSchema();
  if (!schema.ok) {
    return NextResponse.json(schema, { status: schema.status });
  }

  const params = requiredParams(request);
  if (!params.ok) {
    return NextResponse.json(
      { error: "school_code, program_id, exam_track, grade, and subject are required" },
      { status: 400 }
    );
  }

  const result = await getCurriculumLogs({
    ...params,
    permission: access.permission,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ logs: result.logs });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumAccess(session, "edit");
  if (!access.ok) return access.response;

  const schema = await checkCurriculumSchema();
  if (!schema.ok) {
    return NextResponse.json(schema, { status: schema.status });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const schoolCode = typeof body.school_code === "string" ? body.school_code.trim() : "";
  const programId = Number(body.program_id);
  const examTrack = typeof body.exam_track === "string" ? body.exam_track.trim() : "";
  const grade = Number(body.grade);
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";

  if (!schoolCode || !Number.isFinite(programId) || !examTrack || !Number.isFinite(grade) || !subject) {
    return NextResponse.json(
      { error: "school_code, program_id, exam_track, grade, and subject are required" },
      { status: 400 }
    );
  }

  const durationMinutes =
    typeof body.duration_minutes === "number" ? body.duration_minutes : null;
  const logDate = typeof body.log_date === "string" ? body.log_date : null;

  const result = await createCurriculumLog({
    schoolCode,
    programId,
    examTrack,
    grade,
    subject,
    logDate,
    durationMinutes,
    topicIds: body.topic_ids,
    completeChapterIds: body.complete_chapter_ids,
    uncompleteChapterIds: body.uncomplete_chapter_ids,
    permission: access.permission,
    actorEmail: access.email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    { log: result.log, completions: result.completions },
    { status: result.createdLog ? 201 : 200 }
  );
}
