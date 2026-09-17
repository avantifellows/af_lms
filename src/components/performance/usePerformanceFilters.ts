"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  applyPerformanceParams,
  readPerformanceParams,
  type PerformanceUrlPatch,
  type TestCategory,
  type FullTestView,
} from "@/lib/performance-url-params";
import type { PerformanceScope } from "./PerformanceContent";

/** reconcileGrade's "leave the selection as it is" answer, distinct from null,
 *  which means "clear it". */
export const KEEP_GRADE = Symbol("keep-grade");

/**
 * Which grade should be selected, given the grades available for the current
 * program scope and whatever is selected now.
 *
 * A grade chosen against the all-programs list (or a prior program) can fall
 * out of the available set once the program narrows — e.g. a PM scoped to JNV
 * CoE at a school where CoE only has grade 11, while the default "prefer 12"
 * came from another program the PM cannot see. A now-invalid selection is
 * treated like no selection, then auto-picked: prefer 12, else the only grade.
 *
 * Pure and exported so the rule can be tested directly instead of through a
 * mocked fetch, and so the effect that calls it stays flat.
 */
export function reconcileGrade(
  available: number[],
  current: number | null
): number | null | typeof KEEP_GRADE {
  if (current != null && available.includes(current)) return KEEP_GRADE;
  if (available.includes(12)) return 12;
  if (available.length === 1) return available[0];
  // Nothing auto-pickable (several grades, none is 12): clear a stale choice so
  // the user re-picks, but don't churn the URL when there was none.
  return current != null ? null : KEEP_GRADE;
}

/** The state the handlers drive. Grouped so the factory below takes one
 *  argument instead of eighteen. */
interface FilterSetters {
  selectedSubject: string | null;
  selectedTestGrade: number | null;
  setSelectedProgram: (v: string | null) => void;
  setSelectedGrade: (v: number | null) => void;
  setSelectedStream: (v: string | null) => void;
  setSelectedSubject: (v: string | null) => void;
  setSelectedTestGrade: (v: number | null) => void;
  setDeepDiveSession: (v: { sessionId: string; testName: string } | null) => void;
  setTestCategory: (v: TestCategory) => void;
  setFullTestView: (v: FullTestView) => void;
  setAvailableTestGrades: (v: number[]) => void;
  setGrades: (v: number[] | null) => void;
  updateUrl: (patch: PerformanceUrlPatch) => void;
}

/**
 * Builds the tab's event handlers.
 *
 * A plain function rather than more lines inside the hook: nine handler
 * definitions nested in one hook body was most of what made that body too
 * complex to pass the health gate, and none of them needs to be a hook.
 */
