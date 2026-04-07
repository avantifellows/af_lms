"use client";

import { useState, useEffect } from "react";
import StatCard from "../StatCard";
import SubjectAnalysisSection from "./SubjectAnalysisSection";
import ChapterAnalysisSection from "./ChapterAnalysisSection";
import StudentResultsTable from "./StudentResultsTable";
import type { TestDeepDiveData } from "@/types/quiz";

interface Props {
  schoolUdise: string;
  grade: number;
  sessionId: string;
  testName: string;
  program?: string;
  onBack: () => void;
  onDataLoaded?: (testName: string) => void;
}

export default function TestDeepDive({
  schoolUdise,
  grade,
  sessionId,
  testName,
  program,
  onBack,
  onDataLoaded,
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
    fetch(
      `/api/quiz-analytics/${schoolUdise}/test-deep-dive?grade=${grade}&sessionId=${encodeURIComponent(sessionId)}${programParam}`,
      { signal: controller.signal }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch test details");
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
  }, [schoolUdise, grade, sessionId, program]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-sm font-bold uppercase tracking-wide text-accent hover:text-accent-hover transition-colors rounded-lg px-3 min-h-[44px] hover:bg-hover-bg"
        >
          &larr; Back to Overview
        </button>
        <h2 className="text-lg font-bold uppercase tracking-tight text-text-primary">
          {testName || data?.summary.test_name || "Loading..."}
        </h2>
      </div>

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
            <StatCard label="Students Appeared" value={data.summary.students_appeared} size="sm" color="brand-blue" />
            <StatCard label="Avg Score" value={`${data.summary.avg_score}%`} size="sm" color="brand-coral" />
            <StatCard label="Min Score" value={`${data.summary.min_score}%`} size="sm" color="brand-amber" />
            <StatCard label="Max Score" value={`${data.summary.max_score}%`} size="sm" color="brand-gold" />
            <StatCard label="Avg Accuracy" value={`${data.summary.avg_accuracy}%`} size="sm" color="brand-blue" />
            <StatCard label="Avg Attempt Rate" value={`${data.summary.avg_attempt_rate}%`} size="sm" color="brand-coral" />
          </div>

          <SubjectAnalysisSection subjects={data.subjects} />
          <ChapterAnalysisSection chapters={data.chapters} />
          <StudentResultsTable students={data.students} />
        </>
      )}
    </div>
  );
}
