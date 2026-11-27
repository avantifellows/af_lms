// The lines under one completed Test Insight (#564, #576): the tests it was
// made from, named from the page's test picker read ("an earlier test" for an
// id the picker does not hold), and who asked for it and when. The AI Summary
// card and the History timeline share it. Client-safe.
import {
  formatInsightRequestTime,
  insightTestNames,
  type AiTestInsightsTestsState,
  type InsightRequestView,
} from "@/lib/ai-test-insights-shared";

export default function TestInsightMadeBy({
  request,
  tests,
}: {
  request: InsightRequestView;
  tests: AiTestInsightsTestsState;
}) {
  return (
    <div className="space-y-1 text-xs text-text-muted">
      <p>Made from: {insightTestNames(request.selectedTestIds, tests)}</p>
      <p>
        Asked for by {request.requestedByName} on {formatInsightRequestTime(request.requestedAt)}
      </p>
    </div>
  );
}
