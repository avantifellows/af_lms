"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useJsonFetch } from "../chapter-report/useJsonFetch";
import { PerformanceNotice } from "../PerformanceStates";
import { LevelChip, StatusChip } from "./chips";
import {
  type GenderFilter,
  type SortKey,
  groupRows,
  matchesGender,
  statusCounts,
} from "./score-journey-view";
import type { AlStatus, ScoreJourneyData, ScoreJourneyRow, ToNextLevel } from "@/types/student-support";

interface Props {
  schoolUdise: string;
  grade: number;
  program: string;
  stream?: string;
  onOpenStudent: (uid: string) => void;
}

const STATUSES: AlStatus[] = ["Sliding", "Same", "Improving"];

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: "name", label: "Student", className: "sticky left-0 z-10 bg-bg-card-alt" },
  { key: null, label: "Gender" },
  { key: null, label: "Category" },
  { key: "predicted", label: "Predicted" },
  { key: null, label: "Mode AL" },
  { key: null, label: "Last 3 tests" },
  { key: "latest", label: "Latest score" },
  { key: "toNext", label: "Questions to next mode AL" },
  { key: "status", label: "AL status" },
];

function ToNextCell({ value }: { value: ToNextLevel }) {
  if (value.kind === "top") return <span className="text-text-muted">Top</span>;
  if (value.kind === "reached") return <span className="text-success font-semibold">Reached</span>;
  if (value.kind === "none") return <span className="text-text-muted">—</span>;
  const title = `Median ${value.median} marks of ${value.tests.join(", ")}; ${value.nextLevel} cutoff ${value.cutoff}`;
  return (
    <span className="tabular-nums" title={title}>
      {value.questions} <span className="text-text-muted text-xs">to {value.nextLevel}</span>
    </span>
  );
}

function Row({ row, onOpen }: { row: ScoreJourneyRow; onOpen: () => void }) {
  return (
    <tr className="border-t border-border hover:bg-bg-card-alt/40">
      <td className="sticky left-0 z-10 bg-bg-card px-3 py-2">
        <button type="button" onClick={onOpen} className="text-left font-semibold text-accent hover:underline">
          {row.name}
        </button>
        {row.studentId && <div className="text-xs text-text-muted tabular-nums">{row.studentId}</div>}
      </td>
      <td className="px-3 py-2">{row.gender ?? "—"}</td>
      <td className="px-3 py-2">{row.category ?? "—"}</td>
      <td className="px-3 py-2">
        <LevelChip level={row.predicted} />
        {row.predictedPct !== null && (
          <span className="ml-1 text-xs text-text-muted tabular-nums">{row.predictedPct}%ile</span>
        )}
      </td>
      <td className="px-3 py-2"><LevelChip level={row.mode} /></td>
      <td className="px-3 py-2">
        {row.last3.length ? (
          <span className="inline-flex gap-1">
            {row.last3.map((l, i) => <LevelChip key={i} level={l} />)}
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums">{row.latestPct !== null ? `${row.latestPct}%` : "—"}</td>
      <td className="px-3 py-2"><ToNextCell value={row.toNext} /></td>
      <td className="px-3 py-2"><StatusChip status={row.status} /></td>
    </tr>
  );
}

export default function ScoreJourney({ schoolUdise, grade, program, stream, onOpenStudent }: Props) {
  const [gender, setGender] = useState<GenderFilter>("all");
  const [status, setStatus] = useState<AlStatus | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "default", ascending: false });

  const qs = new URLSearchParams({ grade: String(grade), program });
  if (stream) qs.set("stream", stream);
  const state = useJsonFetch<ScoreJourneyData>(
    `/api/quiz-analytics/${schoolUdise}/student-support?${qs}`,
    "Failed to load the score journey"
  );

  if (state.status === "loading") return <PerformanceNotice>Loading the score journey…</PerformanceNotice>;
  if (state.status === "error") return <PerformanceNotice>{state.message}</PerformanceNotice>;

  const byGender = state.data.students.filter((r) => matchesGender(r, gender));
  const counts = statusCounts(byGender);
  const shown = status ? byGender.filter((r) => r.status === status) : byGender;
  const groups = groupRows(shown, sort.key, sort.ascending);

  const onSort = (key: SortKey | null) => {
    if (!key) return;
    // Text sorts A→Z first; numbers start high → low.
    setSort((s) => (s.key === key ? { key, ascending: !s.ascending } : { key, ascending: key === "name" }));
  };

  if (state.data.students.length === 0) {
    return <PerformanceNotice>No enrolled students for this grade.</PerformanceNotice>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <SegmentedControl<GenderFilter>
          label="Students"
          options={[
            { value: "all", label: "All" },
            { value: "female", label: "Girls" },
            { value: "male", label: "Boys" },
          ]}
          value={gender}
          onChange={setGender}
        />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs font-bold uppercase tracking-wide text-text-muted">AL status</span>
          {STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={status === st}
              onClick={() => setStatus(status === st ? null : st)}
              className={`rounded border px-2 py-1 text-xs font-semibold ${
                status === st ? "bg-accent text-white border-accent" : "bg-bg-card-alt text-text-muted border-border"
              }`}
            >
              {st} <span className="tabular-nums">{counts[st]}</span>
            </button>
          ))}
          {status && (
            <span className="text-xs text-text-muted">
              Showing {shown.length} of {byGender.length} ·{" "}
              <button type="button" className="underline" onClick={() => setStatus(null)}>
                Clear filter
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-bg-card">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-bg-card-alt text-left text-[11.5px] uppercase tracking-wide text-text-muted">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} className={`px-3 py-2 font-semibold ${c.className ?? ""}`}>
                  {c.key ? (
                    <button type="button" onClick={() => onSort(c.key)} className="uppercase hover:text-text-primary">
                      {c.label}
                      {sort.key === c.key ? (sort.ascending ? " ▲" : " ▼") : ""}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.level ?? "none"}>
              <tr className="bg-bg-card-alt/70">
                <td colSpan={COLUMNS.length} className="px-3 py-1.5 text-xs font-semibold">
                  {g.level ? <LevelChip level={g.level} /> : "No Mode AL yet"}{" "}
                  <span className="text-text-muted">{g.rows.length} students</span>
                </td>
              </tr>
              {g.rows.map((r) => (
                <Row key={r.uid} row={r} onOpen={() => onOpenStudent(r.uid)} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
