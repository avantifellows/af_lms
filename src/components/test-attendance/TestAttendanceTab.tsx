"use client";

// The School page's Test Attendance tab (#517, NVS Schools only). Loads the
// School's Test Attendance from the read endpoint; the response shape and the
// rules come from the client-safe rules module. A failed load shows an error
// with Retry, never zeros.
//
// It opens on the running Monthly Test (else All year), chosen once from the
// first load. While the selected period is a running Monthly Test it fetches
// again every 15 minutes and on Refresh; the period and filters stay set.
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Card } from "@/components/ui";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import AllYearPage from "@/components/test-attendance/AllYearPage";
import MonthPage from "@/components/test-attendance/MonthPage";
import { testAttendanceExportQuery } from "@/lib/test-attendance-export";
import {
  ALL_STUDENTS,
  closingTimeText,
  defaultPeriod,
  examPreparingForOptions,
  filterStudents,
  lastRefreshedText,
  type AllYearListFilter,
  type MonthListFilter,
  type TestAttendanceFilters,
  type TestAttendanceMonthlyTest,
  type TestAttendanceResponse,
} from "@/lib/test-attendance-rules";

type LoadState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; data: TestAttendanceResponse; refreshing: boolean };

/** How often a running Monthly Test's page fetches again. The warehouse table changes every 15 minutes. */
const REFRESH_EVERY_MS = 15 * 60 * 1000;

/** "All year", or a Monthly Test key. Component state only; not in the URL. */
type Period = "all" | string;

