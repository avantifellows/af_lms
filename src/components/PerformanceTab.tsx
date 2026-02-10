"use client";

import { useState, useEffect } from "react";
import QuizAnalyticsSection from "./QuizAnalyticsSection";

interface QuizSession {
  session_id: string;
  test_name: string;
  start_date: string;
  student_count: number;
}

interface Props {
  schoolUdise: string;
}

export default function PerformanceTab({ schoolUdise }: Props) {
  const [sessions, setSessions] = useState<QuizSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch(`/api/quiz-analytics/${schoolUdise}/sessions`);
        if (!res.ok) throw new Error("Failed to fetch quiz sessions");
        const data = await res.json();
        setSessions(data.sessions);
      } catch (err) {
        console.error("Failed to fetch quiz sessions:", err);
        setError("Failed to load quiz data");
      }
    }
    fetchSessions();
  }, [schoolUdise]);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
        {error}
      </div>
    );
  }

  if (sessions === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading quiz data...</span>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-500">No quiz data available for this school yet.</p>
      </div>
    );
  }

  return (
    <QuizAnalyticsSection sessions={sessions} schoolUdise={schoolUdise} />
  );
}
