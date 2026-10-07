"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  applyPerformanceParams,
  readPerformanceParams,
  type PerformanceUrlPatch,
  type PerformanceUrlState,
  type TestCategory,
  type FullTestView,
} from "@/lib/performance-url-params";
import { isNvsProgram } from "@/lib/constants";
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

/** The selections the NVS tab overrides. */
interface OverridableSelection {
  testCategory: TestCategory;
  fullTestView: FullTestView;
  subject: string | null;
  testGrade: number | null;
}

/**
 * The selections the tab actually renders with. JNV NVS offers only per-test
 * full tests with no Subject or Test grade filter, so an old shared link's
 * view/category/subject/testGrade is ignored there. Only the effective values
 * change — the raw state and URL are left alone, so switching to another
 * program tab gets that program's own selections back without URL churn.
 */
export function effectiveSelection(
  isNvs: boolean,
  raw: OverridableSelection
): OverridableSelection {
  if (!isNvs) return raw;
  return { testCategory: "full", fullTestView: "per_test", subject: null, testGrade: null };
}

type NavigateMode = "push" | "replace";

/**
 * Where the tab's URL stands. `seen` is the query the router last rendered;
 * `intended` is the query the tab has asked for, which runs ahead of `seen`
 * while navigations are outstanding. `inFlight` is the one navigation handed
 * to the router and not yet rendered; `queued` waits behind it.
 *
 * Navigations are handed over one at a time because the App Router discards a
 * pending navigation when another starts — a Program push followed at once by
 * its automatic Grade replace would otherwise lose the Program's history entry.
 */
interface UrlIntent {
  seen: string;
  intended: string;
  inFlight: string | null;
  queued: { query: string; mode: NavigateMode }[];
  trail: Trail;
}

/**
 * The history entries this mount has walked through, in order, with `at`
 * marking the current one. `pushed` says the tab itself pushed that entry on
 * top of the one before it; an entry the tab arrived at any other way, or
 * whose URL was replaced since, proves nothing about what precedes it.
 *
 * Transient by design: a reload, a direct link or a remount starts a fresh
 * trail of one unproven entry.
 */
interface Trail {
  entries: { query: string; pushed: boolean }[];
  at: number;
}

function freshTrail(query: string): Trail {
  return { entries: [{ query, pushed: false }], at: 0 };
}

/** The trail after the tab hands a navigation to the router. */
function record(trail: Trail, query: string, mode: NavigateMode): Trail {
  if (mode === "push") {
    const entries = [...trail.entries.slice(0, trail.at + 1), { query, pushed: true }];
    return { entries, at: trail.at + 1 };
  }
  const entries = trail.entries.map((e, i) => (i === trail.at ? { query, pushed: false } : e));
  return { entries, at: trail.at };
}

/**
 * The trail after a URL the tab didn't ask for. Landing on exactly one
 * neighbour's URL is Back or Forward to it. Anything else — an ambiguous
 * step, a jump, a link, an outside replace — leaves nothing proven.
 */
function follow(trail: Trail, query: string): Trail {
  const before = trail.entries[trail.at - 1]?.query === query;
  const after = trail.entries[trail.at + 1]?.query === query;
  if (before && !after) return { ...trail, at: trail.at - 1 };
  if (after && !before) return { ...trail, at: trail.at + 1 };
  return freshTrail(query);
}

/**
 * Fold a newly rendered URL into the intent. The in-flight URL landing just
 * frees the router for the next queued navigation. Any other URL is
 * Back/Forward (or a link) and is authoritative: outstanding work is dropped
 * and the tab rehydrates from it.
 */
function rehydrate(intent: UrlIntent, urlQuery: string): UrlIntent {
  if (intent.seen === urlQuery) return intent;
  if (intent.inFlight === urlQuery) return { ...intent, seen: urlQuery, inFlight: null };
  return {
    seen: urlQuery,
    intended: urlQuery,
    inFlight: null,
    queued: [],
    trail: follow(intent.trail, urlQuery),
  };
}

/**
 * Whether the current entry is an open report the tab pushed directly on top
 * of its own overview — the only case in which browser Back is a safe way to
 * close it. Nothing may be outstanding, or "current" isn't settled.
 */
function reportFollowsItsOverview(intent: UrlIntent): boolean {
  if (intent.inFlight !== null || intent.queued.length > 0) return false;
  const { entries, at } = intent.trail;
  const current = entries[at];
  if (!current?.pushed || current.query !== intent.seen) return false;
  if (!new URLSearchParams(current.query).has("session")) return false;
  return entries[at - 1]?.query === applyPerformanceParams(current.query, { session: null });
}

