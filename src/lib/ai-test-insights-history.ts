// AI Test Insights History (#576): a Student's History timeline, composed
// from the Session Notes module's submitted sessions and the Insight Request
// module's `completed` requests. Server-only (both read `@/lib/db`).
// Dependencies run one way: History → Session Notes and Insight Requests.
//
// Keyed by Student only: every academic year, every Teacher, whatever School
// or Program a row was recorded under. Drafts and requests in any other state
// never show. A request a submitted session records shows inside that
// session's entry only. The order is `orderTimeline`'s.
import { listCompletedRequests } from "@/lib/ai-test-insights-requests";
import { listSubmittedSessions } from "@/lib/ai-test-insights-session-notes";
import { orderTimeline, type TimelineEntry, type TimelineOrderItem } from "@/lib/ai-test-insights-timeline";

/**
 * The Student's History timeline, newest first. `callerUserId` is the acting
 * User of a caller who may write notes (null otherwise); `isAuthor` is true
 * only on that User's own sessions.
 */
export async function readTimeline(studentId: number, callerUserId: number | null): Promise<TimelineEntry[]> {
  const [sessions, completed] = await Promise.all([listSubmittedSessions(studentId), listCompletedRequests(studentId)]);
  const requestsById = new Map(completed.map(({ id, request }) => [id, request]));
  const recorded = new Set(sessions.map((session) => session.insightRequestId));

  const items: Array<TimelineOrderItem & { entry: TimelineEntry }> = [
    ...sessions.map((session) => ({
      kind: "session" as const,
      id: session.sessionId,
      sessionDate: session.sessionDate,
      submittedAt: session.submittedAt,
      entry: {
        kind: "session" as const,
        sessionId: session.sessionId,
        revision: session.revision,
        sessionDate: session.sessionDate,
        authorName: session.authorName,
        isAuthor: callerUserId !== null && session.authorUserId === callerUserId,
        areasOfConcern: session.areasOfConcern,
        immediateActions: session.immediateActions,
        otherNotes: session.otherNotes,
        lastEditedAt: session.lastEditedAt,
        testInsight: session.insightRequestId === null ? null : (requestsById.get(session.insightRequestId) ?? null),
      },
    })),
    ...completed
      .filter(({ id }) => !recorded.has(id))
      .map(({ id, request }) => ({
        kind: "test_insight" as const,
        id,
        requestedAt: request.requestedAt,
        entry: { kind: "test_insight" as const, testInsight: request },
      })),
  ];
  return orderTimeline(items).map((item) => item.entry);
}
