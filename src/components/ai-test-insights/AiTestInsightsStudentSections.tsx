"use client";

// The cards of the AI Test Insights Student page (#550, physical centres
// only) around one read of the test picker route: the Student card's newest
// test line and the AI Summary card's picker show the same response, so the
// warehouse is read once. The cards in between (the performance card) come in
// as children. A failed read stays inside these two cards.
//
// Below the AI Summary card, a Teacher (feature access `edit`) gets the
// Session Notes section (#574), which reads the history route with the page's
// `centre`; a viewer gets no Session Notes section. The AI Summary card
// reports the request it shows, and Session Notes links it at submit (#575).
// After a submit the page is refreshed from the server, so the Student card
// shows the new count and last Insight Session date with no manual reload.
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import AiTestInsightsSessionNotes from "@/components/ai-test-insights/AiTestInsightsSessionNotes";
import AiTestInsightsStudentCard from "@/components/ai-test-insights/AiTestInsightsStudentCard";
import AiTestInsightsSummaryCard from "@/components/ai-test-insights/AiTestInsightsSummaryCard";
import { useFetchWithRetry } from "@/hooks/use-fetch-with-retry";
import { aiTestInsightsSessionDraftUrl, aiTestInsightsSessionsUrl } from "@/lib/ai-test-insights-session-notes-rules";
import {
  aiTestInsightsRequestsUrl,
  aiTestInsightsTestsUrl,
  type AiTestInsightsStudentCardData,
  type AiTestInsightsTestsResponse,
  type AiTestInsightsTestsState,
  type InsightRequestView,
} from "@/lib/ai-test-insights-shared";

async function readTests(response: Response): Promise<AiTestInsightsTestsState> {
  const body = (await response.json().catch(() => null)) as AiTestInsightsTestsResponse | null;
  if (response.ok && Array.isArray(body?.tests)) return { status: "loaded", tests: body.tests };
  return { status: "failed" };
}

export default function AiTestInsightsStudentSections({
  student,
  studentId,
  canEdit,
  centreId = null,
  latestRequest = null,
  children,
}: {
  student: AiTestInsightsStudentCardData;
  /** `student.id`. */
  studentId: number;
  /** Feature access is `edit`; a viewer sees the picker read-only and no Generate. */
  canEdit: boolean;
  /** The centre the page named, when it lists the Student; Generate and a new draft record its School and Program. */
  centreId?: number | null;
  /** The Student's latest Insight Request, read on the server. */
  latestRequest?: InsightRequestView | null;
  /** The cards between the Student card and the AI Summary card. */
  children?: ReactNode;
}) {
  // Reads the picker route once, and again on each Retry; an unmount or a newer read drops an older answer.
  const { state, retry } = useFetchWithRetry(aiTestInsightsTestsUrl(studentId), readTests);
  // The request the AI Summary card shows: the page's latest until the card reports.
  const [shownRequest, setShownRequest] = useState<InsightRequestView | null>(latestRequest);
  const router = useRouter();

  return (
    <>
      <AiTestInsightsStudentCard student={student} tests={state} />
      {children}
      <AiTestInsightsSummaryCard
        tests={state}
        canEdit={canEdit}
        onRetry={retry}
        requestsUrl={aiTestInsightsRequestsUrl(studentId, centreId)}
        initialRequest={latestRequest}
        onRequestChange={setShownRequest}
      />
      {canEdit && (
        <AiTestInsightsSessionNotes
          sessionsUrl={aiTestInsightsSessionsUrl(studentId, centreId)}
          draftUrl={aiTestInsightsSessionDraftUrl(studentId, centreId)}
          openRequest={shownRequest}
          onSubmitted={() => router.refresh()}
        />
      )}
    </>
  );
}
