"use client";

import { ReactNode } from "react";

interface DetailGroupProps {
  /** Section title shown in the card header. */
  title: string;
  /** Grid column count at the `sm` breakpoint (defaults to 3). */
  columns?: 2 | 3 | 4;
  className?: string;
  /** `DetailField` cells (or any nodes) laid out in the grid. */
  children: ReactNode;
}

const columnClasses: Record<NonNullable<DetailGroupProps["columns"]>, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};

/**
 * A titled card that groups related read-only fields (e.g. `DetailField`s) into
 * a responsive grid. Pairs with `DetailField` for detail/summary views.
 */
export function DetailGroup({ title, columns = 3, className = "", children }: DetailGroupProps) {
  return (
    <section className={`rounded-lg border border-border bg-bg-card p-4 shadow-sm ${className}`}>
      <h4 className="mb-3 border-b border-border pb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
        {title}
      </h4>
      <div className={`grid grid-cols-2 ${columnClasses[columns]} gap-x-6 gap-y-4 text-sm`}>
        {children}
      </div>
    </section>
  );
}
