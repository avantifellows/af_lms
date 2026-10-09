import type { ReactNode } from "react";

/** A titled panel with an accent rule under the heading (Quiz Sessions, Teacher Feedback). */
export function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card shadow-sm">
      <div className="border-b-2 border-border-accent px-4 py-3">
        <div className="text-sm font-bold uppercase tracking-wide text-text-primary">{title}</div>
        {subtitle ? <div className="mt-1 text-xs text-text-secondary">{subtitle}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
