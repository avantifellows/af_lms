"use client";

import { useState, useEffect } from "react";
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
  onTestClick: (sessionId: string, testName: string) => void;
}

function TestCard({
  test,
  totalEnrolled,
  onClick,
}: {
  test: TestTrendPoint;
  totalEnrolled: number | null;
  onClick: () => void;
}) {
  const participationPct =
    totalEnrolled && totalEnrolled > 0
      ? Math.round((test.student_count / totalEnrolled) * 100)
      : null;

  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-400 hover:shadow-md cursor-pointer transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-gray-900 truncate">{test.test_name}</h4>
          <p className="text-xs text-gray-500">{test.start_date}</p>
        </div>
        <span className="text-xs text-blue-600 shrink-0 ml-2">Details →</span>
      </div>

      <div>
        <p className="text-xs text-gray-500">Attendance</p>
        <p className="text-lg font-semibold text-gray-900">
          {test.student_count}
          {participationPct != null && (
            <span className="text-xs font-normal text-gray-500 ml-1">
              ({participationPct}% of enrolled)
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

export default function BatchOverview({ schoolUdise, grade, testCategory, onTestClick }: Props) {
  const [data, setData] = useState<BatchOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/quiz-analytics/${schoolUdise}/batch-overview?grade=${grade}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch batch overview");
        return res.json();
      })
      .then((d: BatchOverviewData) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [schoolUdise, grade]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading batch overview...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
        {error}
      </div>
    );
  }

  if (!data || data.tests.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-500">No quiz data available for this grade yet.</p>
      </div>
    );
  }

  const { totalEnrolled } = data;

  // Filter tests by category
  const tests = data.tests.filter((t) =>
    testCategory === "chapter" ? isChapterTest(t.test_format) : !isChapterTest(t.test_format)
  );

  if (tests.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-500">
          No {testCategory === "chapter" ? "chapter" : "full"} tests available for this grade yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Tests Conducted" value={tests.length} />
        <StatCard
          label="Avg Attendance"
          value={Math.round(tests.reduce((s, t) => s + t.student_count, 0) / tests.length)}
        />
        {totalEnrolled != null && (
          <StatCard label="Total Enrolled" value={totalEnrolled} />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...tests].reverse().map((t) => (
          <TestCard
            key={t.session_id}
            test={t}
            totalEnrolled={totalEnrolled}
            onClick={() => onTestClick(t.session_id, t.test_name)}
          />
        ))}
      </div>
    </div>
  );
}
