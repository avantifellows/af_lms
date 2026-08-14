import { NextRequest, NextResponse } from "next/server";
import {
  requireCurriculumEditBody,
  requireCurriculumScopeRequest,
} from "@/lib/curriculum-api";
import { createCurriculumLog, getCurriculumLogs } from "@/lib/curriculum-logs";
import { parseCurriculumRouteScope } from "@/lib/curriculum-route-scope";

export async function GET(request: NextRequest) {
  const access = await requireCurriculumScopeRequest(request);
  if (!access.ok) return access.response;

  const result = await getCurriculumLogs({
    ...access.scope,
    permission: access.permission,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ logs: result.logs });
}

export async function POST(request: NextRequest) {
  const access = await requireCurriculumEditBody(request);
  if (!access.ok) return access.response;
  const { body } = access;

  const scope = parseCurriculumRouteScope(body);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: 400 });
  }

  const durationMinutes =
    body.duration_minutes == null
      ? null
      : typeof body.duration_minutes === "number"
        ? body.duration_minutes
        : Number.NaN;
  const logDate = typeof body.log_date === "string" ? body.log_date : null;

  const result = await createCurriculumLog({
    ...scope.value,
    logType: body.log_type,
    logDate,
    durationMinutes,
    chapterId: body.chapter_id,
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