function createPerformanceHandlers({
  selectedSubject,
  selectedTestGrade,
  setSelectedProgram,
  setSelectedGrade,
  setSelectedStream,
  setSelectedSubject,
  setSelectedTestGrade,
  setDeepDiveSession,
  setTestCategory,
  setFullTestView,
  setAvailableTestGrades,
  setGrades,
  updateUrl,
}: FilterSetters) {
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

  const handleGradeChange = (grade: number) => {
    setSelectedGrade(grade);
    setDeepDiveSession(null);
    setSelectedStream(null);
    setSelectedSubject(null);
    setSelectedTestGrade(null);
    setAvailableTestGrades([]);
    updateUrl({ grade, session: null, stream: null, subject: null, testGrade: null });
  };

  // 0 is the "All test grades" sentinel — a segmented control needs a concrete
  // value for the all-option, and no test targets grade 0.
  const handleTestGradeChange = (value: number) => {
    const testGrade = value === 0 ? null : value;
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

  return {
    handleProgramChange,
    handleGradeChange,
    handleTestGradeChange,
    handleTestClick,
    handleBack,
    handleCategoryChange,
    handleStreamChange,
    handleSubjectChange,
    handleFullViewChange,
  };
}

/**
 * Loads the programs and grades available for this school, re-fetching when the
 * program scope changes, and keeps the grade selection valid as that set moves.
 *
 * Its own hook because the fetch chain — three nested callbacks, each with its
 * own branch — is where usePerformanceFilters' cognitive complexity actually
 * lived. Owning programs/grades/error here also keeps the loading state next
 * to the thing that loads it.
 */
function useProgramsAndGrades({
  schoolUdise,
  selectedProgram,
  selectedGrade,
  setSelectedProgram,
  setSelectedGrade,
  updateUrl,
}: {
  schoolUdise: string;
  selectedProgram: string | null;
  selectedGrade: number | null;
  setSelectedProgram: (v: string | null) => void;
  setSelectedGrade: (v: number | null) => void;
  updateUrl: (patch: PerformanceUrlPatch) => void;
}) {
  const [programs, setPrograms] = useState<string[] | null>(null);
  const [grades, setGrades] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

        const nextGrade = reconcileGrade(data.grades, selectedGrade);
        if (nextGrade !== KEEP_GRADE) {
          setSelectedGrade(nextGrade);
          updateUrl({ grade: nextGrade });
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

  return { programs, grades, error, setGrades };
}

/**
 * The tab's filter selections, seeded from the URL.
 *
 * Grouped into their own hook purely so no single function carries all of the
 * tab's state: eleven useState calls in one body is most of what the health
 * check counts as cognitive load, and they have no behaviour between them.
 */
function usePerformanceSelection({
  searchParams,
  lockedProgram,
}: {
  searchParams: { get(name: string): string | null };
  lockedProgram?: string;
}) {
  // Initial state from the URL, parsed in one place. Only useState initial
  // values read this, so later renders ignoring it is the intended behaviour.
  const fromUrl = readPerformanceParams(searchParams);

  // lockedProgram (centre pages) must win over the URL param — otherwise a
  // centre-confined viewer could open ?program=X and read another program's data.
  const [selectedProgram, setSelectedProgram] = useState<string | null>(lockedProgram ?? fromUrl.program);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(fromUrl.grade);
  const [deepDiveSession, setDeepDiveSession] = useState<{
    sessionId: string;
    testName: string;
  } | null>(
    // A session reached by URL starts nameless; the name arrives with the data.
    fromUrl.session ? { sessionId: fromUrl.session, testName: "" } : null
  );
  const [testCategory, setTestCategory] = useState<TestCategory>(fromUrl.category);
  const [selectedStream, setSelectedStream] = useState<string | null>(fromUrl.stream);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(fromUrl.subject);
  const [selectedTestGrade, setSelectedTestGrade] = useState<number | null>(fromUrl.testGrade);
  const [fullTestView, setFullTestView] = useState<FullTestView>(fromUrl.view);
  const [availableStreams, setAvailableStreams] = useState<string[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  const [availableTestGrades, setAvailableTestGrades] = useState<number[]>([]);

  return {
    selectedProgram,
    setSelectedProgram,
    selectedGrade,
    setSelectedGrade,
    deepDiveSession,
    setDeepDiveSession,
    testCategory,
    setTestCategory,
    selectedStream,
    setSelectedStream,
    selectedSubject,
    setSelectedSubject,
    selectedTestGrade,
    setSelectedTestGrade,
    fullTestView,
    setFullTestView,
    availableStreams,
    setAvailableStreams,
    availableSubjects,
    setAvailableSubjects,
    availableTestGrades,
    setAvailableTestGrades,
  };
}

/**
 * Everything the Performance tab remembers and every way it changes: the
 * filter state, the programs/grades fetch, the URL sync, and the handlers the
 * controls call.
 *
 * Split out of PerformanceTab so the component is left deciding what to render
 * rather than also owning fourteen pieces of state — which is what made it the
 * repo's worst function by CRAP score. Nothing here is presentational; nothing
 * in the component mutates state directly.
 */
export function usePerformanceFilters({
  schoolUdise,
  lockedProgram,
}: {
  schoolUdise: string;
  lockedProgram?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sel = usePerformanceSelection({ searchParams, lockedProgram });

  // Update URL when state changes. The per-param rules live in
  // lib/performance-url-params so they can be unit-tested without a router.
  const updateUrl = useCallback(
    (patch: PerformanceUrlPatch) => {
      router.replace(`?${applyPerformanceParams(searchParams, patch)}`, {
        scroll: false,
      });
    },
    [router, searchParams]
  );

  const { programs, grades, error, setGrades } = useProgramsAndGrades({
    schoolUdise,
    selectedProgram: sel.selectedProgram,
    selectedGrade: sel.selectedGrade,
    setSelectedProgram: sel.setSelectedProgram,
    setSelectedGrade: sel.setSelectedGrade,
    updateUrl,
  });

  // These two are memoised because children hold onto them across renders, so
  // they close over the setters themselves rather than the selection object —
  // useState setters are stable, `sel` is a fresh object every render.
  const {
    setDeepDiveSession,
    setAvailableStreams,
    setAvailableSubjects,
    setAvailableTestGrades,
  } = sel;

  // When deep dive loads, fill in test name from URL if missing
  const handleDeepDiveData = useCallback(
    (testName: string) => {
      setDeepDiveSession((prev) =>
        prev && !prev.testName ? { ...prev, testName } : prev
      );
    },
    [setDeepDiveSession]
  );

  // Receive available filter values from BatchOverview as it loads data.
  const handleFilterOptions = useCallback(
    (opts: { streams: string[]; subjects: string[]; testGrades: number[] }) => {
      setAvailableStreams(opts.streams ?? []);
      setAvailableSubjects(opts.subjects ?? []);
      setAvailableTestGrades(opts.testGrades ?? []);
    },
    [setAvailableStreams, setAvailableSubjects, setAvailableTestGrades]
  );

  const handlers = createPerformanceHandlers({
    selectedSubject: sel.selectedSubject,
    selectedTestGrade: sel.selectedTestGrade,
    setSelectedProgram: sel.setSelectedProgram,
    setSelectedGrade: sel.setSelectedGrade,
    setSelectedStream: sel.setSelectedStream,
    setSelectedSubject: sel.setSelectedSubject,
    setSelectedTestGrade: sel.setSelectedTestGrade,
    setDeepDiveSession: sel.setDeepDiveSession,
    setTestCategory: sel.setTestCategory,
    setFullTestView: sel.setFullTestView,
    setAvailableTestGrades: sel.setAvailableTestGrades,
    setGrades,
    updateUrl,
  });

  // The filter scope every data component receives. Narrowed from null to
  // undefined once here rather than at each of the ten-odd prop sites, where
  // the repetition was both noise and a place for one of them to disagree.
  const scope: PerformanceScope = {
    program: sel.selectedProgram || undefined,
    stream: sel.selectedStream || undefined,
    subject: sel.selectedSubject || undefined,
    testGrade: sel.selectedTestGrade ?? undefined,
  };

  return {
    // Loaded data
    programs,
    grades,
    error,
    // Current selection
    selectedProgram: sel.selectedProgram,
    selectedGrade: sel.selectedGrade,
    selectedStream: sel.selectedStream,
    selectedSubject: sel.selectedSubject,
    selectedTestGrade: sel.selectedTestGrade,
    testCategory: sel.testCategory,
    fullTestView: sel.fullTestView,
    deepDiveSession: sel.deepDiveSession,
    scope,
    // Options offered by the loaded test set
    availableStreams: sel.availableStreams,
    availableSubjects: sel.availableSubjects,
    availableTestGrades: sel.availableTestGrades,
    // Handlers — the nine filter/navigation ones come from the factory; the
    // two below are memoised here because children hold onto them.
    ...handlers,
    handleDeepDiveData,
    handleFilterOptions,
  };
}
