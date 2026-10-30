"use client";

import { useState } from "react";
import StatCard from "@/components/StatCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useJsonFetch } from "../chapter-report/useJsonFetch";
import { PerformanceNotice } from "../PerformanceStates";
import { ChangeArrow, LevelChip, STATUS_CLASS, ScoreGraph, StatusChip } from "./chips";
import MentorNotes, { NotesCell } from "./MentorNotes";
import {
  type GenderFilter,
  type SortKey,
  type StreamSection,
  groupRows,
  matchesGender,
  modeDistribution,
  statusCounts,
  streamSections,
} from "./score-journey-view";
import type {
  AlStatus,
  JourneyTest,
  MentorNoteCounts,
  ScoreJourneyData,
  ScoreJourneyRow,
  ScoreTrend,
  ToNextLevel,
} from "@/types/student-support";

interface Props {
  schoolUdise: string;
  grade: number;
  program: string;
  stream?: string;
  testGrade?: number;
  onOpenStudent: (uid: string) => void;
}

const STATUSES: AlStatus[] = ["Sliding", "Same", "Improving"];

const COLUMNS: { key: SortKey | null; label: string; title?: string; className?: string }[] = [
  { key: "name", label: "Student", className: "sticky left-0 z-10 bg-bg-card-alt" },
  { key: null, label: "Gender" },
  { key: null, label: "Stream" },
  { key: null, label: "Category" },
  { key: "predicted", label: "Predicted" },
  { key: null, label: "Mode AL" },
  { key: "status", label: "AL status", title: "Mode AL compared with Predicted AL" },
  { key: "latestAl", label: "Latest AL", title: "Level on the latest full test (retests skipped)" },
  {
    key: "toNext",
    label: "Questions to next AL",
    title: "Extra correct answers (+4 each) needed on the next test to reach the level above the Latest AL",
  },
  { key: null, label: "Mentor notes" },
  { key: "trend", label: "Score graph", title: "Score % in every test, joined test to test; colour = direction over the last 5" },
];

const RETEST_TITLE = "Retest — not counted in status or trend.";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const formatMarks = (v: number) => String(Math.round(v));

function streamLabel(row: ScoreJourneyRow): string {
  if (row.examStream === "engineering") return "Engineering";
  if (row.examStream === "medical") return "Medical";
  return row.stream ?? "—";
}

function ToNextCell({ value }: { value: ToNextLevel }) {
  if (value.kind === "top") {
    return <span className="text-text-muted text-xs" title="Already at the top level on the latest test">Top</span>;
  }
  if (value.kind === "none") return <span className="text-text-muted">—</span>;
  const title =
    `${value.gap} more marks to ${value.nextLevel} (cutoff ${value.cutoff}). ` +
    `Latest test ${value.test} = ${formatMarks(value.marks)} marks. Counted at +4 per extra correct answer.`;
  return (
    <span className="tabular-nums" title={title}>
      <b>{value.questions}</b> <span className="text-text-muted text-xs">→ {value.nextLevel}</span>
    </span>
  );
}

function GraphCell({ trend }: { trend: ScoreTrend | null }) {
  const title = trend
    ? `All ${trend.points.length} tests: ${trend.points.map((v) => `${Math.round(v)}%`).join(" → ")} · ` +
      `last ${trend.recent} tests trend ${trend.slope > 0 ? "+" : ""}${trend.slope.toFixed(1)} points per test`
    : "Fewer than two tests";
  return (
    <span className="inline-block align-middle" title={title}>
      <ScoreGraph trend={trend} />
    </span>
  );
}

function TestCell({ row, test }: { row: ScoreJourneyRow; test: JourneyTest }) {
  const r = row.results[test.sessionId];
  if (!r) return <span className="text-text-muted">AB</span>;
  const level = r.level === "Not Qualified" ? "NQ" : r.level;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="tabular-nums">{r.marks !== null ? formatMarks(r.marks) : "—"}</span>
      <LevelChip level={level} />
      {row.change?.sessionId === test.sessionId && <ChangeArrow change={row.change} />}
    </span>
  );
}

