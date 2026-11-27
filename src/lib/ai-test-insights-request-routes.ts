// AI Test Insights (#550): the opening every route of one Insight Request
// shares (`/api/ai-test-insights/students/[studentId]/requests/[requestKey]`,
// and its `summary` and `pdf`). Server-only.
//
// Student access gates first, as a read, with the page's `centre`: 401 no
// session, 422 bad id, 403 no `ai_test_insights` view, 404 Student missing,
// not listed or out of scope. Then the request by its key, which must be that
// Student's; otherwise the route's own 404.
import { NextResponse, type NextRequest } from "next/server";

import { resolveAiTestInsightsStudentAccess, type AiTestInsightsStudentContext } from "@/lib/ai-test-insights-access";
import { requestByKey } from "@/lib/ai-test-insights-requests";
import { NOT_CONFIGURED_CODE, type InsightRequestView } from "@/lib/ai-test-insights-shared";

/** The AI Summary text and PDF answers are never cached. */
export const NO_STORE = { "Cache-Control": "no-store" };

type InsightRequestRouteContext = { params: Promise<{ studentId: string; requestKey: string }> };
type InsightRequestHandler = (
  found: InsightRequestView,
  student: AiTestInsightsStudentContext,
  request: NextRequest,
) => Promise<Response>;
type InsightRequestRoute = (request: NextRequest, context: InsightRequestRouteContext) => Promise<Response>;

/** The Student access refusal, or the Student and their request (null when the key is not theirs). */
async function openInsightRequest(
  request: NextRequest,
  params: InsightRequestRouteContext["params"],
): Promise<Response | { student: AiTestInsightsStudentContext; found: InsightRequestView | null }> {
  const { studentId, requestKey } = await params;
  const access = await resolveAiTestInsightsStudentAccess(studentId, {
    centre: request.nextUrl.searchParams.get("centre"),
  });
  if (!access.authorized) return access.response;
  return { student: access.student, found: await requestByKey(access.student.studentId, requestKey) };
}

/** A GET of one Insight Request in any state; 404 `notFoundError` when the key is not the Student's. */
export function withInsightRequest(notFoundError: string, handle: InsightRequestHandler): InsightRequestRoute {
  return async (request, { params }) => {
    const opened = await openInsightRequest(request, params);
    if (opened instanceof Response) return opened;
    if (!opened.found) return NextResponse.json({ error: notFoundError }, { status: 404 });
    return handle(opened.found, opened.student, request);
  };
}

/**
 * A GET of a file of one `completed` Insight Request, never cached: 404
 * `notFoundError` when the key is not the Student's or the request is not
 * `completed`.
 */
export function withCompletedInsightRequest(notFoundError: string, handle: InsightRequestHandler): InsightRequestRoute {
  return async (request, { params }) => {
    const opened = await openInsightRequest(request, params);
    if (opened instanceof Response) return opened;
    if (!opened.found || opened.found.state !== "completed") {
      return NextResponse.json({ error: notFoundError }, { status: 404, headers: NO_STORE });
    }
    return handle(opened.found, opened.student, request);
  };
}

/** The 503 when this environment has no AI Summary reading settings. */
export function readingNotConfigured(): NextResponse {
  return NextResponse.json(
    { error: "AI Summary reading is not configured", code: NOT_CONFIGURED_CODE },
    { status: 503, headers: NO_STORE },
  );
}
