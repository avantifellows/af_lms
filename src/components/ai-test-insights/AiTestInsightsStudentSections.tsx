"use client";

// The cards of the AI Test Insights Student page (#550, physical centres
// only) around one read of the test picker route: the Student card's newest
// test line and the AI Summary card's picker show the same response, so the
// warehouse is read once. The cards in between (the performance card) come in
// as children. A failed read stays inside these two cards.
import { useCallback, useEffect, useState, type ReactNode } from "react";

import AiTestInsightsStudentCard from "@/components/ai-test-insights/AiTestInsightsStudentCard";
import AiTestInsightsSummaryCard from "@/components/ai-test-insights/AiTestInsightsSummaryCard";
import {
  aiTestInsightsTestsUrl,
  type AiTestInsightsStudentCardData,
  type AiTestInsightsTestsResponse,
  type AiTestInsightsTestsState,
} from "@/lib/ai-test-insights-shared";

async function readTests(response: Response): Promise<AiTestInsightsTestsState> {
  const body = (await response.json().catch(() => null)) as AiTestInsightsTestsResponse | null;
  if (response.ok && Array.isArray(body?.tests)) return { status: "loaded", tests: body.tests };
  return { status: "failed" };
}

/** Reads the picker route once, and again on each Retry; an unmount or a newer read drops an older answer. */
function useTests(url: string) {
  const [state, setState] = useState<AiTestInsightsTestsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    fetch(url, { signal: controller.signal })
      .then(readTests)
      .catch((): AiTestInsightsTestsState => ({ status: "failed" }))
      .then((next) => {
        if (current) setState(next);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [url, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}

export default function AiTestInsightsStudentSections({
  student,
  studentId,
  canEdit,
  children,
}: {
  student: AiTestInsightsStudentCardData;
  /** `student.id`. */
  studentId: number;
  /** Feature access is `edit`; a viewer sees the picker read-only. */
  canEdit: boolean;
  /** The cards between the Student card and the AI Summary card. */
  children?: ReactNode;
}) {
  const { state, retry } = useTests(aiTestInsightsTestsUrl(studentId));

  return (
    <>
      <AiTestInsightsStudentCard student={student} tests={state} />
      {children}
      <AiTestInsightsSummaryCard tests={state} canEdit={canEdit} onRetry={retry} />
    </>
  );
}
