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
  onBack: () => void;
}

export default function TestDeepDive({
  schoolUdise,
  grade,
  sessionId,
  testName,
  onBack,
}: Props) {
  const [data, setData] = useState<TestDeepDiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);

    fetch(
      `/api/quiz-analytics/${schoolUdise}/test-deep-dive?grade=${grade}&sessionId=${encodeURIComponent(sessionId)}`
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch test details");
        return res.json();
      })
      .then((d: TestDeepDiveData) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [schoolUdise, grade, sessionId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          ← Back to Overview
        </button>
        <h2 className="text-lg font-semibold text-gray-900">{testName}</h2>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Loading test details...</span>
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Students Appeared" value={data.summary.students_appeared} />
            <StatCard label="Avg Score" value={`${data.summary.avg_score}%`} />
            <StatCard label="Min Score" value={`${data.summary.min_score}%`} />
            <StatCard label="Max Score" value={`${data.summary.max_score}%`} />
            <StatCard label="Avg Accuracy" value={`${data.summary.avg_accuracy}%`} />
            <StatCard label="Avg Attempt Rate" value={`${data.summary.avg_attempt_rate}%`} />
          </div>

          <SubjectAnalysisSection subjects={data.subjects} />
          <ChapterAnalysisSection chapters={data.chapters} />
          <StudentResultsTable students={data.students} />
        </>
      )}
    </div>
  );
}
