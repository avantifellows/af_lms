"use client";

import { ReactNode } from "react";

interface DetailFieldProps {
  /** Uppercase label shown above the value. */
  label: string;
  /** Plain value; falls back to an em-dash when empty. Ignored if `children` is set. */
  value?: string | null;
  /** Extra classes applied to the value text (e.g. `capitalize`, `truncate`). */
  className?: string;
  /** Custom value content (e.g. a badge) rendered instead of `value`. */
  children?: ReactNode;
}

/**
 * A read-only labelled value cell for detail/summary views: a small uppercase
 * label with the value (or custom `children`) beneath it.
 */
export function DetailField({ label, value, className = "", children }: DetailFieldProps) {
  return (
    <div>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      {children ? (
        <div className="mt-1">{children}</div>
      ) : (
        <p className={`mt-1 text-gray-900 ${className}`}>{value || "—"}</p>
      )}
    </div>
  );
}
