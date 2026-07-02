"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/Select";
import BatchOverview from "./performance/BatchOverview";
import TestDeepDive from "./performance/TestDeepDive";
import CumulativeALTable from "./performance/CumulativeALTable";
import CombinedReportPanel from "./performance/CombinedReportPanel";

interface Props {
  schoolUdise: string;
}

export type TestCategory = "chapter" | "full";
export type FullTestView = "per_test" | "cumulative";

const STREAM_LABELS: Record<string, string> = {
  pcm: "PCM",
  pcb: "PCB",
  pcmb: "PCMB",
  engineering: "Engineering",
  medical: "Medical",
  foundation: "Foundation",
  clat: "CLAT",
  ca: "CA",
};

function streamLabel(canonical: string): string {
  return STREAM_LABELS[canonical] || canonical.charAt(0).toUpperCase() + canonical.slice(1);
}

export default function PerformanceTab({ schoolUdise }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read initial state from URL
  const urlProgram = searchParams.get("program") || null;
  const urlGrade = searchParams.get("grade");
  const urlSession = searchParams.get("session");
  const urlStream = searchParams.get("stream") || null;
  const urlSubject = searchParams.get("subject") || null;
  const urlTestGrade = searchParams.get("testGrade");
  const urlView = (searchParams.get("view") as FullTestView | null) || null;
  const urlCategory = (searchParams.get("category") as TestCategory | null) || null;

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
  const [testCategory, setTestCategory] = useState<TestCategory>(
    urlCategory === "chapter" ? "chapter" : "full"
  );
  const [selectedStream, setSelectedStream] = useState<string | null>(urlStream);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(urlSubject);
  const [selectedTestGrade, setSelectedTestGrade] = useState<number | null>(
    urlTestGrade ? parseInt(urlTestGrade, 10) : null
  );
  const [fullTestView, setFullTestView] = useState<FullTestView>(urlView === "cumulative" ? "cumulative" : "per_test");
  const [availableStreams, setAvailableStreams] = useState<string[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  const [availableTestGrades, setAvailableTestGrades] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Update URL when state changes
  const updateUrl = useCallback(
    (opts: {
      program?: string | null;
      grade?: number | null;
      session?: string | null;
      stream?: string | null;
      subject?: string | null;
      testGrade?: number | null;
      view?: FullTestView | null;
      category?: TestCategory | null;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
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
      if (opts.stream !== undefined) {
        if (opts.stream) params.set("stream", opts.stream);
        else params.delete("stream");
      }
      if (opts.subject !== undefined) {
        if (opts.subject) params.set("subject", opts.subject);
        else params.delete("subject");
      }
      if (opts.testGrade !== undefined) {
        if (opts.testGrade != null) params.set("testGrade", String(opts.testGrade));
        else params.delete("testGrade");
      }
      if (opts.view !== undefined) {
        if (opts.view && opts.view !== "per_test") params.set("view", opts.view);
        else params.delete("view");
      }
      if (opts.category !== undefined) {
        // Default category is "full" — only encode in URL when it diverges
        if (opts.category && opts.category !== "full") params.set("category", opts.category);
        else params.delete("category");
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

        // Reconcile the selected grade with the grades available for the
        // current program scope. A grade chosen against the all-programs list
        // (or a prior program) can fall out of the available set once the
        // program narrows — e.g. a PM scoped to JNV CoE at a school where CoE
        // only has grade 11, while the default "prefer 12" came from another
        // program the PM can't see. Treat a now-invalid selection like no
        // selection, then auto-pick: prefer 12, else the only grade.
        const gradeValid =
          selectedGrade != null && data.grades.includes(selectedGrade);
        if (!gradeValid) {
          const preferred = data.grades.includes(12)
            ? 12
            : data.grades.length === 1
              ? data.grades[0]
              : null;
          if (preferred != null) {
            setSelectedGrade(preferred);
            updateUrl({ grade: preferred });
          } else if (selectedGrade != null) {
            // Stale selection with no auto-pickable replacement (multiple
            // grades, none is 12) — clear it so the user re-picks.
            setSelectedGrade(null);
            updateUrl({ grade: null });
          }
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

  // Receive available filter values from BatchOverview as it loads data.
  const handleFilterOptions = useCallback(
    (opts: { streams: string[]; subjects: string[]; testGrades: number[] }) => {
      setAvailableStreams(opts.streams ?? []);
      setAvailableSubjects(opts.subjects ?? []);
      setAvailableTestGrades(opts.testGrades ?? []);
    },
    []
  );

  if (error) {
    return (
      <div className="p-4 bg-danger-bg border border-danger text-danger rounded-lg">
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
      <div className="p-8 text-center bg-bg-card-alt border border-border rounded-lg shadow-sm">
        <p className="text-sm text-text-muted">No quiz data available for this school yet.</p>
      </div>
    );
  }

  const handleProgramChange = (program: string) => {
    setSelectedProgram(program);
    setSelectedGrade(null);
    setDeepDiveSession(null);
    setSelectedStream(null);
    setSelectedSubject(null);
    setSelectedTestGrade(null);
    setAvailableTestGrades([]);
    setGrades(null); // trigger re-fetch
    updateUrl({ program, grade: null, session: null, stream: null, subject: null, testGrade: null });
  };

  const handleGradeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const grade = val ? parseInt(val, 10) : null;
    setSelectedGrade(grade);
    setDeepDiveSession(null);
    setSelectedStream(null);
    setSelectedSubject(null);
    setSelectedTestGrade(null);
    setAvailableTestGrades([]);
    updateUrl({ grade, session: null, stream: null, subject: null, testGrade: null });
  };

  const handleTestGradeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const testGrade = val ? parseInt(val, 10) : null;
    setSelectedTestGrade(testGrade);
    updateUrl({ testGrade });
  };

  const handleTestClick = (sessionId: string, testName: string) => {
    setDeepDiveSession({ sessionId, testName });
    updateUrl({ session: sessionId });
  };

  const handleBack = () => {
    setDeepDiveSession(null);
    updateUrl({ session: null });
  };

  const handleCategoryChange = (cat: TestCategory) => {
    setTestCategory(cat);
    // Subject filter is chapter-only; clear when leaving chapter tab
    const subjectReset = cat !== "chapter" && selectedSubject;
    if (subjectReset) setSelectedSubject(null);
    // Chapter and full tests can target different grades, so a test-grade
    // selection from one category may not exist in the other. Clear it on
    // switch so the view never silently renders empty.
    const testGradeReset = selectedTestGrade != null;
    if (testGradeReset) setSelectedTestGrade(null);
    updateUrl({
      category: cat,
      subject: subjectReset ? null : undefined,
      testGrade: testGradeReset ? null : undefined,
    });
  };

  const handleStreamChange = (stream: string | null) => {
    setSelectedStream(stream);
    updateUrl({ stream });
  };

  const handleSubjectChange = (subject: string | null) => {
    setSelectedSubject(subject);
    updateUrl({ subject });
  };

  const handleFullViewChange = (view: FullTestView) => {
    setFullTestView(view);
    updateUrl({ view });
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
              className={`px-3 md:px-4 py-1.5 md:py-2 min-h-[44px] text-xs md:text-sm font-bold uppercase tracking-wide rounded-lg transition-colors ${
                selectedProgram === prog
                  ? "bg-accent text-text-on-accent shadow-sm"
                  : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
              }`}
            >
              {prog}
            </button>
          ))}
        </div>
      )}

      {/* Grade + Test Grade selectors */}
      {grades.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Grade
          </label>
          <Select
            value={selectedGrade ?? ""}
            onChange={handleGradeChange}
          >
            {grades.length > 1 && <option value="">Select grade...</option>}
            {grades.map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </Select>

          {/* Test Grade filter — the grade the test targets, which can differ
              from the students' grade (e.g. a grade-12 batch sitting an
              11th-grade test). Options come from the loaded test set. */}
          {selectedGrade != null && !deepDiveSession && availableTestGrades.length > 0 && (
            <>
              <label className="text-xs font-bold uppercase tracking-wide text-text-muted">
                Test Grade
              </label>
              <Select value={selectedTestGrade ?? ""} onChange={handleTestGradeChange}>
                <option value="">All test grades</option>
                {availableTestGrades.map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </Select>
            </>
          )}
        </div>
      )}

      {/* Chapter / Full Tests toggle */}
      {selectedGrade != null && !deepDiveSession && (
        <div className="flex gap-1">
          {(["chapter", "full"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => handleCategoryChange(cat)}
              className={`px-3 md:px-4 py-1.5 md:py-2 min-h-[44px] text-xs md:text-sm font-bold uppercase tracking-wide rounded-lg transition-colors ${
                testCategory === cat
                  ? "bg-accent text-text-on-accent shadow-sm"
                  : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
              }`}
            >
              {cat === "chapter" ? "Chapter Tests" : "Full Tests"}
            </button>
          ))}
        </div>
      )}

      {/* Per Test / Cumulative sub-tab — Full Tests only */}
      {selectedGrade != null && !deepDiveSession && testCategory === "full" && (
        <div className="flex gap-1">
          {(["per_test", "cumulative"] as const).map((view) => (
            <button
              key={view}
              onClick={() => handleFullViewChange(view)}
              className={`px-3 py-1.5 min-h-[36px] text-xs font-bold uppercase tracking-wide rounded-lg transition-colors ${
                fullTestView === view
                  ? "bg-accent/15 text-accent border border-accent/40"
                  : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/40 hover:text-text-primary"
              }`}
            >
              {view === "per_test" ? "Per Test" : "Cumulative"}
            </button>
          ))}
        </div>
      )}

      {/* Stream filter */}
      {selectedGrade != null && !deepDiveSession && availableStreams.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wide text-text-muted mr-1">Stream</span>
          <button
            onClick={() => handleStreamChange(null)}
            className={`px-3 py-1.5 min-h-[36px] text-xs font-bold uppercase tracking-wide rounded-lg transition-colors ${
              !selectedStream
                ? "bg-accent text-text-on-accent shadow-sm"
                : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
            }`}
          >
            All
          </button>
          {availableStreams.map((s) => (
            <button
              key={s}
              onClick={() => handleStreamChange(s)}
              className={`px-3 py-1.5 min-h-[36px] text-xs font-bold uppercase tracking-wide rounded-lg transition-colors ${
                selectedStream === s
                  ? "bg-accent text-text-on-accent shadow-sm"
                  : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
              }`}
            >
              {streamLabel(s)}
            </button>
          ))}
        </div>
      )}

      {/* Subject filter — Chapter Tests only */}
      {selectedGrade != null && !deepDiveSession && testCategory === "chapter" && availableSubjects.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wide text-text-muted mr-1">Subject</span>
          <button
            onClick={() => handleSubjectChange(null)}
            className={`px-3 py-1.5 min-h-[36px] text-xs font-bold uppercase tracking-wide rounded-lg transition-colors ${
              !selectedSubject
                ? "bg-accent text-text-on-accent shadow-sm"
                : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
            }`}
          >
            All
          </button>
          {availableSubjects.map((s) => (
            <button
              key={s}
              onClick={() => handleSubjectChange(s)}
              className={`px-3 py-1.5 min-h-[36px] text-xs font-bold uppercase tracking-wide rounded-lg transition-colors ${
                selectedSubject === s
                  ? "bg-accent text-text-on-accent shadow-sm"
                  : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {showProgramTabs && !selectedProgram ? (
        <div className="p-8 text-center bg-bg-card-alt border border-border rounded-lg shadow-sm">
          <p className="text-sm text-text-muted">Select a program to view performance data.</p>
        </div>
      ) : selectedGrade == null ? (
        <div className="p-8 text-center bg-bg-card-alt border border-border rounded-lg shadow-sm">
          <p className="text-sm text-text-muted">Select a grade to view performance data.</p>
        </div>
      ) : deepDiveSession ? (
        <div className="space-y-6">
          <CombinedReportPanel
            schoolUdise={schoolUdise}
            sessionId={deepDiveSession.sessionId}
            testName={deepDiveSession.testName}
            grade={selectedGrade}
            program={selectedProgram || undefined}
            stream={selectedStream || undefined}
          />
          <TestDeepDive
            schoolUdise={schoolUdise}
            grade={selectedGrade}
            sessionId={deepDiveSession.sessionId}
            testName={deepDiveSession.testName}
            program={selectedProgram || undefined}
            stream={selectedStream || undefined}
            onBack={handleBack}
            onDataLoaded={handleDeepDiveData}
          />
        </div>
      ) : testCategory === "full" && fullTestView === "cumulative" ? (
        <CumulativeALTable
          schoolUdise={schoolUdise}
          grade={selectedGrade}
          program={selectedProgram || undefined}
          stream={selectedStream || undefined}
          testGrade={selectedTestGrade ?? undefined}
        />
      ) : (
        <BatchOverview
          schoolUdise={schoolUdise}
          grade={selectedGrade}
          testCategory={testCategory}
          program={selectedProgram || undefined}
          stream={selectedStream || undefined}
          subject={selectedSubject || undefined}
          testGrade={selectedTestGrade ?? undefined}
          onTestClick={handleTestClick}
          onFilterOptions={handleFilterOptions}
        />
      )}
    </div>
  );
}
