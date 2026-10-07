"use client";

import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/Card";
import StatCard from "../StatCard";
import type { BatchOverviewData, TestTrendPoint } from "@/types/quiz";
import type { TestCategory } from "../PerformanceTab";
import { RetainedHeightFrame } from "./PerformanceStates";

const CHAPTER_FORMATS = ["chapter_test", "combined_chapter_test", "homework"];

function isChapterTest(format: string | null): boolean {
  return format != null && CHAPTER_FORMATS.includes(format.toLowerCase());
}

/**
 * The tests the overview lists. NVS lists every returned test — the server has
 * already narrowed them to System-wide Mandated Tests, which cut across the
 * chapter/full split and test grades. Everyone else gets the category split
 * plus the subject (chapter only) and test-grade filters.
 */
function listedTests(
  tests: TestTrendPoint[],
  {
    isNvs,
    testCategory,
    subject,
    testGrade,
  }: { isNvs?: boolean; testCategory: TestCategory; subject?: string; testGrade?: number }
): TestTrendPoint[] {
  if (isNvs) return tests;
  return tests.filter((t) => {
    const isChapter = isChapterTest(t.test_format);
    if (testCategory === "chapter" ? !isChapter : isChapter) return false;
    if (testCategory === "chapter" && subject) {
      if (!(t.subjects || []).includes(subject)) return false;
    }
    if (testGrade != null && t.test_grade !== testGrade) return false;
    return true;
  });
}

/** Copy for an overview with nothing to list — either no tests came back at
 *  all, or the filters left none. NVS reads the same either way. */
function emptyStateCopy({
  isNvs,
  hasData,
  testCategory,
  subject,
  stream,
  testGrade,
}: {
  isNvs?: boolean;
  hasData: boolean;
  testCategory: TestCategory;
  subject?: string;
  stream?: string;
  testGrade?: number;
}): string {
  if (isNvs) return "No system-wide mandated tests yet for this grade/stream";
  if (!hasData) return "No quiz data available for this grade yet.";
  return [
    `No ${testCategory === "chapter" ? "chapter" : "full"} tests`,
    subject ? ` for ${subject}` : "",
    stream ? ` for the selected stream` : "",
    testGrade != null ? ` targeting grade ${testGrade}` : "",
    " available for this grade yet.",
  ].join("");
}

function EmptyOverview({ children }: { children: string }) {
  return (
    <div className="p-8 text-center bg-bg-card-alt border border-border rounded-lg shadow-sm">
      <p className="text-sm text-text-muted">{children}</p>
    </div>
  );
}

interface Props {
  schoolUdise: string;
  grade: number;
  testCategory: TestCategory;
  program?: string;
  stream?: string;
  subject?: string;
  testGrade?: number;
  /** JNV NVS: list every (mandated) test, with no format split or filters. */
  isNvs?: boolean;
  onTestClick: (sessionId: string, testName: string) => void;
  onFilterOptions?: (opts: {
    streams: string[];
    subjects: string[];
    testGrades: number[];
  }) => void;
}

function TestCard({
  test,
  enrolledByStream,
  onClick,
}: {
  test: TestTrendPoint;
  enrolledByStream: Record<string, number>;
  onClick: () => void;
}) {
  // Use stream-matched enrolled count for attendance %
  const streamEnrolled = test.test_stream ? enrolledByStream[test.test_stream] : null;
  const attendanceCount = test.test_stream ? test.stream_student_count : test.student_count;
  const participationPct =
    streamEnrolled && streamEnrolled > 0
      ? Math.round((attendanceCount / streamEnrolled) * 100)
      : null;

  return (
    <Card
      elevation="sm"
      onClick={onClick}
      className="p-4 cursor-pointer transition-colors hover:border-accent/50 hover:bg-hover-bg"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-text-primary truncate">
            {test.test_name}
          </h4>
          <p className="text-xs text-text-muted">{test.start_date}</p>
        </div>
        <span className="text-xs font-bold uppercase tracking-wide text-accent shrink-0 ml-2">
          Details &rarr;
        </span>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-text-muted">Attendance</p>
        <p className="font-bold font-mono text-lg text-text-primary">
          {attendanceCount}
          {participationPct != null && (
            <span className="text-xs font-normal ml-1 font-mono text-text-secondary">
              ({participationPct}% of enrolled)
            </span>
          )}
        </p>
      </div>
    </Card>
  );
}

