"use client";

import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/Card";
import StatCard from "../StatCard";
import type { BatchOverviewData, TestTrendPoint } from "@/types/quiz";
import type { TestCategory } from "../PerformanceTab";

const CHAPTER_FORMATS = ["chapter_test", "combined_chapter_test", "homework"];

function isChapterTest(format: string | null): boolean {
  return format != null && CHAPTER_FORMATS.includes(format.toLowerCase());
}

interface Props {
  schoolUdise: string;
  grade: number;
  testCategory: TestCategory;
  program?: string;
  stream?: string;
  subject?: string;
  onTestClick: (sessionId: string, testName: string) => void;
  onFilterOptions?: (opts: { streams: string[]; subjects: string[] }) => void;
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
  onTestClick,
  onFilterOptions,
}: Props) {
  const [data, setData] = useState<BatchOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setData(null);

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
      .then((d: BatchOverviewData) => setData(d))
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [schoolUdise, grade, program, stream]);

  // Compute available subjects from the loaded test set, scoped to the current
  // test category (chapter vs full). Streams come straight from the API.
  const filterOptions = useMemo(() => {
    if (!data) return { streams: [], subjects: [] };
    const subjectSet = new Set<string>();
    for (const t of data.tests) {
      const isChapter = isChapterTest(t.test_format);
      if (testCategory === "chapter" ? !isChapter : isChapter) continue;
      for (const s of t.subjects || []) subjectSet.add(s);
    }
    return {
      streams: data.streams || [],
      subjects: [...subjectSet].sort(),
    };
  }, [data, testCategory]);

  // Notify parent of available filter values so it can render the filter pills.
  // PerformanceTab wraps `onFilterOptions` in useCallback so this effect only
  // fires when the option set actually changes.
  useEffect(() => {
    onFilterOptions?.(filterOptions);
  }, [filterOptions, onFilterOptions]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[30vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
        <span className="ml-3 text-sm text-text-secondary">Loading batch overview...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-danger-bg border border-danger text-danger rounded-lg">
        {error}
      </div>
    );
  }

  if (!data || data.tests.length === 0) {
    return (
      <div className="p-8 text-center bg-bg-card-alt border border-border rounded-lg shadow-sm">
        <p className="text-sm text-text-muted">No quiz data available for this grade yet.</p>
      </div>
    );
  }

  const { totalEnrolled, enrolledByStream } = data;

  const tests = data.tests.filter((t) => {
    const isChapter = isChapterTest(t.test_format);
    if (testCategory === "chapter" ? !isChapter : isChapter) return false;
    if (testCategory === "chapter" && subject) {
      if (!(t.subjects || []).includes(subject)) return false;
    }
    return true;
  });

  if (tests.length === 0) {
    return (
      <div className="p-8 text-center bg-bg-card-alt border border-border rounded-lg shadow-sm">
        <p className="text-sm text-text-muted">
          No {testCategory === "chapter" ? "chapter" : "full"} tests
          {subject ? ` for ${subject}` : ""}
          {stream ? ` for the selected stream` : ""}
          {" "}available for this grade yet.
        </p>
      </div>
    );
  }

  const avgAttendance = Math.round(
    tests.reduce((s, t) => s + (t.test_stream ? t.stream_student_count : t.student_count), 0) / tests.length
  );

  return (
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