/**
 * The URL as the tab's single source of truth for its raw selections.
 *
 * Deliberate choices push and automatic normalisation replaces; both compose
 * against the latest *intended* query, so two clicks before the router
 * re-renders keep each other and stay separately reversible. A patch that
 * leaves the query unchanged writes nothing.
 */
function usePerformanceUrl() {
  const router = useRouter();
  const urlQuery = useSearchParams().toString();
  const [stored, setStored] = useState<UrlIntent>(() => ({
    seen: urlQuery,
    intended: urlQuery,
    inFlight: null,
    queued: [],
    trail: freshTrail(urlQuery),
  }));
  // Derived during render (React's "adjust state on prop change" pattern) so a
  // Back/Forward never renders one frame of the previous entry's filters.
  const intent = rehydrate(stored, urlQuery);
  if (intent !== stored) setStored(intent);

  // Handlers and effects read the newest intent through this ref: a second
  // click can arrive before the first one's re-render.
  const latest = useRef(intent);
  useLayoutEffect(() => {
    latest.current = intent;
  });

  // Hand the next queued navigation to the router once it is free.
  const dispatch = useCallback(() => {
    const current = latest.current;
    if (current.inFlight !== null || current.queued.length === 0) return;
    const [next, ...rest] = current.queued;
    const updated = {
      ...current,
      inFlight: next.query,
      queued: rest,
      trail: record(current.trail, next.query, next.mode),
    };
    latest.current = updated;
    setStored(updated);
    router[next.mode](`?${next.query}`, { scroll: false });
  }, [router]);

  useEffect(dispatch, [intent, dispatch]);

  const navigate = useCallback(
    (patch: PerformanceUrlPatch, mode: NavigateMode) => {
      const current = latest.current;
      const next = applyPerformanceParams(current.intended, patch);
      if (next === current.intended) return;
      latest.current = {
        ...current,
        intended: next,
        queued: [...current.queued, { query: next, mode }],
      };
      setStored(latest.current);
      dispatch();
    },
    [dispatch]
  );

  /**
   * Leave the open report. Browser Back when the tab can prove the entry
   * behind this one is the report's own overview, so the report's step is
   * consumed rather than doubled. Otherwise (a direct link, a reload, a
   * remount, a replaced entry) drop only the report from this entry, which
   * keeps every filter and never leaves the app.
   */
  const closeReport = useCallback(() => {
    if (reportFollowsItsOverview(latest.current)) router.back();
    else navigate({ session: null }, "replace");
  }, [router, navigate]);

  return { query: intent.intended, latest, navigate, closeReport };
}

/** The raw selections a query describes. */
function readQuery(query: string): PerformanceUrlState {
  return readPerformanceParams(new URLSearchParams(query));
}

/**
 * The program the tab is scoped to. An authorised locked program (centre and
 * PMU pages) wins over anything the URL or history says; otherwise the URL's
 * program; otherwise a school's only program, derived rather than written.
 */
function resolveProgram(
  lockedProgram: string | undefined,
  urlProgram: string | null,
  programs: string[] | null
): string | null {
  if (lockedProgram) return lockedProgram;
  if (urlProgram) return urlProgram;
  return programs?.length === 1 ? programs[0] : null;
}

/** One grades response, tagged with the School/Program it was asked for. */
interface GradesResult {
  key: string;
  grades?: number[];
  error?: string;
}

/**
 * Loads the programs and grades available for this school and program scope.
 *
 * Every response is bound to the School/Program it was requested for: once
 * the scope moves on (a click or Back/Forward), a late success or failure for
 * the old scope is ignored, and the new scope starts with no error and no
 * grades until its own answer arrives.
 */