export default function BatchOverview({
  schoolUdise,
  grade,
  testCategory,
  program,
  stream,
  subject,
  testGrade,
  isNvs,
  onTestClick,
  onFilterOptions,
}: Props) {
  // Each answer is tagged with the request it belongs to. Once the filters move
  // on, a late success or failure for the old request is never shown, and the
  // new request starts loading with no stale data or error.
  const requestKey = [schoolUdise, grade, program ?? "", stream ?? ""].join("|");
  const [result, setResult] = useState<{
    key: string;
    data?: BatchOverviewData;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();

    const programParam = program ? `&program=${encodeURIComponent(program)}` : "";
    const streamParam = stream ? `&stream=${encodeURIComponent(stream)}` : "";
    fetch(
      `/api/quiz-analytics/${schoolUdise}/batch-overview?grade=${grade}${programParam}${streamParam}`,
      {
        signal: controller.signal,
      }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch batch overview");
        return res.json();
      })
      .then((d: BatchOverviewData) => {
        if (current) setResult({ key: requestKey, data: d });
      })
      .catch((err) => {
        if (current && err.name !== "AbortError") setResult({ key: requestKey, error: err.message });
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps -- requestKey encodes every input

  const settled = result?.key === requestKey ? result : null;
  const loading = settled === null;
  const error = settled?.error ?? null;
  const data = settled?.data ?? null;

  // Compute available subjects from the loaded test set, scoped to the current
  // test category (chapter vs full). Streams come straight from the API.
  const filterOptions = useMemo(() => {
    if (!data) return { streams: [], subjects: [], testGrades: [] };
    const subjectSet = new Set<string>();
    const testGradeSet = new Set<number>();
    for (const t of data.tests) {
      const isChapter = isChapterTest(t.test_format);
      if (testCategory === "chapter" ? !isChapter : isChapter) continue;
      for (const s of t.subjects || []) subjectSet.add(s);
      if (t.test_grade != null) testGradeSet.add(t.test_grade);
    }
    return {
      streams: data.streams || [],
      subjects: [...subjectSet].sort(),
      testGrades: [...testGradeSet].sort((a, b) => a - b),
    };
  }, [data, testCategory]);

  // Notify parent of available filter values so it can render the filter pills.
  // PerformanceTab wraps `onFilterOptions` in useCallback so this effect only
  // fires when the option set actually changes.
  useEffect(() => {
    onFilterOptions?.(filterOptions);
  }, [filterOptions, onFilterOptions]);

  let content: React.ReactNode;
  if (loading) {
    content = (
      <div className="flex justify-center items-center h-[30vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
        <span className="ml-3 text-sm text-text-secondary">Loading batch overview...</span>
      </div>
    );
  } else if (error) {
    content = (
      <div className="p-4 bg-danger-bg border border-danger text-danger rounded-lg">
        {error}
      </div>
    );
  } else {
    const allTests = data?.tests ?? [];
    const tests = listedTests(allTests, { isNvs, testCategory, subject, testGrade });
    if (!data || tests.length === 0) {
      content = (
      <EmptyOverview>
        {emptyStateCopy({ isNvs, hasData: allTests.length > 0, testCategory, subject, stream, testGrade })}
      </EmptyOverview>
      );
    } else {
      const { totalEnrolled, enrolledByStream } = data;
      const avgAttendance = Math.round(
        tests.reduce((s, t) => s + (t.test_stream ? t.stream_student_count : t.student_count), 0) / tests.length
      );
      content = (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            <StatCard label="Tests Conducted" value={tests.length} color="brand-coral" />
            <StatCard label="Avg Attendance" value={avgAttendance} color="brand-amber" />
            {totalEnrolled != null && (
              <StatCard label="Total Enrolled" value={totalEnrolled} color="brand-gold" />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
            {[...tests].reverse().map((t) => (
              <TestCard
                key={t.session_id}
                test={t}
                enrolledByStream={enrolledByStream}
                onClick={() => onTestClick(t.session_id, t.test_name)}
              />
            ))}
          </div>
        </div>
      );
    }
  }

  return (
    <RetainedHeightFrame loading={loading} testId="batch-overview-frame">
      {content}
    </RetainedHeightFrame>
  );
}