function PeriodStrip({
  monthlyTests,
  period,
  onChange,
}: {
  monthlyTests: TestAttendanceMonthlyTest[];
  period: Period;
  onChange: (period: Period) => void;
}) {
  // The response is ordered by closing time; the strip shows newest first.
  const options = [
    { value: "all", label: "All year", live: false },
    ...[...monthlyTests].reverse().map((test) => ({ value: test.key, label: test.name, live: test.state === "running" })),
  ];
  return (
    <div role="group" aria-label="Period" className="inline-flex flex-wrap overflow-hidden rounded-lg border border-border bg-bg-card-alt shadow-sm">
      {options.map((option, i) => {
        const active = option.value === period;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`min-h-[44px] px-3 text-xs font-bold transition-colors md:px-4 md:text-sm ${
              i > 0 ? "border-l border-border" : ""
            } ${active ? "bg-accent text-text-on-accent" : "text-text-secondary hover:bg-hover-bg hover:text-text-primary"}`}
          >
            {option.label}
            {option.live && (
              <>
                {" "}
                {/* White on the selected button's red (6.5:1); white on solid green otherwise (6.4:1), so it reads on hover too. */}
                <span
                  className={`ml-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase text-text-on-accent ${
                    active ? "border-text-on-accent" : "border-success bg-success"
                  }`}
                >
                  live
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

const GRADE_OPTIONS: { value: TestAttendanceFilters["grade"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: 11, label: "11" },
  { value: 12, label: "12" },
];

/** Grade and Exam Preparing For: they apply to every number and list on the tab. */
function Filters({
  students,
  filters,
  onChange,
}: {
  students: TestAttendanceResponse["students"];
  filters: TestAttendanceFilters;
  onChange: (filters: TestAttendanceFilters) => void;
}) {
  const available = examPreparingForOptions(students);
  // A fetch can leave nobody in the selected group ("Not set"); keep it offered
  // so the selection stays visible rather than no option showing pressed.
  const selected = filters.examPreparingFor;
  const values = selected === "all" || available.includes(selected) ? available : [...available, selected];
  const examOptions: { value: TestAttendanceFilters["examPreparingFor"]; label: string }[] = [
    { value: "all", label: "All" },
    ...values.map((value) => ({ value, label: value })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <SegmentedControl
        label="Grade"
        options={GRADE_OPTIONS}
        value={filters.grade}
        onChange={(grade) => onChange({ ...filters, grade })}
      />
      <SegmentedControl
        label="Exam Preparing For"
        wrap
        options={examOptions}
        value={filters.examPreparingFor}
        onChange={(examPreparingFor) => onChange({ ...filters, examPreparingFor })}
      />
    </div>
  );
}

function MonthBanner({
  test,
  data,
  refreshing,
  onRefresh,
}: {
  test: TestAttendanceMonthlyTest;
  data: TestAttendanceResponse;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  if (test.state === "closed") {
    return (
      <Card elevation="sm" className="p-4">
        <p className="text-sm font-medium text-text-primary">{test.name} tests have closed.</p>
      </Card>
    );
  }
  const refreshed = lastRefreshedText(data.lastRefreshed, data.serverTime);
  return (
    <Card elevation="sm" className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <p className="text-sm font-medium text-text-primary">
        {test.name} tests are running. They close {closingTimeText(test.closesAt, data.serverTime)}
      </p>
      <p className="text-xs text-text-muted">
        {refreshed === "unknown" ? "Last refreshed: unknown" : `Last refreshed ${refreshed}`}
      </p>
      <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? "Refreshing…" : "Refresh"}
      </Button>
    </Card>
  );
}

/**
 * Loads the tab's data and keeps it fresh: one fetch on mount, Retry after a
 * failure, Refresh on demand, and a 15-minute timer while a running Monthly
 * Test is selected.
 */
function useTestAttendance(schoolUdise: string) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Null until the first successful load picks the default; a later fetch never changes it.
  const [period, setPeriod] = useState<Period | null>(null);
  // Only the latest request may set state, and none after unmount.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const response = await fetch(`/api/school/${encodeURIComponent(schoolUdise)}/test-attendance`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as TestAttendanceResponse;
      if (request !== latestRequest.current) return;
      setPeriod((current) => current ?? defaultPeriod(data.monthlyTests));
      setState({ status: "loaded", data, refreshing: false });
    } catch {
      if (request === latestRequest.current) setState({ status: "failed" });
    }
  }, [schoolUdise]);

  useEffect(() => {
    const requests = latestRequest;
    void load();
    return () => {
      requests.current++;
    };
  }, [load]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    void load();
  }, [load]);

  // Keeps the page on screen while it fetches again.
  const refresh = useCallback(() => {
    setState((current) => (current.status === "loaded" ? { ...current, refreshing: true } : current));
    void load();
  }, [load]);

  const loaded = state.status === "loaded" ? state.data : null;
  const runningSelected = loaded?.monthlyTests.some((test) => test.key === period && test.state === "running") ?? false;
  // A timer only while a running Monthly Test is selected; each fetch restarts it.
  useEffect(() => {
    if (!runningSelected) return;
    const timer = setTimeout(refresh, REFRESH_EVERY_MS);
    return () => clearTimeout(timer);
  }, [runningSelected, loaded, refresh]);

  return { state, period, setPeriod, retry, refresh };
}

/** A School with no Monthly Tests in the PMU test set list yet: the Enrolled count only. */
function NoMonthlyTests({ enrolled }: { enrolled: number }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <section aria-label="Enrolled">
          <Card elevation="sm" className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Enrolled</p>
            <p className="mt-1 text-2xl font-bold text-text-primary">{enrolled}</p>
          </Card>
        </section>
      </div>
      <Card elevation="sm" className="p-6 text-center">
        <p className="text-sm text-text-muted">No Monthly Tests yet</p>
      </Card>
    </>
  );
}

/** The loaded tab: filters, the period strip, and the selected period's page. */
function LoadedTab({
  schoolUdise,
  data,
  refreshing,
  period,
  filters,
  onPeriodChange,
  onFiltersChange,
  onRefresh,
}: {
  schoolUdise: string;
  data: TestAttendanceResponse;
  refreshing: boolean;
  period: Period | null;
  filters: TestAttendanceFilters;
  onPeriodChange: (period: Period) => void;
  onFiltersChange: (filters: TestAttendanceFilters) => void;
  onRefresh: () => void;
}) {
  const selected = data.monthlyTests.find((test) => test.key === period);
  const periodKey = selected ? selected.key : "all";
  // Filtering and counting happen here, from the response already loaded: no new request.
  const students = filterStudents(data.students, filters);
  // The file holds the list on screen: this period, these filters, that list filter.
  const download = (list: MonthListFilter | AllYearListFilter) =>
    window.location.assign(
      `/api/school/${encodeURIComponent(schoolUdise)}/test-attendance/export?${testAttendanceExportQuery({
        period: periodKey,
        filters,
        list,
      })}`,
    );

  if (data.monthlyTests.length === 0) {
    return (
      <div className="space-y-4">
        <Filters students={data.students} filters={filters} onChange={onFiltersChange} />
        <NoMonthlyTests enrolled={students.length} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Filters students={data.students} filters={filters} onChange={onFiltersChange} />
      <PeriodStrip monthlyTests={data.monthlyTests} period={periodKey} onChange={onPeriodChange} />
      {selected ? (
        <>
          <MonthBanner test={selected} data={data} refreshing={refreshing} onRefresh={onRefresh} />
          {/* Keyed so a newly opened month starts on its default list filter. */}
          <MonthPage
            key={selected.key}
            test={selected}
            monthlyTests={data.monthlyTests}
            students={students}
            onDownload={download}
          />
        </>
      ) : (
        <AllYearPage monthlyTests={data.monthlyTests} students={students} onDownload={download} />
      )}
    </div>
  );
}

export default function TestAttendanceTab({ schoolUdise }: { schoolUdise: string }) {
  const { state, period, setPeriod, retry, refresh } = useTestAttendance(schoolUdise);
  // Held here, not in LoadedTab, so the filters survive a failed re-fetch and Retry.
  const [filters, setFilters] = useState<TestAttendanceFilters>(ALL_STUDENTS);

  if (state.status === "loading") {
    return <p className="py-8 text-center text-sm text-text-muted">Loading Test Attendance…</p>;
  }

  if (state.status === "failed") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger bg-danger-bg p-4">
        <p className="text-sm text-text-primary">Couldn&apos;t load Test Attendance. Please try again.</p>
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <LoadedTab
      schoolUdise={schoolUdise}
      data={state.data}
      refreshing={state.refreshing}
      period={period}
      filters={filters}
      onPeriodChange={setPeriod}
      onFiltersChange={setFilters}
      onRefresh={refresh}
    />
  );
}
