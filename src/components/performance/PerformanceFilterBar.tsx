"use client";

import type { ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { FullTestView, TestCategory } from "../PerformanceTab";

const STREAM_LABELS: Record<string, string> = {
  pcm: "PCM",
  pcb: "PCB",
  pcmb: "PCMB",
  engineering: "Engineering",
  medical: "Medical",
  foundation: "Foundation",
  clat: "CLAT",
  ca: "CA",
};

function streamLabel(canonical: string): string {
  return STREAM_LABELS[canonical] || canonical.charAt(0).toUpperCase() + canonical.slice(1);
}

// "All" options need a concrete value so the control always has a selection.
const ALL = "__all__";

interface Props {
  /** The Grade control, built by PerformanceTab because the deep dive reuses it. */
  gradeControl: ReactNode;
  selectedGrade: number | null;
  testCategory: TestCategory;
  fullTestView: FullTestView;
  selectedTestGrade: number | null;
  selectedStream: string | null;
  selectedSubject: string | null;
  availableTestGrades: number[];
  availableStreams: string[];
  availableSubjects: string[];
  /** 0 means "All test grades". */
  onTestGradeChange: (value: number) => void;
  onCategoryChange: (cat: TestCategory) => void;
  onStreamChange: (stream: string | null) => void;
  onSubjectChange: (subject: string | null) => void;
  onFullViewChange: (view: FullTestView) => void;
}

/**
 * The Performance tab's filters as one bordered row of uniform button groups:
 * Grade · Test grade · Test type · Stream, then Subject (chapter tests) or
 * View (full tests). Teachers missed the <select>s that used to sit between
 * pill rows (#326), so every filter now has the same shape. Purely
 * presentational — state and URL handling stay in PerformanceTab.
 */
export default function PerformanceFilterBar({
  gradeControl,
  selectedGrade,
  testCategory,
  fullTestView,
  selectedTestGrade,
  selectedStream,
  selectedSubject,
  availableTestGrades,
  availableStreams,
  availableSubjects,
  onTestGradeChange,
  onCategoryChange,
  onStreamChange,
  onSubjectChange,
  onFullViewChange,
}: Props) {
  return (
    <div className="rounded-xl border border-border bg-bg-card-alt/50 p-3 md:p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      {gradeControl}

      {/* Test Grade — the grade the test targets, which can differ from the
          students' grade (e.g. a grade-12 batch sitting an 11th-grade test).
          Options come from the loaded test set. */}
      {selectedGrade != null && availableTestGrades.length > 0 && (
        <SegmentedControl
          label="Test grade"
          options={[
            { value: 0, label: "All test grades" },
            ...availableTestGrades.map((g) => ({ value: g, label: String(g) })),
          ]}
          value={selectedTestGrade ?? 0}
          onChange={onTestGradeChange}
        />
      )}

      {selectedGrade != null && (
        <SegmentedControl<TestCategory>
          label="Test type"
          options={[
            { value: "chapter", label: "Chapter tests" },
            { value: "full", label: "Full tests" },
          ]}
          value={testCategory}
          onChange={onCategoryChange}
        />
      )}

      {selectedGrade != null && availableStreams.length > 0 && (
        <SegmentedControl
          label="Stream"
          options={[
            { value: ALL, label: "All" },
            ...availableStreams.map((st) => ({ value: st, label: streamLabel(st) })),
          ]}
          value={selectedStream ?? ALL}
          onChange={(v) => onStreamChange(v === ALL ? null : v)}
        />
      )}

      {/* Subject — Chapter Tests only */}
      {selectedGrade != null && testCategory === "chapter" && availableSubjects.length > 0 && (
        <SegmentedControl
          label="Subject"
          options={[
            { value: ALL, label: "All" },
            ...availableSubjects.map((sub) => ({ value: sub, label: sub })),
          ]}
          value={selectedSubject ?? ALL}
          onChange={(v) => onSubjectChange(v === ALL ? null : v)}
        />
      )}

      {/* Per Test / Cumulative — Full Tests only */}
      {selectedGrade != null && testCategory === "full" && (
        <SegmentedControl<FullTestView>
          label="View"
          options={[
            { value: "per_test", label: "Per test" },
            { value: "cumulative", label: "Cumulative" },
          ]}
          value={fullTestView}
          onChange={onFullViewChange}
        />
      )}
    </div>
  );
}