function TestHeader({ test }: { test: JourneyTest }) {
  const title = `${test.retest ? `${RETEST_TITLE} ` : ""}${test.name} · out of ${test.max !== null ? formatMarks(test.max) : "—"}`;
  return (
    <th className={`px-2 py-2 font-semibold normal-case ${test.retest ? "text-accent" : ""}`} title={title}>
      <div className="max-w-[7.5rem] truncate">{test.name}</div>
      <div className="font-normal text-[10.5px]">
        {formatDate(test.date)}
        {test.retest && " · Retest"}
      </div>
    </th>
  );
}

function Row({
  row,
  tests,
  notes,
  onOpen,
  onOpenNotes,
}: {
  row: ScoreJourneyRow;
  tests: JourneyTest[];
  notes: number | undefined;
  onOpen: () => void;
  onOpenNotes: () => void;
}) {
  const latest = row.latestAl;
  return (
    <tr className="border-t border-border hover:bg-bg-card-alt/40">
      <td className="sticky left-0 z-10 bg-bg-card px-3 py-2">
        <button type="button" onClick={onOpen} className="text-left font-semibold text-accent hover:underline">
          {row.name}
        </button>
        {row.studentId && <div className="text-xs text-text-muted tabular-nums">{row.studentId}</div>}
      </td>
      <td className="px-3 py-2">{row.gender ?? "—"}</td>
      <td className="px-3 py-2">{streamLabel(row)}</td>
      <td className="px-3 py-2">{row.category ?? "—"}</td>
      <td className="px-3 py-2"><LevelChip level={row.predicted} /></td>
      <td className="px-3 py-2"><LevelChip level={row.mode} /></td>
      <td className="px-3 py-2"><StatusChip status={row.status} /></td>
      <td
        className="px-3 py-2"
        title={latest ? `${latest.test}${latest.marks !== null ? ` · ${formatMarks(latest.marks)} marks` : ""}` : undefined}
      >
        <LevelChip level={latest?.level ?? null} />
      </td>
      <td className="px-3 py-2"><ToNextCell value={row.toNext} /></td>
      <td className="px-3 py-2"><NotesCell count={notes} onOpen={onOpenNotes} /></td>
      <td className="px-3 py-2"><GraphCell trend={row.trend} /></td>
      {tests.map((t) => (
        <td key={t.sessionId} className="px-2 py-2 text-center"><TestCell row={row} test={t} /></td>
      ))}
    </tr>
  );
}

