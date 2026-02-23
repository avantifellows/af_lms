"use client";

import { useState, useEffect } from "react";
import BatchOverview from "./performance/BatchOverview";
import TestDeepDive from "./performance/TestDeepDive";

interface Props {
  schoolUdise: string;
}

type ActiveView =
  | { type: "batch" }
  | { type: "deepDive"; sessionId: string; testName: string };

export default function PerformanceTab({ schoolUdise }: Props) {
  const [grades, setGrades] = useState<number[] | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>({ type: "batch" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/quiz-analytics/${schoolUdise}/grades`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch grades");
        return res.json();
      })
      .then((data: { grades: number[] }) => {
        setGrades(data.grades);
        if (data.grades.length === 1) {
          setSelectedGrade(data.grades[0]);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch grades:", err);
        setError("Failed to load quiz data");
      });
  }, [schoolUdise]);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
        {error}
      </div>
    );
  }

  if (grades === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading quiz data...</span>
      </div>
    );
  }

  if (grades.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-500">No quiz data available for this school yet.</p>
      </div>
    );
  }

  const handleTestClick = (sessionId: string, testName: string) => {
    setActiveView({ type: "deepDive", sessionId, testName });
  };

  const handleBack = () => {
    setActiveView({ type: "batch" });
  };

  const handleGradeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedGrade(val ? parseInt(val, 10) : null);
    setActiveView({ type: "batch" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700">Grade</label>
        <select
          className="rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          value={selectedGrade ?? ""}
          onChange={handleGradeChange}
        >
          {grades.length > 1 && <option value="">Select grade...</option>}
          {grades.map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>
      </div>

      {selectedGrade == null ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500">Select a grade to view performance data.</p>
        </div>
      ) : activeView.type === "batch" ? (
        <BatchOverview
          schoolUdise={schoolUdise}
          grade={selectedGrade}
          onTestClick={handleTestClick}
        />
      ) : (
        <TestDeepDive
          schoolUdise={schoolUdise}
          grade={selectedGrade}
          sessionId={activeView.sessionId}
          testName={activeView.testName}
          onBack={handleBack}
        />
      )}
    </div>
  );
}
