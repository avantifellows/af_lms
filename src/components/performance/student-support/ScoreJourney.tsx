"use client";

import { useState } from "react";
import StatCard from "@/components/StatCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useJsonFetch } from "../chapter-report/useJsonFetch";
import { PerformanceNotice } from "../PerformanceStates";
import { LevelChip, STATUS_CLASS, StatusChip } from "./chips";
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
  { key: null, label: "Mentor notes" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

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

function TestCell({ row, test }: { row: ScoreJourneyRow; test: JourneyTest }) {
  const r = row.results[test.sessionId];
  if (!r) return <span className="text-text-muted">—</span>;
  const marks = r.marks !== null && r.max ? `${r.marks}/${r.max}` : null;
  const level = r.level === "Not Qualified" ? "NQ" : r.level;
  return (
    <span title={`${test.name} (${formatDate(test.date)}): ${r.level}${marks ? ` · ${marks}` : ""}`}>
      <LevelChip level={level} />
    </span>
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
      <td className="px-3 py-2"><LevelChip level={row.predicted} /></td>
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
      <td className="px-3 py-2"><NotesCell count={notes} onOpen={onOpenNotes} /></td>
      {tests.map((t) => (
        <td key={t.sessionId} className="px-2 py-2 text-center"><TestCell row={row} test={t} /></td>
      ))}
    </tr>
  );
}

function SectionTable({
  section,
  allTests,
  sort,
  notes,
  onSort,
  onOpenStudent,
  onOpenNotes,
}: {
  section: StreamSection;
  allTests: boolean;
  sort: { key: SortKey; ascending: boolean };
  notes: Record<string, number>;
  onSort: (key: SortKey | null) => void;
  onOpenStudent: (uid: string) => void;
  onOpenNotes: (row: ScoreJourneyRow) => void;
}) {
  const tests = allTests ? section.tests : [];
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
              {tests.map((t) => (
                <th key={t.sessionId} className="px-2 py-2 font-semibold normal-case" title={t.name}>
                  <div className="max-w-[7.5rem] truncate">{t.name}</div>
                  <div className="font-normal text-[10.5px]">{formatDate(t.date)}</div>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.level ?? "none"}>
              <tr className="bg-bg-card-alt/70">
                <td colSpan={COLUMNS.length + tests.length} className="px-3 py-1.5 text-xs font-semibold">
                  {g.level ? <LevelChip level={g.level} /> : "No Mode AL yet"}{" "}
                  <span className="text-text-muted">{g.rows.length} students</span>
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
  const [allTests, setAllTests] = useState(false);
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allTests} onChange={(e) => setAllTests(e.target.checked)} />
          All tests
        </label>
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
          allTests={allTests}
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
