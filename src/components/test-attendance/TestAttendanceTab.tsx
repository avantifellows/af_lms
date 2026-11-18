"use client";

// The School page's Test Attendance tab (#517, NVS Schools only). Loads the
// School's Test Attendance from the read endpoint; the response shape and the
// rules come from the client-safe rules module. A failed load shows an error
// with Retry, never zeros.
import { useCallback, useEffect, useState } from "react";

import { Button, Card } from "@/components/ui";
import type { TestAttendanceResponse } from "@/lib/test-attendance-rules";

type LoadState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; data: TestAttendanceResponse };

export default function TestAttendanceTab({ schoolUdise }: { schoolUdise: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

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
  return (
    <div className="space-y-4">
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
    </div>
  );
}
