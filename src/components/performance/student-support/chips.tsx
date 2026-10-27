"use client";

import type { AlStatus, ChapterFlag } from "@/types/student-support";

const BASE = "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide";

// warning-text / warning-border are the defined tokens; the shared alChipColor's
// text-warning has no token behind it, so M3 / B3 are styled here.
function levelClass(level: string): string {
  if (level === "M1" || level === "B1") return "bg-success-bg text-success border-success/30";
  if (level === "M2" || level === "B2") return "bg-success-bg/50 text-success border-success/20";
  if (level === "M3" || level === "B3") return "bg-warning-bg text-warning-text border-warning-border";
  return "bg-bg-card-alt text-text-muted border-border";
}

export function LevelChip({ level }: { level: string | null }) {
  if (!level) return <span className="text-text-muted">—</span>;
  const label = level === "Not Eligible for Academic Level" ? "NE" : level;
  return <span className={`${BASE} ${levelClass(level)}`}>{label}</span>;
}

const STATUS_CLASS: Record<AlStatus, string> = {
  Sliding: "bg-danger-bg text-danger border-danger/30",
  Same: "bg-bg-card-alt text-text-muted border-border",
  Improving: "bg-success-bg text-success border-success/30",
};

export function StatusChip({ status }: { status: AlStatus | null }) {
  if (!status) return <span className="text-text-muted">—</span>;
  return <span className={`${BASE} ${STATUS_CLASS[status]}`}>{status}</span>;
}

export const FLAG_LABEL: Record<ChapterFlag, string> = { C: "Concept gap", S: "Skipping" };

export function FlagChip({ flag }: { flag: ChapterFlag | null }) {
  if (!flag) return null;
  const cls =
    flag === "C"
      ? "bg-danger-bg text-danger border-danger/30"
      : "bg-warning-bg text-warning-text border-warning-border";
  return (
    <span className={`${BASE} ${cls}`} title={FLAG_LABEL[flag]}>
      {flag} · {FLAG_LABEL[flag]}
    </span>
  );
}

/** A horizontal score bar, red when below the pass mark. */
export function ScoreBar({ value, pass }: { value: number | null; pass: number }) {
  if (value === null) return <span className="text-text-muted">—</span>;
  const below = value < pass;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-2 w-24 overflow-hidden rounded bg-bg-card-alt">
        <span
          className={`absolute inset-y-0 left-0 ${below ? "bg-danger" : "bg-success"}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      <span className={`tabular-nums text-xs ${below ? "text-danger font-semibold" : ""}`}>{value}%</span>
    </span>
  );
}
