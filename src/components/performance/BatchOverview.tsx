"use client";

import { useState, useEffect } from "react";
import StatCard from "../StatCard";
import type { BatchOverviewData, TestTrendPoint, SubjectTrendPoint } from "@/types/quiz";

interface Props {
  schoolUdise: string;
  grade: number;
  onTestClick: (sessionId: string, testName: string) => void;
}

function scoreBarColor(pct: number): string {
  if (pct < 40) return "bg-red-400";
  if (pct < 60) return "bg-yellow-400";
  return "bg-green-400";
}

function TestCard({
  test,
  totalEnrolled,
  subjects,
  onClick,
}: {
  test: TestTrendPoint;
  totalEnrolled: number | null;
  subjects: SubjectTrendPoint[];
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

      {/* Score + participation row */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-xs text-gray-500">Avg Score</p>
          <p className="text-lg font-semibold text-gray-900">{test.avg_percentage}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Participation</p>
          <p className="text-lg font-semibold text-gray-900">
            {test.student_count}
            {participationPct != null && (
              <span className="text-xs font-normal text-gray-500 ml-1">
                ({participationPct}%)
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Gender split */}
      {(test.male_avg_percentage != null || test.female_avg_percentage != null) && (
        <div className="flex gap-4 mb-3 text-xs">
          {test.male_avg_percentage != null && (
            <span className="text-teal-700">
              Male: <span className="font-medium">{test.male_avg_percentage}%</span>
            </span>
          )}
          {test.female_avg_percentage != null && (
            <span className="text-pink-700">
              Female: <span className="font-medium">{test.female_avg_percentage}%</span>
            </span>
          )}
        </div>
      )}

      {/* Subject bars */}
      {subjects.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Subjects</p>
          {subjects.map((s) => (
            <div key={s.subject} className="flex items-center gap-2">
              <span className="text-xs text-gray-700 w-20 truncate shrink-0">{s.subject}</span>
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${scoreBarColor(s.avg_percentage)}`}
                  style={{ width: `${Math.min(s.avg_percentage, 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-600 w-10 text-right">{s.avg_percentage}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BatchOverview({ schoolUdise, grade, onTestClick }: Props) {
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

  const { summary, tests, subjectTrend, totalEnrolled } = data;

  // Build subject lookup by session_id
  const subjectsByTest = new Map<string, SubjectTrendPoint[]>();
  for (const pt of subjectTrend) {
    const list = subjectsByTest.get(pt.session_id) || [];
    list.push(pt);
    subjectsByTest.set(pt.session_id, list);
  }

  const trendLabel =
    summary.trend_direction === "up"
      ? "↑ Improving"
      : summary.trend_direction === "down"
        ? "↓ Declining"
        : "→ Stable";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Tests Conducted" value={summary.tests_conducted} />
        <StatCard label="Avg Participation" value={summary.avg_participation} />
        <StatCard label="Overall Avg" value={`${summary.overall_avg}%`} />
        <StatCard label="Trend" value={trendLabel} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...tests].reverse().map((t) => (
          <TestCard
            key={t.session_id}
            test={t}
            totalEnrolled={totalEnrolled}
            subjects={subjectsByTest.get(t.session_id) || []}
            onClick={() => onTestClick(t.session_id, t.test_name)}
          />
        ))}
      </div>
    </div>
  );
}
