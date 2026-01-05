"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import StatCard from "./StatCard";
import type { QuizSummary } from "@/types/quiz";

// Quiz session from BigQuery
interface QuizSession {
  session_id: string;
  test_name: string;
  start_date: string;
  student_count: number;
}

interface Props {
  sessions: QuizSession[];
  schoolUdise: string;
}

const COLORS = {
  present: "#22c55e",
  absent: "#ef4444",
  bars: "#3b82f6",
  subjects: ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899"],
};

export default function QuizAnalyticsSection({ sessions, schoolUdise }: Props) {
  const [selectedSession, setSelectedSession] = useState<QuizSession | null>(null);
  const [analytics, setAnalytics] = useState<QuizSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // All sessions from BigQuery have valid session_ids
  const validSessions = sessions.filter((s) => s.session_id);

  const fetchAnalytics = async (session: QuizSession) => {
    console.log("fetchAnalytics called", session);
    if (!session.session_id) {
      console.log("No session_id, returning");
      return;
    }

    setLoading(true);
    setError(null);
    setAnalytics(null);

    try {
      console.log("Fetching from API:", `/api/quiz-analytics/${schoolUdise}`);
      const response = await fetch(`/api/quiz-analytics/${schoolUdise}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: session.session_id }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch analytics");
      }

      const data = await response.json();
      if (data.summary) {
        setAnalytics(data.summary);
      } else {
        setError(data.message || "No data available");
      }
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
      setError("Failed to load quiz analytics");
    } finally {
      setLoading(false);
    }
  };

  const handleSessionSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    console.log("handleSessionSelect called", selectedValue);
    const session = validSessions.find((s) => s.session_id === selectedValue);
    console.log("Found session:", session);
    if (session) {
      setSelectedSession(session);
      fetchAnalytics(session);
    } else {
      setSelectedSession(null);
      setAnalytics(null);
    }
  };

  if (validSessions.length === 0) {
    return null;
  }

  const attendanceData = analytics
    ? [
        { name: "Present", value: analytics.present_count, color: COLORS.present },
        { name: "Absent", value: analytics.absent_count, color: COLORS.absent },
      ]
    : [];

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Quiz Analytics</h2>

      {/* Session selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Quiz
        </label>
        <select
          className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          onChange={handleSessionSelect}
          value={selectedSession?.session_id || ""}
        >
          <option value="">Choose a quiz...</option>
          {validSessions.map((session) => (
            <option key={session.session_id} value={session.session_id}>
              {session.test_name} - {session.start_date} ({session.student_count} students)
            </option>
          ))}
        </select>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Loading analytics...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">
          {error}
        </div>
      )}

      {/* Analytics display */}
      {analytics && !loading && (
        <div className="space-y-6">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total Students" value={analytics.total_students} />
            <StatCard label="Present" value={analytics.present_count} />
            <StatCard label="Absent" value={analytics.absent_count} />
            <StatCard label="Avg Score" value={`${analytics.avg_score}%`} />
            <StatCard label="Min Score" value={`${analytics.min_score}%`} />
            <StatCard label="Max Score" value={`${analytics.max_score}%`} />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Score distribution */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">
                Score Distribution
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={analytics.score_distribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill={COLORS.bars} name="Students" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Attendance pie chart */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">
                Attendance
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={attendanceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {attendanceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Subject-wise performance */}
          {analytics.subject_scores.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">
                Subject-wise Performance
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={analytics.subject_scores}
                  layout="vertical"
                  margin={{ left: 80 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 100]} unit="%" />
                  <YAxis
                    type="category"
                    dataKey="subject_name"
                    tick={{ fontSize: 12 }}
                    width={80}
                  />
                  <Tooltip
                    formatter={(value) => [`${value}%`, "Avg Score"]}
                  />
                  <Bar dataKey="avg_percentage" fill={COLORS.bars}>
                    {analytics.subject_scores.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS.subjects[index % COLORS.subjects.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Student results table */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-4">
              Student Results
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rank
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Student Name
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Marks
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Percentage
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {analytics.student_results.slice(0, 20).map((result, index) => {
                    const isPresent = result.attendance_status?.toLowerCase() === "present";
                    return (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {isPresent ? index + 1 : "-"}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {result.student_name}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            isPresent
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {result.attendance_status}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {result.marks_obtained !== null && result.total_marks
                          ? `${result.marks_obtained}/${result.total_marks}`
                          : "-"}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {result.percentage !== null
                          ? `${Math.round(result.percentage * 10) / 10}%`
                          : "-"}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {analytics.student_results.length > 20 && (
                <p className="text-sm text-gray-500 mt-2 px-4">
                  Showing top 20 of {analytics.student_results.length} students
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