function useProgramsAndGrades(
  schoolUdise: string,
  lockedProgram: string | undefined,
  urlProgram: string | null
) {
  const [schoolPrograms, setSchoolPrograms] = useState<{ udise: string; programs: string[] } | null>(null);
  const [result, setResult] = useState<GradesResult | null>(null);

  const programs = schoolPrograms?.udise === schoolUdise ? schoolPrograms.programs : null;
  const program = resolveProgram(lockedProgram, urlProgram, programs);
  const key = `${schoolUdise}|${program ?? ""}`;

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const programParam = program ? `?program=${encodeURIComponent(program)}` : "";
    fetch(`/api/quiz-analytics/${schoolUdise}/grades${programParam}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch grades");
        return res.json();
      })
      .then((data: { grades: number[]; programs: string[] }) => {
        if (!current) return;
        setSchoolPrograms({ udise: schoolUdise, programs: data.programs });
        setResult({ key, grades: data.grades });
      })
      .catch((err) => {
        if (!current || err.name === "AbortError") return;
        console.error("Failed to fetch grades:", err);
        setResult({ key, error: "Failed to load quiz data" });
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key encodes schoolUdise + program

  const loaded = result?.key === key ? result : null;
  return {
    program,
    programs,
    grades: loaded?.grades ?? null,
    error: loaded?.error ?? null,
  };
}

/**
 * Keeps the URL's grade valid for the loaded grade list, by replace so it adds
 * no history entry. Re-reads the newest intent when it fires, so a grade that
 * Back/Forward restored meanwhile is what gets checked — never overwritten
 * with a pick computed for an older entry — and does nothing if the program
 * has moved on since these grades were loaded.
 */
function useGradeNormalization({
  grades,
  program,
  urlGrade,
  latest,
  navigate,
  scopeFor,
}: {
  grades: number[] | null;
  program: string | null;
  urlGrade: number | null;
  latest: { current: UrlIntent };
  navigate: (patch: PerformanceUrlPatch, mode: NavigateMode) => void;
  scopeFor: (urlProgram: string | null) => string | null;
}) {
  useEffect(() => {
    if (grades === null) return;
    const newest = readQuery(latest.current.intended);
    if (scopeFor(newest.program) !== program) return;
    const nextGrade = reconcileGrade(grades, newest.grade);
    if (nextGrade !== KEEP_GRADE) navigate({ grade: nextGrade }, "replace");
  }, [grades, program, urlGrade]); // eslint-disable-line react-hooks/exhaustive-deps
}

interface FilterOptions {
  streams: string[];
  subjects: string[];
  testGrades: number[];
}

const NO_OPTIONS: FilterOptions = { streams: [], subjects: [], testGrades: [] };

function sameList<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameOptions(a: FilterOptions & { key: string }, b: FilterOptions & { key: string }): boolean {
  return (
    a.key === b.key &&
    sameList(a.streams, b.streams) &&
    sameList(a.subjects, b.subjects) &&
    sameList(a.testGrades, b.testGrades)
  );
}

/**
 * The stream/subject/test-grade options the overview publishes, bound to the
 * School/Program/Grade they were published for. A publication for
 * any other intent is dropped, and options for an intent the overview hasn't
 * published yet read as empty.
 */
function useFilterOptions(intentKey: string) {
  const [options, setOptions] = useState<(FilterOptions & { key: string }) | null>(null);
  const currentKey = useRef(intentKey);
  useLayoutEffect(() => {
    currentKey.current = intentKey;
  });

  const handleFilterOptions = useCallback(
    (opts: FilterOptions) => {
      if (intentKey !== currentKey.current) return;
      const next = {
        key: intentKey,
        streams: opts.streams ?? [],
        subjects: opts.subjects ?? [],
        testGrades: opts.testGrades ?? [],
      };
      // Re-publishing the same options must not re-render the tab, or an
      // overview that publishes on render would loop.
      setOptions((prev) => (prev && sameOptions(prev, next) ? prev : next));
    },
    [intentKey]
  );

  return {
    options: options?.key === intentKey ? options : NO_OPTIONS,
    handleFilterOptions,
  };
}

/**
 * The name of the open report. A report reached by URL starts nameless and
 * takes its name from its data; a name is only ever shown for the session it
 * was given for.
 */
function useReportName(session: string | null) {
  const [named, setNamed] = useState<{ session: string; name: string } | null>(null);

  const handleDeepDiveData = useCallback(
    (testName: string) => {
      if (!session) return;
      setNamed((prev) =>
        prev?.session === session && prev.name ? prev : { session, name: testName }
      );
    },
    [session]
  );

  const deepDiveSession = session
    ? { sessionId: session, testName: named?.session === session ? named.name : "" }
    : null;
  return { deepDiveSession, setNamed, handleDeepDiveData };
}

/** What the handlers compare against and write through. */
interface HandlerContext {
  selectedProgram: string | null;
  selectedGrade: number | null;
  selectedStream: string | null;
  effective: OverridableSelection;
  navigate: (patch: PerformanceUrlPatch, mode: NavigateMode) => void;
  closeReport: () => void;
  nameReport: (v: { session: string; name: string }) => void;
}

/**
 * Builds the tab's event handlers.
 *
 * Each deliberate choice is one push carrying its dependent resets, so Back
 * undoes the whole choice at once. Choosing what is already selected does
 * nothing at all — no reset, no history entry.
 */
function createPerformanceHandlers({
  selectedProgram,
  selectedGrade,
  selectedStream,
  effective,
  navigate,
  closeReport,
  nameReport,
}: HandlerContext) {
  const push = (patch: PerformanceUrlPatch) => navigate(patch, "push");

  const handleProgramChange = (program: string) => {
    if (program === selectedProgram) return;
    // Category and Per Test/Cumulative carry across programs; the rest don't.
    push({ program, grade: null, session: null, stream: null, subject: null, testGrade: null });
  };

  const handleGradeChange = (grade: number) => {
    if (grade === selectedGrade) return;
    push({ grade, session: null, stream: null, subject: null, testGrade: null });
  };

  // 0 is the "All test grades" sentinel — a segmented control needs a concrete
  // value for the all-option, and no test targets grade 0.
  const handleTestGradeChange = (value: number) => {
    const testGrade = value === 0 ? null : value;
    if (testGrade === effective.testGrade) return;
    push({ testGrade });
  };

  // Opening a report is a step of its own, so Back closes it and Forward
  // reopens it with the overview's filters intact.
  const handleTestClick = (sessionId: string, testName: string) => {
    nameReport({ session: sessionId, name: testName });
    push({ session: sessionId });
  };

  const handleBack = closeReport;

  const handleCategoryChange = (cat: TestCategory) => {
    if (cat === effective.testCategory) return;
    // Chapter and full tests can target different grades, so a test-grade
    // selection from one category may not exist in the other. The subject
    // filter is chapter-only, so it goes when leaving Chapter tests.
    push({ category: cat, testGrade: null, subject: cat === "chapter" ? undefined : null });
  };

  const handleStreamChange = (stream: string | null) => {
    if (stream === selectedStream) return;
    push({ stream });
  };

  const handleSubjectChange = (subject: string | null) => {
    if (subject === effective.subject) return;
    push({ subject });
  };

  const handleFullViewChange = (view: FullTestView) => {
    if (view === effective.fullTestView) return;
    push({ view });
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
 * Everything the Performance tab remembers and every way it changes: the
 * filter state, the programs/grades fetch, the URL sync, and the handlers the
 * controls call.
 *
 * The URL is the state: every raw selection is read from the latest intended
 * query on each render, so Back/Forward restores the whole tab in place.
 * Nothing in the component mutates state directly.
 */
export function usePerformanceFilters({
  schoolUdise,
  lockedProgram,
}: {
  schoolUdise: string;
  lockedProgram?: string;
}) {
  const { query, latest, navigate, closeReport } = usePerformanceUrl();
  const raw = readQuery(query);

  const { program, programs, grades, error } = useProgramsAndGrades(
    schoolUdise,
    lockedProgram,
    raw.program
  );

  useGradeNormalization({
    grades,
    program,
    urlGrade: raw.grade,
    latest,
    navigate,
    scopeFor: (urlProgram) => resolveProgram(lockedProgram, urlProgram, programs),
  });

  // NVS schools get a narrower Performance tab (mandated tests only).
  const isNvs = isNvsProgram(program);
  const effective = effectiveSelection(isNvs, {
    testCategory: raw.category,
    fullTestView: raw.view,
    subject: raw.subject,
    testGrade: raw.testGrade,
  });

  // Options belong to one School/Program/Grade overview. Stream and category
  // changes re-publish from the overview itself, which only ever publishes for
  // its current request, so they keep the groups on screen meanwhile.
  const { options, handleFilterOptions } = useFilterOptions(
    [schoolUdise, program, raw.grade].join("|")
  );
  const { deepDiveSession, setNamed, handleDeepDiveData } = useReportName(raw.session);

  const handlers = createPerformanceHandlers({
    selectedProgram: program,
    selectedGrade: raw.grade,
    selectedStream: raw.stream,
    effective,
    navigate,
    closeReport,
    nameReport: setNamed,
  });

  // The filter scope every data component receives. Narrowed from null to
  // undefined once here rather than at each of the ten-odd prop sites, where
  // the repetition was both noise and a place for one of them to disagree.
  const scope: PerformanceScope = {
    program: program || undefined,
    stream: raw.stream || undefined,
    subject: effective.subject || undefined,
    testGrade: effective.testGrade ?? undefined,
  };

  return {
    // Loaded data
    programs,
    grades,
    error,
    // Current selection
    selectedProgram: program,
    isNvs,
    selectedGrade: raw.grade,
    selectedStream: raw.stream,
    selectedSubject: effective.subject,
    selectedTestGrade: effective.testGrade,
    testCategory: effective.testCategory,
    fullTestView: effective.fullTestView,
    deepDiveSession,
    scope,
    // Options offered by the loaded test set
    availableStreams: options.streams,
    availableSubjects: options.subjects,
    availableTestGrades: options.testGrades,
    // Handlers — the nine filter/navigation ones come from the factory; the
    // two below are memoised because children hold onto them.
    ...handlers,
    handleDeepDiveData,
    handleFilterOptions,
  };
}
