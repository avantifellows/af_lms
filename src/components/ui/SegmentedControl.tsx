"use client";

import type { ReactNode } from "react";

interface SegmentedOption<T extends string | number> {
  value: T;
  /** Usually text; a node when an option carries a mark (the Test Attendance "live" pill). */
  label: ReactNode;
}

interface Props<T extends string | number> {
  label: string;
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
  /**
   * Let the buttons wrap onto more rows when the group is wider than its
   * container (a long option list on a phone). Off by default, so existing
   * rows keep their single-line shape.
   */
  wrap?: boolean;
  /** Keep the group's label for screen readers only, when the options speak for themselves. */
  hideLabel?: boolean;
}

/**
 * A labelled row of joined buttons, exactly one of which is selected.
 *
 * Replaces the mix of <select>s and loose pill rows the Performance tab used to
 * filter with (#326): teachers found dropdowns easy to miss next to buttons, so
 * every filter now has the same shape — label, then a single bordered group.
 * 44px tall for touch; `aria-pressed` carries the selection for screen readers
 * and for tests.
 */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className = "",
  wrap = false,
  hideLabel = false,
}: Props<T>) {
  return (
    <div
      className={`flex items-center gap-2 flex-wrap ${className}`}
      role="group"
      aria-label={label}
    >
      <span className={hideLabel ? "sr-only" : "text-xs font-bold uppercase tracking-wide text-text-muted"}>{label}</span>
      <div
        className={`inline-flex rounded-lg border border-border bg-bg-card-alt overflow-hidden shadow-sm ${
          wrap ? "flex-wrap max-w-full" : ""
        }`}
      >
        {options.map((opt, i) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              aria-pressed={active}
              // Re-clicking the active option is a no-op, as it was with a
              // <select> — the grade handler resets the deep dive and every
              // other filter, so it must only fire on an actual change.
              onClick={() => {
                if (!active) onChange(opt.value);
              }}
              className={`px-3 md:px-4 min-h-[44px] text-xs md:text-sm font-bold transition-colors ${
                i > 0 ? "border-l border-border" : ""
              } ${
                active
                  ? "bg-accent text-text-on-accent"
                  : "text-text-secondary hover:bg-hover-bg hover:text-text-primary"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
