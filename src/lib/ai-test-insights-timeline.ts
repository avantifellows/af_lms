// AI Test Insights History (#576): the timeline's entry shape and its order
// rule, shared by the server's History read and the Student page. Client-safe:
// keep server-only imports (`@/lib/db`, `@/lib/permissions`) out of this module.
import { insightRequestDateInIndia, type InsightRequestView } from "@/lib/ai-test-insights-shared";

/**
 * One entry of a Student's History timeline: a submitted Insight Session, with
 * the Test Insight it records, or a `completed` Test Insight no submitted
 * session records.
 */
export type TimelineEntry =
  | {
      kind: "session";
      sessionId: number;
      revision: number;
      /** `YYYY-MM-DD`. */
      sessionDate: string;
      /** The author's name, by the same rule as "Asked for by". */
      authorName: string;
      /** The caller is the author and may edit. */
      isAuthor: boolean;
      areasOfConcern: string;
      immediateActions: string;
      otherNotes: string | null;
      /** UTC ISO 8601: the newest `submitted_edited` audit row; null when never edited. */
      lastEditedAt: string | null;
      testInsight: InsightRequestView | null;
    }
  | { kind: "test_insight"; testInsight: InsightRequestView };

/** What the order rule reads of an entry: a session's or a request's id and times. */
export type TimelineOrderItem =
  | { kind: "session"; id: number; /** `YYYY-MM-DD`. */ sessionDate: string; /** UTC ISO. */ submittedAt: string }
  | { kind: "test_insight"; id: number; /** UTC ISO. */ requestedAt: string };

const dayOf = (item: TimelineOrderItem) =>
  item.kind === "session" ? item.sessionDate : insightRequestDateInIndia(item.requestedAt);
const momentOf = (item: TimelineOrderItem) => Date.parse(item.kind === "session" ? item.submittedAt : item.requestedAt);
const KIND_RANK = { session: 0, test_insight: 1 } as const;

/**
 * The History timeline's order, the one place it is decided: by day, newest
 * first (a session's `session_date`; a Test Insight's `requested_at` day in
 * India); within a day by moment, newest first (`submitted_at`,
 * `requested_at`); then sessions before Test Insights; then id descending.
 * Returns a new list.
 */
export function orderTimeline<T extends TimelineOrderItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const dayA = dayOf(a);
    const dayB = dayOf(b);
    if (dayA !== dayB) return dayA < dayB ? 1 : -1;
    const byMoment = momentOf(b) - momentOf(a);
    if (byMoment !== 0) return byMoment;
    if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    return b.id - a.id;
  });
}
