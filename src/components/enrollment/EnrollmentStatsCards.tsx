"use client";

import { Card } from "@/components/ui/Card";
import type { ProgramStats } from "@/lib/enrollment-stats";
import type { AdmissionSummary } from "@/lib/enrollment-readiness";

export type { ProgramStats };

interface Props {
  programs: ProgramStats[];
  selectedId: number;
  onSelect: (programId: number) => void;
  /**
   * Grade 11/12 admission figures, already scoped to the active grade filter.
   * null when a non-admission grade is selected (the row is hidden then).
   */
  admission?: AdmissionSummary | null;
  consentLoading?: boolean;
  consentError?: boolean;
}

function Pill({ label, count }: { label: string; count: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full border border-border bg-bg-card-alt px-2.5 py-0.5 text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono font-bold text-text-primary">{count}</span>
    </span>
  );
}

// ℹ️ trigger with a plain-language explanation. Shown on hover for desktop
// and on tap/focus for touch devices, where hover doesn't exist.
function InfoHint({ text }: { text: string }) {
  return (
    <button
      type="button"
      aria-label={text}
      className="group relative inline-flex items-center text-text-muted hover:text-text-primary focus:text-text-primary focus:outline-none"
    >
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0ZM9 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM6.75 8a.75.75 0 0 0 0 1.5h.75v1.75a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8.25 8h-1.5Z"
        />
      </svg>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-1.5 w-60 -translate-x-1/2 rounded-md bg-text-primary px-2.5 py-1.5 text-[11px] font-normal normal-case tracking-normal text-bg-card opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100"
      >
        {text}
      </span>
    </button>
  );
}

// Like Pill, but the value is a preformatted string (e.g. "75%", "…", "—").
function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full border border-border bg-bg-card-alt px-2.5 py-0.5 text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono font-bold text-text-primary">{value}</span>
    </span>
  );
}

function StatRow({
  label,
  items,
  formatItemLabel,
}: {
  label: string;
  items: { value: string; count: number }[];
  formatItemLabel?: (v: string) => string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-text-muted min-w-[5rem]">
          {label}
        </span>
        <span className="text-xs text-text-muted">No data</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
      <span className="text-xs font-bold uppercase tracking-wide text-text-muted min-w-[5rem]">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Pill
            key={item.value}
            label={formatItemLabel ? formatItemLabel(item.value) : item.value}
            count={item.count}
          />
        ))}
      </div>
    </div>
  );
}

export default function EnrollmentStatsCards({
  programs,
  selectedId,
  onSelect,
  admission,
  consentLoading = false,
  consentError = false,
}: Props) {
  if (programs.length === 0) return null;

  const selected = programs.find((p) => p.id === selectedId) ?? programs[0];
  const showTabs = programs.length > 1;

  // Reformat grade entries for the shared row component.
  const gradeItems = selected.byGrade.map((g) => ({
    value: String(g.grade),
    count: g.count,
  }));

  return (
    <div className="space-y-3 mb-6">
      {showTabs && (
        <div className="flex gap-1 flex-wrap">
          {programs.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`px-3 md:px-4 py-1.5 md:py-2 min-h-[44px] text-xs md:text-sm font-bold uppercase tracking-wide rounded-lg transition-colors ${
                selected.id === p.id
                  ? "bg-accent text-text-on-accent shadow-sm"
                  : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <Card elevation="md" className="p-5">
        <div
          className="flex items-baseline gap-2 mb-3"
          data-testid="enrollment-stats-header"
        >
          <h2 className="text-base font-semibold text-text-primary">
            {selected.label} Students
          </h2>
          <span className="text-text-muted">·</span>
          <span
            className="text-base font-mono font-bold text-text-primary"
            data-testid="enrollment-stats-total"
          >
            {selected.total}
          </span>
        </div>

        <div className="space-y-2">
          <StatRow
            label="Grade"
            items={gradeItems}
            formatItemLabel={(v) => `Grade ${v}`}
          />
          <StatRow label="Gender" items={selected.byGender} />
          <StatRow label="Category" items={selected.byCategory} />

          {/* Grade 11/12 admission tracking — compact, scoped to the grade
              filter. Hidden when a non-admission grade is selected. */}
          {admission && (
            <div
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-t border-border pt-2"
              data-testid="admission-stats-row"
            >
              <span className="inline-flex items-center gap-1 min-w-[5rem]">
                <span className="text-xs font-bold uppercase tracking-wide text-text-muted">
                  Admission
                </span>
                <InfoHint text="% Info — students with all profile details filled in. % Docs — required consent documents uploaded." />
              </span>
              <div className="flex flex-wrap gap-1.5">
                <MetricPill
                  label="% Info"
                  value={`${admission.infoAvailablePct}%`}
                />
                <MetricPill
                  label="% Docs"
                  value={
                    consentLoading ? "…" : consentError ? "—" : `${admission.docsAvailablePct}%`
                  }
                />
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
