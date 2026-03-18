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

export type TestCategory = "chapter" | "full";

export default function PerformanceTab({ schoolUdise }: Props) {
  const [grades, setGrades] = useState<number[] | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>({ type: "batch" });
  const [testCategory, setTestCategory] = useState<TestCategory>("chapter");
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
      <div className="p-4 bg-danger-bg border border-danger text-danger">
        {error}
      </div>
    );
  }

  if (grades === null) {
    return (
      <div className="flex justify-center items-center h-[30vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
        <span className="ml-3 text-sm text-text-secondary">Loading quiz data...</span>
      </div>
    );
  }

  if (grades.length === 0) {
    return (
      <div className="p-8 text-center bg-bg-card-alt border border-border">
        <p className="text-sm text-text-muted">No quiz data available for this school yet.</p>
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
        <label className="text-xs font-bold uppercase tracking-wide text-text-muted">
          Grade
        </label>
        <select
          className="px-3 py-2 text-sm bg-bg-card border-2 border-border text-text-primary focus:outline-none focus:border-accent transition-colors"
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

      {selectedGrade != null && activeView.type === "batch" && (
        <div className="flex gap-1">
          {(["chapter", "full"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setTestCategory(cat)}
              className={`px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-bold uppercase tracking-wide transition-colors ${
                testCategory === cat
                  ? "bg-accent text-text-on-accent"
                  : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
              }`}
            >
              {cat === "chapter" ? "Chapter Tests" : "Full Tests"}
            </button>
          ))}
        </div>
      )}

      {selectedGrade == null ? (
        <div className="p-8 text-center bg-bg-card-alt border border-border">
          <p className="text-sm text-text-muted">Select a grade to view performance data.</p>
        </div>
      ) : activeView.type === "batch" ? (
        <BatchOverview
          schoolUdise={schoolUdise}
          grade={selectedGrade}
          testCategory={testCategory}
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
