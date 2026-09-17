"use client";

import type { ReactElement } from "react";

/** The tab's flat "nothing to show yet" panel, used for both the prompts
 *  (pick a program, pick a grade) and the no-data message. */
export function PerformanceNotice({ children }: { children: string }) {
  return (
    <div className="p-8 text-center bg-bg-card-alt border border-border rounded-lg shadow-sm">
      <p className="text-sm text-text-muted">{children}</p>
    </div>
  );
}

/** Either the tab has nothing to render yet and this is what to show, or it is
 *  ready — in which case the loaded programs and grades come back non-null, so
 *  the caller gets its narrowing from the same check that did the work. */
export type PerformanceLoadState =
  | { status: "pending"; element: ReactElement }
  | { status: "ready"; programs: string[]; grades: number[] };

/**
 * The states the tab can be in before it has anything to render: failed, still
 * loading, or loaded-but-empty.
 *
 * A function rather than a component so the caller can `return` its element
 * directly — these are genuine early exits, and the three `if`s they replace
 * were branches of the complexity the CRAP gate measures.
 */
export function performanceLoadState({
  error,
  programs,
  grades,
}: {
  error: string | null;
  programs: string[] | null;
  grades: number[] | null;
}): PerformanceLoadState {
  if (error) {
    return {
      status: "pending",
      element: (
        <div className="p-4 bg-danger-bg border border-danger text-danger rounded-lg">
          {error}
        </div>
      ),
    };
  }

  if (programs === null || grades === null) {
    return {
      status: "pending",
      element: (
        <div className="flex justify-center items-center h-[30vh]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
          <span className="ml-3 text-sm text-text-secondary">Loading quiz data...</span>
        </div>
      ),
    };
  }

  if (programs.length === 0 && grades.length === 0) {
    return {
      status: "pending",
      element: (
        <PerformanceNotice>No quiz data available for this school yet.</PerformanceNotice>
      ),
    };
  }

  return { status: "ready", programs, grades };
}
