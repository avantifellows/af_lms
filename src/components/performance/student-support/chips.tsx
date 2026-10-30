"use client";

import { changeDirection } from "@/lib/student-support-rules";
import type { AlStatus, ChapterFlag, ScoreDirection, ScoreTrend, TestChange } from "@/types/student-support";

const BASE = "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide";

// warning-text / warning-border are the defined tokens; the shared alChipColor's
// text-warning has no token behind it, so M3 / B3 are styled here.
function levelClass(level: string): string {
  if (level === "M1" || level === "B1") return "bg-success-bg text-success border-success/30";
  if (level === "M2" || level === "B2") return "bg-success-bg/50 text-success border-success/20";
  if (level === "M3" || level === "B3" || level === "NQ") return "bg-warning-bg text-warning-text border-warning-border";
  return "bg-bg-card-alt text-text-muted border-border";
}

export function LevelChip({ level }: { level: string | null }) {
  if (!level) return <span className="text-text-muted">—</span>;
  const label = level === "Not Eligible for Academic Level" ? "NE" : level;
  return <span className={`${BASE} ${levelClass(level)}`}>{label}</span>;
}

export const STATUS_CLASS: Record<AlStatus, string> = {
  Sliding: "bg-danger-bg text-danger border-danger/30",
  Same: "bg-bg-card-alt text-text-muted border-border",
  Improving: "bg-success-bg text-success border-success/30",
};

export function StatusChip({ status }: { status: AlStatus | null }) {
  if (!status) return <span className="text-text-muted">—</span>;
  return <span className={`${BASE} ${STATUS_CLASS[status]}`}>{status}</span>;
}

const FLAG_LABEL: Record<ChapterFlag, string> = { C: "Concept gap", S: "Skipping" };

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
      <span className={`w-12 text-right tabular-nums text-xs ${below ? "text-danger font-semibold" : ""}`}>{value}%</span>
    </span>
  );
}

const DIRECTION_CLASS: Record<ScoreDirection, string> = {
  Improving: "text-success",
  Declining: "text-danger",
  Same: "text-text-muted",
};

/**
 * The score graph: score % on every non-retest test, joined test to test, the
 * last dot filled. Its colour is the direction over the last few tests.
 */
export function ScoreGraph({ trend }: { trend: ScoreTrend | null }) {
  if (!trend) return <span className="text-text-muted">—</span>;
  const { points } = trend;
  const n = points.length;
  const width = Math.max(112, Math.min(170, 12 * (n - 1) + 6));
  const height = 30;
  const pad = 3;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (n - 1);
  const y = (v: number) => height - pad - (hi === lo ? (height - 2 * pad) / 2 : ((v - lo) * (height - 2 * pad)) / (hi - lo));
  const xy = points.map((v, i) => [x(i).toFixed(1), y(v).toFixed(1)]);
  return (
    <svg
      role="img"
      aria-label={`Score trend: ${trend.direction} over the last ${trend.recent} tests`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={DIRECTION_CLASS[trend.direction]}
    >
      <polyline
        points={xy.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {xy.map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={i === n - 1 ? 2.8 : 2}
          className={i === n - 1 ? "fill-current" : "fill-bg-card"}
          stroke="currentColor"
          strokeWidth={1.3}
        />
      ))}
    </svg>
  );
}

const CHANGE_STYLE = {
  up: { arrow: "▲", className: "text-success font-bold" },
  down: { arrow: "▼", className: "text-danger font-bold" },
  flat: { arrow: "▬", className: "text-text-muted" },
};

/** Marks change vs the previous non-retest test: ▲ / ▼ / ▬ and its size. */
export function ChangeArrow({ change }: { change: TestChange }) {
  const style = CHANGE_STYLE[changeDirection(change.change)];
  return (
    <span className={`text-[11px] tabular-nums ${style.className}`} title={`vs ${change.previous}`}>
      {style.arrow} {Math.abs(change.change).toFixed(1)}
    </span>
  );
}
