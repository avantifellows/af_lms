"use client";

// The School page's Test Attendance tab (#517, NVS Schools only). Loads the
// School's Test Attendance from the read endpoint; the response shape and the
// rules come from the client-safe rules module. A failed load shows an error
// with Retry, never zeros.
import { useCallback, useEffect, useState } from "react";

import { Button, Card } from "@/components/ui";
import MonthPage from "@/components/test-attendance/MonthPage";
import {
  closingTimeText,
  type TestAttendanceMonthlyTest,
  type TestAttendanceResponse,
} from "@/lib/test-attendance-rules";

type LoadState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; data: TestAttendanceResponse };

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
                <span className="ml-1 rounded-full bg-success-bg px-1.5 py-0.5 text-[10px] font-bold uppercase text-success">
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

function MonthBanner({ test, serverTime }: { test: TestAttendanceMonthlyTest; serverTime: string }) {
  const text =
    test.state === "running"
      ? `${test.name} tests are running. They close ${closingTimeText(test.closesAt, serverTime)}`
      : `${test.name} tests have closed.`;
  return (
    <Card elevation="sm" className="p-4">
      <p className="text-sm font-medium text-text-primary">{text}</p>
    </Card>
  );
}

export default function TestAttendanceTab({ schoolUdise }: { schoolUdise: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState<Period>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/school/${encodeURIComponent(schoolUdise)}/test-attendance`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as TestAttendanceResponse;
        if (!cancelled) setState({ status: "loaded", data });
      } catch {
        if (!cancelled) setState({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolUdise, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  if (state.status === "loading") {
    return <p className="py-8 text-center text-sm text-text-muted">Loading Test Attendance…</p>;
  }

  if (state.status === "failed") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger bg-danger-bg p-4">
        <p className="text-sm text-text-primary">Couldn&apos;t load Test Attendance. Please try again.</p>
        <Button variant="secondary" size="sm" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }

  const { data } = state;
  const selected = data.monthlyTests.find((test) => test.key === period);
  return (
    <div className="space-y-4">
      {data.monthlyTests.length > 0 && (
        <PeriodStrip monthlyTests={data.monthlyTests} period={selected ? selected.key : "all"} onChange={setPeriod} />
      )}
      {selected ? (
        <>
          <MonthBanner test={selected} serverTime={data.serverTime} />
          {/* Keyed so a newly opened month starts on its default list filter. */}
          <MonthPage key={selected.key} test={selected} students={data.students} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <section aria-label="Enrolled">
              <Card elevation="sm" className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Enrolled</p>
                <p className="mt-1 text-2xl font-bold text-text-primary">{data.students.length}</p>
              </Card>
            </section>
          </div>
          {data.monthlyTests.length === 0 && (
            <Card elevation="sm" className="p-6 text-center">
              <p className="text-sm text-text-muted">No Monthly Tests yet</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
