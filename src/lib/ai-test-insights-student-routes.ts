// AI Test Insights (#550, #551): the opening every route of one Student
// shares (`/api/ai-test-insights/students/[studentId]/…`: Generate's create
// route and the Session Notes routes, the edit route of one session
// `…/sessions/[sessionId]` included). Server-only.
//
// Student access gates first, with the page's `centre`: 401 no session, 422
// bad id, 403 no `ai_test_insights` view, (a write: 403 access not `edit`,
// before any Student read), 404 Student missing, not listed or out of scope.
// A write then checks its body (422) and the acting User (409
// `no_linked_user`). A database error answers 500 and logs only the Student's
// `student.id` and the error name: a database message can quote values, and a
// request body is never logged.
import { NextResponse, type NextRequest } from "next/server";

import { actorUserId } from "@/lib/actor-user";
import {
  resolveAiTestInsightsStudentAccess,
  type AiTestInsightsActor,
  type AiTestInsightsStudentContext,
} from "@/lib/ai-test-insights-access";
import { errorName } from "@/lib/ai-test-insights-env";
import type { SessionNotesRefusal } from "@/lib/ai-test-insights-session-notes";
import {
  SESSION_NOTES_STALE_CODE,
  SESSION_NOTES_STALE_MESSAGE,
  type SessionNotesStaleResponse,
} from "@/lib/ai-test-insights-session-notes-rules";
import { NO_LINKED_USER_CODE } from "@/lib/ai-test-insights-shared";

/** A route's path values: the Student's id, and any the route's own path adds (as `sessionId`). */
type StudentRouteParams = { studentId: string };
type StudentRouteContext<P extends StudentRouteParams> = { params: Promise<P> };
type StudentRoute<P extends StudentRouteParams> = (request: NextRequest, context: StudentRouteContext<P>) => Promise<Response>;

/** What a route logs, and answers, when the database fails it. */
interface RouteFailure<P extends StudentRouteParams> {
  /** The start of the log line, as `AI Test Insights request create failed`. */
  log: string;
  /** The 500 answer's `error`. */
  message: string;
  headers?: HeadersInit;
  /** More ids for the log line, as `session=60`; never a body value. */
  logIds?: (params: P) => string;
}

/** The Student, as access resolved them, who is asking, and the route's path values. */
interface OpenedStudent<P extends StudentRouteParams> {
  student: AiTestInsightsStudentContext;
  actor: AiTestInsightsActor;
  params: P;
}

/** A write body: its value, or what is wrong with it (no value is echoed). */
export type ParsedBody<B> = { ok: true; value: B } | { ok: false; field?: string; error?: string };

/**
 * A route of one Student: Student access (a write also needs `edit`), then
 * `handle`, whose database errors answer 500 with `failure`.
 */
export function withAiTestInsightsStudent<P extends StudentRouteParams = StudentRouteParams>(
  failure: RouteFailure<P>,
  handle: (opened: OpenedStudent<P>, request: NextRequest) => Promise<Response>,
  options: { write?: boolean } = {},
): StudentRoute<P> {
  return async (request, context) => {
    const params = await context.params;
    const access = await resolveAiTestInsightsStudentAccess(params.studentId, {
      centre: request.nextUrl.searchParams.get("centre"),
      write: options.write,
    });
    if (!access.authorized) return access.response;

    try {
      return await handle({ student: access.student, actor: access.actor, params }, request);
    } catch (error) {
      const ids = failure.logIds ? ` ${failure.logIds(params)}` : "";
      console.error(`${failure.log}: student=${access.student.studentId}${ids} status=500 error=${errorName(error)}`);
      return NextResponse.json({ error: failure.message }, { status: 500, headers: failure.headers });
    }
  };
}

/**
 * A write of one Student: Student access as a write, then the body (422 with
 * the failing field, if any), then the acting User (part 1's shared lookup:
 * the linked User, else the User with the same email; none is 409
 * `no_linked_user`), then `handle`.
 */
export function withAiTestInsightsStudentWrite<B, P extends StudentRouteParams = StudentRouteParams>(
  failure: RouteFailure<P>,
  parseBody: (raw: unknown) => ParsedBody<B>,
  handle: (opened: OpenedStudent<P> & { body: B; actorUserId: number }) => Promise<Response>,
): StudentRoute<P> {
  return withAiTestInsightsStudent<P>(
    failure,
    async (opened, request) => {
      const parsed = parseBody(await request.json().catch(() => null));
      if (!parsed.ok) {
        return NextResponse.json(
          { error: parsed.error ?? "Invalid request body", ...(parsed.field ? { field: parsed.field } : {}) },
          { status: 422 },
        );
      }

      const actorUser = await actorUserId(opened.actor.email, opened.actor.linkedUserId);
      if (actorUser === null) {
        return NextResponse.json(
          { error: "Your login is not linked to a user record.", code: NO_LINKED_USER_CODE },
          { status: 409 },
        );
      }
      return handle({ ...opened, body: parsed.value, actorUserId: actorUser });
    },
    { write: true },
  );
}

/**
 * A Session Notes save the module refused: 409 `stale` with `currentRevision`
 * (another tab saved first), or 422 naming the failing field. No note text.
 */
export function sessionNotesRefusalResponse(refusal: SessionNotesRefusal): Response {
  if (refusal.outcome === "invalid") {
    return NextResponse.json({ error: refusal.error, field: refusal.field }, { status: 422 });
  }
  const stale: SessionNotesStaleResponse = {
    error: SESSION_NOTES_STALE_MESSAGE,
    code: SESSION_NOTES_STALE_CODE,
    currentRevision: refusal.currentRevision,
  };
  return NextResponse.json(stale, { status: 409 });
}
