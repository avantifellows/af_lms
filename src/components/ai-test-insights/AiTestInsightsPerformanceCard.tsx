"use client";

// The performance card on the AI Test Insights Student page (#550, physical
// centres only), so a Teacher can check an AI Summary against the numbers. It
// reads the existing Student Report endpoint and draws that report's score
// graph and per-test table, nothing else: no chapter sections, no
// predicted-level header, no new chart. Every test the report lists shows,
// Part tests and missed ones included. Its failures stay inside the card.
import { useCallback, useEffect, useState } from "react";

import { Button, Card } from "@/components/ui";
import { ScoreGraph } from "@/components/performance/student-support/chips";
import { TestHistory } from "@/components/performance/student-support/StudentReport";
import type { StudentReportData } from "@/types/student-support";

type LoadState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "no_results" }
  | { status: "loaded"; report: StudentReportData };

/** The endpoint's 404 when the warehouse has no row for the Student in this Grade and Program. */
const STUDENT_NOT_FOUND = /^Student not found/;

/** The card's state once the response to `url` is read. */
async function readReport(response: Response): Promise<LoadState> {
  const body = await response.json().catch(() => null);
  if (response.ok && body) return { status: "loaded", report: body as StudentReportData };
  if (response.status === 404 && STUDENT_NOT_FOUND.test(String(body?.error ?? ""))) return { status: "no_results" };
  return { status: "failed" };
}

/** `url` null: there is nothing to ask for, so no test results. Asks once,
 *  and again on each Retry; an unmount or a newer ask drops an older answer. */
function useStudentReport(url: string | null) {
  const [state, setState] = useState<LoadState>(url ? { status: "loading" } : { status: "no_results" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let current = true;
    fetch(url, { signal: controller.signal })
      .then(readReport)
      .catch((): LoadState => ({ status: "failed" }))
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

function CardBody({ state, retry }: { state: LoadState; retry: () => void }) {
  if (state.status === "loading") {
    return <p className="py-6 text-center text-sm text-text-muted">Loading test results…</p>;
  }
  if (state.status === "no_results") {
    return <p className="py-6 text-center text-sm text-text-muted">No test results yet</p>;
  }
  if (state.status === "failed") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger bg-danger-bg p-4">
        <p className="text-sm text-text-primary">Test results could not be loaded. Please try again.</p>
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Score graph</span>
        <ScoreGraph trend={state.report.student.trend} />
      </div>
      <TestHistory tests={state.report.tests} />
    </div>
  );
}

export default function AiTestInsightsPerformanceCard({
  schoolUdise,
  grade,
  program,
  uid,
}: {
  /** The School's UDISE code, which the warehouse keys results by (its code when it has none). */
  schoolUdise: string;
  grade: number;
  /** The Program label, as the Performance tab sends it; null for a Program with no label, which has no results. */
  program: string | null;
  /** The Student's `user.id`. */
  uid: string;
}) {
  const url =
    program === null
      ? null
      : `/api/quiz-analytics/${encodeURIComponent(schoolUdise)}/student-report?${new URLSearchParams({
          grade: String(grade),
          program,
          student: uid,
        })}`;
  const { state, retry } = useStudentReport(url);

  return (
    <section aria-label="Performance">
      <Card elevation="sm" className="p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-text-primary">Performance</h2>
        <CardBody state={state} retry={retry} />
      </Card>
    </section>
  );
}
