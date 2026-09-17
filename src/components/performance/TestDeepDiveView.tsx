"use client";

import type { ReactNode } from "react";
import TestDeepDive from "./TestDeepDive";
import CombinedReportPanel from "./CombinedReportPanel";
import type { PerformanceScope } from "./PerformanceContent";

interface Props {
  schoolUdise: string;
  grade: number;
  sessionId: string;
  /** Empty until the deep dive reports it — a session reached by URL arrives
   *  nameless, and the heading says "Loading..." until the data lands. */
  testName: string;
  scope: PerformanceScope;
  /** The Grade control, built by the tab because the overview needs it too. */
  gradeControl: ReactNode;
  onBack: () => void;
  onDataLoaded: (testName: string) => void;
}

/**
 * One test, in full: the way back first, then the title with the grade control
 * beside it, then the stats and the combined report.
 *
 * No filter bar — a test session is grade-specific, so changing grade returns
 * to the overview rather than re-filtering in place.
 */
export default function TestDeepDiveView({
  schoolUdise,
  grade,
  sessionId,
  testName,
  scope,
  gradeControl,
  onBack,
  onDataLoaded,
}: Props) {
  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 -ml-1 px-1 min-h-[44px] text-sm font-bold text-accent hover:text-accent-hover transition-colors rounded-lg"
      >
        <span aria-hidden="true" className="text-lg leading-none">&lsaquo;</span>
        Back to overview
      </button>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-text-primary">
          {testName || "Loading..."}
        </h2>
        {gradeControl}
      </div>
      <TestDeepDive
        schoolUdise={schoolUdise}
        grade={grade}
        sessionId={sessionId}
        program={scope.program}
        stream={scope.stream}
        onDataLoaded={onDataLoaded}
        afterStats={
          <CombinedReportPanel
            schoolUdise={schoolUdise}
            sessionId={sessionId}
            testName={testName}
            grade={grade}
            program={scope.program}
            stream={scope.stream}
          />
        }
      />
    </div>
  );
}