function SectionTable({
  section,
  sort,
  notes,
  onSort,
  onOpenStudent,
  onOpenNotes,
}: {
  section: StreamSection;
  sort: { key: SortKey; ascending: boolean };
  notes: Record<string, number>;
  onSort: (key: SortKey | null) => void;
  onOpenStudent: (uid: string) => void;
  onOpenNotes: (row: ScoreJourneyRow) => void;
}) {
  // Newest test first, always shown.
  const tests = [...section.tests].reverse();
  const groups = groupRows(section.rows, sort.key, sort.ascending);
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-bold uppercase tracking-wide">
        {section.label} <span className="text-text-muted font-normal normal-case">· {section.rows.length} students</span>
      </h4>
      <div className="overflow-x-auto rounded-lg border border-border bg-bg-card">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-bg-card-alt text-left text-[11.5px] uppercase tracking-wide text-text-muted">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} className={`px-3 py-2 font-semibold ${c.className ?? ""}`} title={c.title}>
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
              {tests.map((t) => (
                <TestHeader key={t.sessionId} test={t} />
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.level ?? "none"}>
              <tr className="bg-bg-card-alt/70">
                <td colSpan={COLUMNS.length + tests.length} className="px-3 py-1.5 text-xs font-semibold">
                  {g.level ? <LevelChip level={g.level} /> : "No Mode AL yet"}{" "}
                  <span className="text-text-muted">
                    {g.rows.length} student{g.rows.length === 1 ? "" : "s"}
                  </span>
                </td>
              </tr>
              {g.rows.map((r) => (
                <Row
                  key={r.uid}
                  row={r}
                  tests={tests}
                  notes={notes[r.uid]}
                  onOpen={() => onOpenStudent(r.uid)}
                  onOpenNotes={() => onOpenNotes(r)}
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

export default function ScoreJourney({ schoolUdise, grade, program, stream, testGrade, onOpenStudent }: Props) {
  const [gender, setGender] = useState<GenderFilter>("all");
  const [status, setStatus] = useState<AlStatus | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "default", ascending: false });
  const [notesFor, setNotesFor] = useState<ScoreJourneyRow | null>(null);

  const qs = new URLSearchParams({ grade: String(grade), program });
  if (stream) qs.set("stream", stream);
  if (testGrade != null) qs.set("testGrade", String(testGrade));
  const state = useJsonFetch<ScoreJourneyData>(
    `/api/quiz-analytics/${schoolUdise}/student-support?${qs}`,
    "Failed to load the score journey"
  );
  // Separate from the journey (and from MCP): counts only for students whose
  // mentorship notes this viewer may read. A failure leaves "—" in the cells
  // and says so above the table, so it doesn't read as "no notes".
  const notesState = useJsonFetch<MentorNoteCounts>(
    `/api/quiz-analytics/${schoolUdise}/student-support/notes?${new URLSearchParams({ grade: String(grade), program })}`,
    "Failed to load mentor notes"
  );
  const noteCounts = notesState.status === "ready" ? notesState.data.counts : {};

  if (state.status === "loading") return <PerformanceNotice>Loading the score journey…</PerformanceNotice>;
  if (state.status === "error") return <PerformanceNotice>{state.message}</PerformanceNotice>;
  if (state.data.students.length === 0) {
    return <PerformanceNotice>No enrolled students for this grade.</PerformanceNotice>;
  }

  const byGender = state.data.students.filter((r) => matchesGender(r, gender));
  const counts = statusCounts(byGender);
  const shown = status ? byGender.filter((r) => r.status === status) : byGender;
  const sections = streamSections(shown, state.data.tests);

  const onSort = (key: SortKey | null) => {
    if (!key) return;
    // Text sorts A→Z first; numbers start high → low.
    setSort((s) => (s.key === key ? { key, ascending: !s.ascending } : { key, ascending: key === "name" }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <StatCard label="Students" value={byGender.length} color="brand-gold" />
        <StatCard label="Major tests" value={state.data.tests.length} color="brand-coral" />
        <StatCard label="Mode AL distribution" value={modeDistribution(byGender) || "—"} size="sm" color="brand-amber" />
      </div>

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
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-bold uppercase tracking-wide text-text-muted">AL status</span>
          {STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={status === st}
              onClick={() => setStatus(status === st ? null : st)}
              className={`rounded border px-2 py-1 text-xs font-semibold ${STATUS_CLASS[st]} ${
                status === st ? "ring-2 ring-current ring-offset-1" : status ? "opacity-50" : ""
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

      {notesState.status === "error" && <p className="text-sm text-text-muted">Mentor notes unavailable</p>}

      {shown.length === 0 && (
        <div className="rounded-lg border border-border bg-bg-card-alt p-8 text-center text-sm text-text-muted shadow-sm">
          No students match these filters ·{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setStatus(null);
              setGender("all");
            }}
          >
            Clear
          </button>
        </div>
      )}

      {sections.map((s) => (
        <SectionTable
          key={s.key}
          section={s}
          sort={sort}
          notes={noteCounts}
          onSort={onSort}
          onOpenStudent={onOpenStudent}
          onOpenNotes={setNotesFor}
        />
      ))}

      {notesFor && (
        <MentorNotes
          schoolUdise={schoolUdise}
          grade={grade}
          program={program}
          uid={notesFor.uid}
          name={notesFor.name}
          onClose={() => setNotesFor(null)}
        />
      )}
    </div>
  );
}
