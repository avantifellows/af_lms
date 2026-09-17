"use client";

import { useState, useEffect, type ReactNode } from "react";
import StatCard from "../StatCard";
import SubjectAnalysisSection from "./SubjectAnalysisSection";
import ChapterAnalysisSection from "./ChapterAnalysisSection";
import StudentResultsTable from "./StudentResultsTable";
import type { TestDeepDiveData } from "@/types/quiz";

interface Props {
  schoolUdise: string;
  grade: number;
  sessionId: string;
  program?: string;
  stream?: string;
  onDataLoaded?: (testName: string) => void;
  /** Rendered between the stat cards and the subject analysis — the combined
   *  reports panel lives there so the headline numbers stay first. The title
   *  and the way back are the parent's (PerformanceTab), above this component. */
  afterStats?: ReactNode;
}

export default function TestDeepDive({
  schoolUdise,
  grade,
  sessionId,
  program,
  stream,
  onDataLoaded,
  afterStats,
}: Props) {
  const [data, setData] = useState<TestDeepDiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);

    const programParam = program ? `&program=${encodeURIComponent(program)}` : "";
    const streamParam = stream ? `&stream=${encodeURIComponent(stream)}` : "";
    fetch(
      `/api/quiz-analytics/${schoolUdise}/test-deep-dive?grade=${grade}&sessionId=${encodeURIComponent(sessionId)}${programParam}${streamParam}`,
      { signal: controller.signal }
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Failed to fetch test details");
        }
        return res.json();
      })
      .then((d: TestDeepDiveData) => {
        setData(d);
        if (onDataLoaded && d.summary.test_name) {
          onDataLoaded(d.summary.test_name);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [schoolUdise, grade, sessionId, program, stream]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      {loading && (
        <div className="flex justify-center items-center h-[30vh]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
          <span className="ml-3 text-sm text-text-secondary">Loading test details...</span>
        </div>
      )}

      {error && !loading && (
        <div className="p-4 bg-danger-bg border border-danger text-danger rounded-lg">
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
            {data.summary.students_submitted < data.summary.students_appeared ? (
              // Scores below cover submitted attempts only, so show the
              // denominator rather than an unqualified head count.
              <StatCard
                label="Submitted / Appeared"
                value={`${data.summary.students_submitted} / ${data.summary.students_appeared}`}
                size="sm"
                color="brand-gold"
              />
            ) : (
              <StatCard
                label="Students Appeared"
                value={data.summary.students_appeared}
                size="sm"
                color="brand-gold"
              />
            )}
            <StatCard label="Avg Score" value={`${data.summary.avg_marks}/${data.summary.total_marks} (${data.summary.avg_score}%)`} size="sm" color="brand-coral" />
            <StatCard label="Min Score" value={`${data.summary.min_marks}/${data.summary.total_marks} (${data.summary.min_score}%)`} size="sm" color="brand-amber" />
            <StatCard label="Max Score" value={`${data.summary.max_marks}/${data.summary.total_marks} (${data.summary.max_score}%)`} size="sm" color="brand-gold" />
            <StatCard label="Avg Accuracy" value={`${data.summary.avg_accuracy}%`} size="sm" color="brand-gold" />
            <StatCard label="Avg Attempt Rate" value={`${data.summary.avg_attempt_rate}%`} size="sm" color="brand-coral" />
          </div>
        </>
      )}

      {/* Outside the data branch on purpose: the combined reports are their own
          job with their own status, and must stay reachable while this summary
          is loading or has failed. */}
      {afterStats}

      {data && !loading && (
        <>
          <SubjectAnalysisSection subjects={data.subjects} />
          <ChapterAnalysisSection
            chapters={data.chapters}
            schoolUdise={schoolUdise}
            grade={grade}
            sessionId={sessionId}
            program={program}
            stream={stream}
          />
          <StudentResultsTable
            students={data.students}
            schoolUdise={schoolUdise}
            grade={grade}
            sessionId={sessionId}
            program={program}
            stream={stream}
            testName={data.summary.test_name}
          />
        </>
      )}
    </div>
  );
}
