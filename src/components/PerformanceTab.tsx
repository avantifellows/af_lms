"use client";

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import PerformanceFilterBar from "./performance/PerformanceFilterBar";
import PerformanceContent from "./performance/PerformanceContent";
import TestDeepDiveView from "./performance/TestDeepDiveView";
import ProgramTabs from "./performance/ProgramTabs";
import { performanceLoadState } from "./performance/PerformanceStates";
import { usePerformanceFilters } from "./performance/usePerformanceFilters";
import type { TestCategory, FullTestView } from "@/lib/performance-url-params";

interface Props {
  schoolUdise: string;
  // When set (centre pages), locks the program filter to this program name and
  // hides the program selector — the tab shows only this program's performance.
  lockedProgram?: string;
}

export type { TestCategory, FullTestView };

export default function PerformanceTab({ schoolUdise, lockedProgram }: Props) {
  // Held as one object rather than destructured: the tab reads two dozen of
  // these, and re-listing them here was literally a copy of the hook's return
  // shape — enough for the duplication check to flag the two as clones.
  const f = usePerformanceFilters({ schoolUdise, lockedProgram });

  // Failed / still loading / loaded-but-empty are genuine early exits; the
  // three of them live together in performanceLoadState, which hands back the
  // loaded lists on the ready path so the narrowing survives the extraction.
  const loadState = performanceLoadState({
    error: f.error,
    programs: f.programs,
    grades: f.grades,
  });
  if (loadState.status === "pending") return loadState.element;
  const { programs, grades } = loadState;

  const showProgramTabs = !lockedProgram && programs.length > 1;

  // Every filter is the same shape — a label and one joined button group —
  // because teachers missed the <select>s that used to sit between pill rows
  // (#326). Grade is built here because the deep dive shows it beside the title.
  const gradeControl = grades.length > 0 && (
    <SegmentedControl
      label="Grade"
      options={grades.map((g) => ({ value: g, label: String(g) }))}
      value={f.selectedGrade}
      onChange={f.handleGradeChange}
    />
  );

  // A multi-program school with no program chosen must not show any data —
  // including a deep dive reached by URL — since the queries would span programs.
  const needsProgram = showProgramTabs && !f.selectedProgram;

  // Deep dive: one test, full width, no filter bar. A session is grade-specific,
  // so changing grade returns to the overview rather than re-filtering here.
  if (f.deepDiveSession && f.selectedGrade != null && !needsProgram) {
    return (
      <TestDeepDiveView
        schoolUdise={schoolUdise}
        grade={f.selectedGrade}
        sessionId={f.deepDiveSession.sessionId}
        testName={f.deepDiveSession.testName}
        scope={f.scope}
        gradeControl={gradeControl}
        onBack={f.handleBack}
        onDataLoaded={f.handleDeepDiveData}
      />
    );
  }

  return (
    <div className="space-y-6">
      {showProgramTabs && (
        <ProgramTabs
          programs={programs}
          selected={f.selectedProgram}
          onChange={f.handleProgramChange}
        />
      )}

      <PerformanceFilterBar
        gradeControl={gradeControl}
        selectedGrade={f.selectedGrade}
        testCategory={f.testCategory}
        fullTestView={f.fullTestView}
        selectedTestGrade={f.selectedTestGrade}
        selectedStream={f.selectedStream}
        selectedSubject={f.selectedSubject}
        availableTestGrades={f.availableTestGrades}
        availableStreams={f.availableStreams}
        availableSubjects={f.availableSubjects}
        onTestGradeChange={f.handleTestGradeChange}
        onCategoryChange={f.handleCategoryChange}
        onStreamChange={f.handleStreamChange}
        onSubjectChange={f.handleSubjectChange}
        onFullViewChange={f.handleFullViewChange}
      />

      <PerformanceContent
        schoolUdise={schoolUdise}
        grade={f.selectedGrade}
        needsProgram={needsProgram}
        testCategory={f.testCategory}
        fullTestView={f.fullTestView}
        scope={f.scope}
        onTestClick={f.handleTestClick}
        onFilterOptions={f.handleFilterOptions}
      />
    </div>
  );
}
