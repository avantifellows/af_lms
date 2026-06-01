"use client";

import { Fragment, useState } from "react";
import { CircleAlert, ClockAlert, ListChecks } from "lucide-react";

import type {
  CurriculumSummaryChapterRow,
  CurriculumSummaryRow,
} from "@/lib/curriculum-summary";

interface CurriculumSummaryTableRowsProps {
  rows: CurriculumSummaryRow[];
  chapterRowsByParentKey: Record<string, CurriculumSummaryChapterRow[]>;
}

export default function CurriculumSummaryTableRows({
  rows,
  chapterRowsByParentKey,
}: CurriculumSummaryTableRowsProps) {
  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(
    () => new Set()
  );

  function toggleRow(rowKey: string) {
    setExpandedRowKeys((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }

  return (
    <tbody className="divide-y divide-border bg-bg-card">
      {rows.map((row) => {
        const chapterRows = chapterRowsByParentKey[row.rowKey] ?? [];
        const isExpanded = expandedRowKeys.has(row.rowKey);
        const expansionId = `curriculum-summary-chapters-${row.rowKey.replaceAll(
          ":",
          "-"
        )}`;
        const toggleLabel = `${isExpanded ? "Hide" : "Show"} chapters for ${
          row.schoolName
        } ${row.schoolCode} ${row.programName} Grade ${row.grade} ${
          row.subjectName
        } ${formatExamTrack(row.examTrack)}`;

        return (
          <Fragment key={row.rowKey}>
            <tr className={isExpanded ? "bg-warning-bg" : ""}>
              <td className="whitespace-nowrap px-4 py-3 font-medium text-text-primary">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={toggleLabel}
                    aria-expanded={isExpanded}
                    aria-controls={expansionId}
                    onClick={() => toggleRow(row.rowKey)}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-sm font-bold text-accent hover:bg-hover-bg hover:text-accent-hover"
                  >
                    {isExpanded ? "-" : "+"}
                  </button>
                  <span>
                    <span>{row.schoolName}</span>{" "}
                    <span className="text-text-muted">{row.schoolCode}</span>
                  </span>
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {row.programName}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {row.grade}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {row.subjectName}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {formatExamTrack(row.examTrack)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {formatCoverage(row.completedChapters, row.totalConfiguredChapters)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {formatCoverage(row.prescribedChapters, row.totalConfiguredChapters)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {formatDelta(row.deltaPercent)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                <LectureVsPrescribed
                  actualMinutes={row.actualMinutes}
                  prescribedMinutes={row.prescribedMinutes}
                />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                <FlagReasons flagged={row.flagged} reasons={row.flagReasons} />
              </td>
            </tr>
            {isExpanded ? (
              <tr id={expansionId}>
                <td colSpan={10} className="bg-warning-bg px-4 py-4">
                  <div className="ml-8 border-l-4 border-accent bg-bg-card px-4 py-4 shadow-sm">
                    <ChapterExpansionTable
                      rowContext={`${row.schoolName} ${row.schoolCode} / ${
                        row.programName
                      } / Grade ${row.grade} ${row.subjectName} / ${formatExamTrack(
                        row.examTrack
                      )}`}
                      chapterRows={chapterRows}
                    />
                  </div>
                </td>
              </tr>
            ) : null}
          </Fragment>
        );
      })}
    </tbody>
  );
}

function ChapterExpansionTable({
  rowContext,
  chapterRows,
}: {
  rowContext: string;
  chapterRows: CurriculumSummaryChapterRow[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Chapter expansion</h3>
          <p className="mt-0.5 text-xs font-medium text-accent">{rowContext}</p>
        </div>
        <p className="max-w-3xl text-xs text-text-muted">
          Chapter Actual Hours use allocated rounded minutes from covered topics and
          may not sum exactly to top-level Actual Hours, which use raw log duration.
        </p>
      </div>
      {chapterRows.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No in-syllabus chapter rows are configured for this row.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-xs">
            <thead className="bg-bg-card">
              <tr>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-text-muted">
                  Chapter
                </th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-text-muted">
                  Code
                </th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-text-muted">
                  Completed
                </th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-text-muted">
                  Prescribed
                </th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-text-muted">
                  Delta %
                </th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-text-muted">
                  Lecture vs prescribed
                </th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-text-muted">
                  Flagged
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-bg-card">
              {chapterRows.map((chapter) => (
                <tr key={`${chapter.parentRowKey}:${chapter.chapterId}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-text-primary">
                    {chapter.chapterName}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-primary">
                    {chapter.chapterCode}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-primary">
                    {formatChapterCoverage(chapter.completedCount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-primary">
                    {formatChapterCoverage(chapter.prescribedCount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-primary">
                    {formatDelta(chapter.deltaPercent)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-primary">
                    <LectureVsPrescribed
                      actualMinutes={chapter.actualMinutes}
                      prescribedMinutes={chapter.prescribedMinutes}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-primary">
                    <FlagReasons flagged={chapter.flagged} reasons={chapter.flagReasons} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LectureVsPrescribed({
  actualMinutes,
  prescribedMinutes,
}: {
  actualMinutes: number;
  prescribedMinutes: number;
}) {
  return (
    <div className="inline-grid grid-cols-[7rem_1.5rem] items-center gap-2">
      <span className="text-right">
        {formatHours(actualMinutes)} / {formatHours(prescribedMinutes)}
      </span>
      <LectureProgressIndicator
        actualMinutes={actualMinutes}
        prescribedMinutes={prescribedMinutes}
      />
    </div>
  );
}

function LectureProgressIndicator({
  actualMinutes,
  prescribedMinutes,
}: {
  actualMinutes: number;
  prescribedMinutes: number;
}) {
  if (prescribedMinutes <= 0) {
    return (
      <span
        role="img"
        tabIndex={0}
        aria-label="—"
        className="group relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-bg-muted text-[10px] font-bold text-text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="sr-only">No percentage</span>
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-bg-card px-2 py-1 text-xs font-bold normal-case text-text-primary shadow-lg group-hover:block group-focus-visible:block"
        >
          —
        </span>
      </span>
    );
  }

  const percent = (actualMinutes / prescribedMinutes) * 100;
  const visualPercent = Math.max(0, Math.min(percent, 100));
  const colorClass =
    percent < 90
      ? "text-danger"
      : percent > 110
        ? "text-warning-text"
        : "text-success";
  const strokeColor =
    percent < 90 ? "#ad2f2f" : percent > 110 ? "#8c5a1d" : "#1e6b4b";
  const tooltip = formatPercent(percent);

  return (
    <span
      role="meter"
      tabIndex={0}
      aria-label={tooltip}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(visualPercent)}
      aria-valuetext={formatPercent(percent)}
      className={`group relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${colorClass}`}
      style={{
        background: `conic-gradient(${strokeColor} ${visualPercent * 3.6}deg, rgba(104, 88, 81, 0.18) 0deg)`,
      }}
    >
      <span className="h-3.5 w-3.5 rounded-full bg-bg-card shadow-inner" />
      {percent > 100 ? (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-bg-card bg-current" />
      ) : null}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-bg-card px-2 py-1 text-xs font-bold normal-case text-text-primary shadow-lg group-hover:block group-focus-visible:block"
      >
        {tooltip}
      </span>
    </span>
  );
}

function FlagReasons({
  flagged,
  reasons,
}: {
  flagged: boolean;
  reasons: string[];
}) {
  const flagGroups = getFlagGroups(reasons);

  return (
    <div className="flex min-w-16 items-center gap-1.5">
      {!flagged || flagGroups.length === 0 ? (
        <span className="text-sm text-text-muted" aria-label="No flags">
          —
        </span>
      ) : (
        flagGroups.map((group) => (
          <span
            key={group.type}
            role="img"
            aria-label={`${group.label}: ${group.reasons.join(", ")}`}
            tabIndex={0}
            className={`group relative inline-flex h-7 w-7 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${group.className}`}
          >
            <group.Icon className="h-4 w-4" aria-hidden="true" />
            {group.reasons.length > 1 ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bg-card px-1 text-[10px] font-bold leading-none text-text-primary shadow-sm">
                {group.reasons.length}
              </span>
            ) : null}
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-64 -translate-x-1/2 rounded-md border border-border bg-bg-card px-3 py-2 text-left text-xs font-medium normal-case text-text-primary shadow-lg group-hover:block group-focus-visible:block"
            >
              <span className="block font-bold">{group.label}</span>
              {group.reasons.map((reason) => (
                <span key={reason} className="mt-1 block text-text-secondary">
                  {reason}
                </span>
              ))}
            </span>
          </span>
        ))
      )}
    </div>
  );
}

type FlagGroupType = "time" | "coverage" | "other";

function getFlagGroups(reasons: string[]) {
  const groupedReasons: Record<FlagGroupType, string[]> = {
    time: [],
    coverage: [],
    other: [],
  };

  for (const reason of reasons) {
    groupedReasons[getFlagGroupType(reason)].push(formatFlagReason(reason));
  }

  return [
    {
      type: "time" as const,
      label: "Time flag",
      Icon: ClockAlert,
      className: "border-warning-border bg-warning-bg text-warning-text",
      reasons: groupedReasons.time,
    },
    {
      type: "coverage" as const,
      label: "Coverage flag",
      Icon: ListChecks,
      className: "border-danger/40 bg-danger-bg text-danger",
      reasons: groupedReasons.coverage,
    },
    {
      type: "other" as const,
      label: "Flag",
      Icon: CircleAlert,
      className: "border-border bg-bg-muted text-text-muted",
      reasons: groupedReasons.other,
    },
  ].filter((group) => group.reasons.length > 0);
}

function getFlagGroupType(reason: string): FlagGroupType {
  switch (reason) {
    case "under_prescribed_hours":
    case "over_prescribed_hours":
    case "actual_time_on_zero_prescribed_minutes":
      return "time";
    case "completion_below_prescribed_coverage":
    case "incomplete_prescribed_chapter":
      return "coverage";
    default:
      return "other";
  }
}

function formatExamTrack(track: string): string {
  if (track === "jee_main") return "JEE Main";
  if (track === "jee_advanced") return "JEE Advanced";
  if (track === "neet") return "NEET";
  return track;
}

function formatCoverage(count: number, total: number): string {
  const pct = total > 0 ? ` (${formatPercent((count / total) * 100)})` : "";
  return `${count}/${total}${pct}`;
}

function formatChapterCoverage(count: number): string {
  return `${count}/1`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatDelta(value: number | null): string {
  return formatPercent(value);
}

function formatHours(minutes: number): string {
  if (minutes <= 0) {
    return "0h";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function formatFlagReason(reason: string): string {
  switch (reason) {
    case "under_prescribed_hours":
      return "Under prescribed hours";
    case "over_prescribed_hours":
      return "Over prescribed hours";
    case "completion_below_prescribed_coverage":
      return "Completion below prescribed coverage";
    case "actual_time_on_zero_prescribed_minutes":
      return "Actual time on zero prescribed minutes";
    case "incomplete_prescribed_chapter":
      return "Incomplete prescribed chapter";
    default:
      return reason;
  }
}
