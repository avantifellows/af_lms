"use client";

import BatchOverview from "./BatchOverview";
import CumulativeALTable from "./CumulativeALTable";
import { PerformanceNotice } from "./PerformanceStates";
import type { TestCategory, FullTestView } from "@/lib/performance-url-params";

/** The filter scope every data component below the tab is given. Narrowed from
 *  the tab's nullable state to undefined once, so no call site has to. */
export interface PerformanceScope {
  program?: string;
  stream?: string;
  subject?: string;
  testGrade?: number;
}

interface Props {
  schoolUdise: string;
  grade: number | null;
  /** A multi-program school with nothing chosen: the queries would span
   *  programs, so nothing is shown until one is picked. */
  needsProgram: boolean;
  testCategory: TestCategory;
  fullTestView: FullTestView;
  scope: PerformanceScope;
  onTestClick: (sessionId: string, testName: string) => void;
  onFilterOptions: (opts: {
    streams: string[];
    subjects: string[];
    testGrades: number[];
  }) => void;
}

/**
 * Picks what sits below the filter bar: a prompt, the cumulative AL matrix, or
 * the per-test overview. Was a four-armed nested ternary inside PerformanceTab;
 * as flat early returns the same decision reads top-to-bottom.
 */
export default function PerformanceContent({
  schoolUdise,
  grade,
  needsProgram,
  testCategory,
  fullTestView,
  scope,
  onTestClick,
  onFilterOptions,
}: Props) {
  if (needsProgram) {
    return <PerformanceNotice>Select a program to view performance data.</PerformanceNotice>;
  }

  if (grade == null) {
    return <PerformanceNotice>Select a grade to view performance data.</PerformanceNotice>;
  }

  if (testCategory === "full" && fullTestView === "cumulative") {
    return (
      <CumulativeALTable
        schoolUdise={schoolUdise}
        grade={grade}
        program={scope.program}
        stream={scope.stream}
        testGrade={scope.testGrade}
      />
    );
  }

  return (
    <BatchOverview
      schoolUdise={schoolUdise}
      grade={grade}
      testCategory={testCategory}
      program={scope.program}
      stream={scope.stream}
      subject={scope.subject}
      testGrade={scope.testGrade}
      onTestClick={onTestClick}
      onFilterOptions={onFilterOptions}
    />
  );
}
