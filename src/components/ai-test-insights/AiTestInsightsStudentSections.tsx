"use client";

// The cards of the AI Test Insights Student page (#550, physical centres
// only) around one read of the test picker route: the Student card's newest
// test line and the AI Summary card's picker show the same response, so the
// warehouse is read once. The cards in between (the performance card) come in
// as children. A failed read stays inside these two cards.
//
// Below the AI Summary card, a Teacher (feature access `edit`) gets the
// Session Notes section (#574), from the sessions route read with the page's
// `centre`; a viewer gets no Session Notes section. The AI Summary card
// reports the request it shows, and Session Notes links it at submit (#575).
// After a submit the page is refreshed from the server, so the Student card
// shows the new count and last Insight Session date with no manual reload.
//
// History (#576) follows, for everyone who can open the page (a viewer has
// no form, so it follows the AI Summary card). Session Notes and History
// share one read of the sessions route, read again after a submit, after
// "Reload notes", and when the AI Summary card's request becomes `completed`.
// History opens its Test Insights (#577) through the same requests route as
// the card, with the page's `centre`. The author's Edit in History (#578)
// saves through the session's edit route with the page's `centre`; after a
// save History reads the timeline again and the page is refreshed from the
// server, so the Student card's last Insight Session date moves. An edit
// leaves the Session Notes form and its draft as they are; while it holds
// unsaved changes the Session Notes leave guard asks before leaving.
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type ReactNode } from "react";

import AiTestInsightsHistory from "@/components/ai-test-insights/AiTestInsightsHistory";
import AiTestInsightsSessionNotes from "@/components/ai-test-insights/AiTestInsightsSessionNotes";
import AiTestInsightsStudentCard from "@/components/ai-test-insights/AiTestInsightsStudentCard";
import AiTestInsightsSummaryCard from "@/components/ai-test-insights/AiTestInsightsSummaryCard";
import { useAiTestInsightsSessions } from "@/hooks/use-ai-test-insights-sessions";
import { useFetchWithRetry } from "@/hooks/use-fetch-with-retry";
import {
  aiTestInsightsSessionDraftUrl,
  aiTestInsightsSessionsUrl,
  aiTestInsightsSessionUrl,
} from "@/lib/ai-test-insights-session-notes-rules";
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
  // An author's edit open in History holds unsaved changes; the Session Notes leave guard covers it.
  const [unsavedEdit, setUnsavedEdit] = useState(false);
  const router = useRouter();
  const sessionsUrl = aiTestInsightsSessionsUrl(studentId, centreId);
  const requestsUrl = aiTestInsightsRequestsUrl(studentId, centreId);
  const sessions = useAiTestInsightsSessions(sessionsUrl);
  const { reload: reloadSessions } = sessions;

  // A request that becomes `completed` in the card joins History, so History is read again.
  const reportedRequest = useRef(latestRequest);
  const onRequestChange = useCallback(
    (request: InsightRequestView | null) => {
      const before = reportedRequest.current;
      reportedRequest.current = request;
      setShownRequest(request);
      const newlyCompleted =
        request?.state === "completed" && !(before?.state === "completed" && before.requestKey === request.requestKey);
      if (newlyCompleted) reloadSessions();
    },
    [reloadSessions],
  );

  return (
    <>
      <AiTestInsightsStudentCard student={student} tests={state} />
      {children}
      <AiTestInsightsSummaryCard
        tests={state}
        canEdit={canEdit}
        onRetry={retry}
        requestsUrl={requestsUrl}
        initialRequest={latestRequest}
        onRequestChange={onRequestChange}
      />
      {canEdit && (
        <AiTestInsightsSessionNotes
          sessions={sessions}
          sessionsUrl={sessionsUrl}
          draftUrl={aiTestInsightsSessionDraftUrl(studentId, centreId)}
          openRequest={shownRequest}
          onSubmitted={() => {
            router.refresh();
            reloadSessions();
          }}
          unsavedEdit={unsavedEdit}
        />
      )}
      <AiTestInsightsHistory
        sessions={sessions}
        tests={state}
        requestsUrl={requestsUrl}
        sessionUrl={(sessionId) => aiTestInsightsSessionUrl(studentId, sessionId, centreId)}
        onEdited={() => router.refresh()}
        onUnsavedEditChange={setUnsavedEdit}
      />
    </>
  );
}
