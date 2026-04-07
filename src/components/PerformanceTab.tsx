"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BatchOverview from "./performance/BatchOverview";
import TestDeepDive from "./performance/TestDeepDive";

interface Props {
  schoolUdise: string;
}

export type TestCategory = "chapter" | "full";

export default function PerformanceTab({ schoolUdise }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read initial state from URL
  const urlProgram = searchParams.get("program") || null;
  const urlGrade = searchParams.get("grade");
  const urlSession = searchParams.get("session");

  const [programs, setPrograms] = useState<string[] | null>(null);
  const [selectedProgram, setSelectedProgram] = useState<string | null>(urlProgram);
  const [grades, setGrades] = useState<number[] | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(
    urlGrade ? parseInt(urlGrade, 10) : null
  );
  const [deepDiveSession, setDeepDiveSession] = useState<{
    sessionId: string;
    testName: string;
  } | null>(
    urlSession ? { sessionId: urlSession, testName: "" } : null
  );
  const [testCategory, setTestCategory] = useState<TestCategory>("chapter");
  const [error, setError] = useState<string | null>(null);

  // Update URL when state changes
  const updateUrl = useCallback(
    (opts: { program?: string | null; grade?: number | null; session?: string | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      // Keep non-performance params (like tab)
      if (opts.program !== undefined) {
        if (opts.program) params.set("program", opts.program);
        else params.delete("program");
      }
      if (opts.grade !== undefined) {
        if (opts.grade != null) params.set("grade", String(opts.grade));
        else params.delete("grade");
      }
      if (opts.session !== undefined) {
        if (opts.session) params.set("session", opts.session);
        else params.delete("session");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Fetch programs + grades
  useEffect(() => {
    const controller = new AbortController();
    const programParam = selectedProgram
      ? `?program=${encodeURIComponent(selectedProgram)}`
      : "";
    fetch(`/api/quiz-analytics/${schoolUdise}/grades${programParam}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch grades");
        return res.json();
      })
      .then((data: { grades: number[]; programs: string[] }) => {
        setPrograms(data.programs);
        setGrades(data.grades);

        // Auto-select single program
        if (!selectedProgram && data.programs.length === 1) {
          setSelectedProgram(data.programs[0]);
        }

        // Auto-select single grade
        if (data.grades.length === 1 && selectedGrade !== data.grades[0]) {
          setSelectedGrade(data.grades[0]);
          updateUrl({ grade: data.grades[0] });
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Failed to fetch grades:", err);
          setError("Failed to load quiz data");
        }
      });

    return () => controller.abort();
  }, [schoolUdise, selectedProgram]); // eslint-disable-line react-hooks/exhaustive-deps

  // When deep dive loads, fill in test name from URL if missing
  const handleDeepDiveData = useCallback((testName: string) => {
    setDeepDiveSession((prev) =>
      prev && !prev.testName ? { ...prev, testName } : prev
    );
  }, []);

  if (error) {
    return (
      <div className="p-4 bg-danger-bg border border-danger text-danger">
        {error}
      </div>
    );
  }

  if (programs === null || grades === null) {
    return (
      <div className="flex justify-center items-center h-[30vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
        <span className="ml-3 text-sm text-text-secondary">Loading quiz data...</span>
      </div>
    );
  }

  if (programs.length === 0 && grades.length === 0) {
    return (
      <div className="p-8 text-center bg-bg-card-alt border border-border">
        <p className="text-sm text-text-muted">No quiz data available for this school yet.</p>
      </div>
    );
  }

  const handleProgramChange = (program: string) => {
    setSelectedProgram(program);
    setSelectedGrade(null);
    setDeepDiveSession(null);
    setGrades(null); // trigger re-fetch
    updateUrl({ program, grade: null, session: null });
  };

  const handleGradeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const grade = val ? parseInt(val, 10) : null;
    setSelectedGrade(grade);
    setDeepDiveSession(null);
    updateUrl({ grade, session: null });
  };

  const handleTestClick = (sessionId: string, testName: string) => {
    setDeepDiveSession({ sessionId, testName });
    updateUrl({ session: sessionId });
  };

  const handleBack = () => {
    setDeepDiveSession(null);
    updateUrl({ session: null });
  };

  const showProgramTabs = programs.length > 1;

  return (
    <div className="space-y-6">
      {/* Program tabs */}
      {showProgramTabs && (
        <div className="flex gap-1 flex-wrap">
          {programs.map((prog) => (
            <button
              key={prog}
              onClick={() => handleProgramChange(prog)}
              className={`px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-bold uppercase tracking-wide transition-colors ${
                selectedProgram === prog
                  ? "bg-accent text-text-on-accent"
                  : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
              }`}
            >
              {prog}
            </button>
          ))}
        </div>
      )}

      {/* Grade selector + test category */}
      {grades.length > 0 && (
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
      )}

      {selectedGrade != null && !deepDiveSession && (
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

      {/* Content */}
      {showProgramTabs && !selectedProgram ? (
        <div className="p-8 text-center bg-bg-card-alt border border-border">
          <p className="text-sm text-text-muted">Select a program to view performance data.</p>
        </div>
      ) : selectedGrade == null ? (
        <div className="p-8 text-center bg-bg-card-alt border border-border">
          <p className="text-sm text-text-muted">Select a grade to view performance data.</p>
        </div>
      ) : deepDiveSession ? (
        <TestDeepDive
          schoolUdise={schoolUdise}
          grade={selectedGrade}
          sessionId={deepDiveSession.sessionId}
          testName={deepDiveSession.testName}
          program={selectedProgram || undefined}
          onBack={handleBack}
          onDataLoaded={handleDeepDiveData}
        />
      ) : (
        <BatchOverview
          schoolUdise={schoolUdise}
          grade={selectedGrade}
          testCategory={testCategory}
          program={selectedProgram || undefined}
          onTestClick={handleTestClick}
        />
      )}
    </div>
  );
}
