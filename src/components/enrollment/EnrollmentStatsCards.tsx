"use client";

import { Card } from "@/components/ui/Card";
import type { ProgramStats } from "@/lib/enrollment-stats";

export type { ProgramStats };

interface Props {
  programs: ProgramStats[];
  selectedId: number;
  onSelect: (programId: number) => void;
}

function Pill({ label, count }: { label: string; count: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full border border-border bg-bg-card-alt px-2.5 py-0.5 text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono font-bold text-text-primary">{count}</span>
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
        </div>
      </Card>
    </div>
  );
}
