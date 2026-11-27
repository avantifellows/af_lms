"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Badge, Card } from "@/components/ui";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  JEE_FORM_EXAM,
  jeeRowStatus,
  type JeeFormRow,
  type JeeFormStatusFilter,
  type JeeFormView,
} from "@/lib/blended-learning-jee-form-input";

import { BlendedSelect } from "../BlendedSelect";
import { JeeFormPanel } from "./JeeFormPanel";
import { JeeStatusBadge, JeeStatusDetail, RecordedOn } from "./jeeFormDisplay";

// The JEE Form tab: has each Student filled the JEE Main 2027 form? Counts
// for the Students in view, a status filter, then one row per Student that
// opens in place to the Filled / Not filled form. Saving updates the row and
// the counts without leaving the page. The filters live in the URL (status,
// and an admin's mentor) and so does the open row (`student`), so a view or
// one Student's row can be linked to; the Mentee page links here that way.
// A row saved under a status filter stays listed until the filter changes,
// so it doesn't vanish while the Mentor reads it. A team lead also sees their
// reportees' Students, marked View only: the status alone (the server sends
// nothing more), never opening to the form, the application number or the
// password.

const STATUS_FILTERS: { value: JeeFormStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "not_recorded", label: "Not recorded" },
  { value: "filled", label: "Filled" },
  { value: "not_filled", label: "Not filled" },
];

function parseStatus(value: string | null): JeeFormStatusFilter {
  return STATUS_FILTERS.find((option) => option.value === value)?.value ?? "all";
}

function parseId(value: string | null): number | null {
  return value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

function rowElementId(studentId: number): string {
  return `jee-student-${studentId}`;
}

// The URL with `changes` applied (null removes a param), written to the
// browser's history; Next.js keeps useSearchParams in step with it.
function writeParams(pathname: string, changes: Record<string, string | null>, mode: "push" | "replace") {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  const url = query ? `${pathname}?${query}` : pathname;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

// The Mentor filter's options, A–Z; a team lead's own Students first, as "My
// students" (as on the Flags tab).
function mentorOptions(rows: JeeFormRow[], ownMentorUserId: number | null): { mentorUserId: number; name: string }[] {
  const mentors = new Map<number, string>();
  for (const row of rows) if (row.mentorUserId !== ownMentorUserId) mentors.set(row.mentorUserId, row.mentorName);
  const others = [...mentors]
    .map(([mentorUserId, name]) => ({ mentorUserId, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return ownMentorUserId === null ? others : [{ mentorUserId: ownMentorUserId, name: "My students" }, ...others];
}

type Counts = Record<Exclude<JeeFormStatusFilter, "all">, number>;

function countRows(rows: JeeFormRow[]): Counts {
  const counts: Counts = { filled: 0, not_filled: 0, not_recorded: 0 };
  for (const row of rows) counts[jeeRowStatus(row.form)] += 1;
  return counts;
}

const COUNT_TILES: { key: keyof Counts; label: string; tone: string }[] = [
  { key: "filled", label: "Filled", tone: "text-success" },
  { key: "not_filled", label: "Not filled", tone: "text-warning-text" },
  { key: "not_recorded", label: "Not recorded", tone: "text-text-primary" },
];

function CountTiles({ counts }: { counts: Counts }) {
  return (
    <dl aria-label="JEE form counts" className="grid grid-cols-3 gap-2 sm:gap-3">
      {COUNT_TILES.map(({ key, label, tone }) => (
        <div key={key} className="rounded-lg border border-border bg-bg-card px-3 py-2 shadow-sm sm:px-4 sm:py-3">
          <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">{label}</dt>
          <dd className={`font-mono text-2xl font-bold ${tone}`}>{counts[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

function MentorFilter({
  mentors,
  value,
  onChange,
}: {
  mentors: { mentorUserId: number; name: string }[];
  value: number | null;
  onChange: (mentorUserId: string) => void;
}) {
  return (
    <label className="block space-y-1 text-sm font-bold text-text-secondary sm:max-w-xs">
      <span>Mentor</span>
      <BlendedSelect
        name="mentor"
        value={value?.toString() ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="bg-bg-input text-text-primary"
      >
        <option value="">All Mentors</option>
        {mentors.map((mentor) => (
          <option key={mentor.mentorUserId} value={mentor.mentorUserId}>
            {mentor.name}
          </option>
        ))}
      </BlendedSelect>
    </label>
  );
}

function RowSummary({ row, showMentor }: { row: JeeFormRow; showMentor: boolean }) {
  const { current } = row.form;
  return (
    <span className="grid min-w-0 flex-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,16rem)_7rem_minmax(0,1fr)] sm:items-center">
      <span className="min-w-0">
        <span className="block break-words font-bold text-text-primary">{row.name}</span>
        <span className="block text-xs text-text-secondary">
          ID <span className="font-mono">{row.programStudentId ?? "—"}</span>
          {showMentor && <> · {row.mentorName}</>}
        </span>
        {row.viewOnly && <Badge className="mt-1">View only</Badge>}
      </span>
      <span>
        <JeeStatusBadge current={current} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 text-sm">
        <JeeStatusDetail current={current} sessionsApplied={row.viewOnly ? [] : row.form.sessionsApplied} />
        <RecordedOn current={current} />
      </span>
    </span>
  );
}

// A supervised Mentor's Mentee: the status only, nothing to open.
function ViewOnlyRow({ row, showMentor }: { row: JeeFormRow; showMentor: boolean }) {
  return (
    <li id={rowElementId(row.studentId)} className="scroll-mt-4 rounded-lg border border-border bg-bg-card shadow-sm">
      <div className="flex min-h-11 w-full items-start gap-3 p-3 sm:p-4">
        <RowSummary row={row} showMentor={showMentor} />
      </div>
    </li>
  );
}

function StudentRow({
  row,
  open,
  canRecord,
  canReveal,
  showMentor,
  onToggle,
  onSaved,
}: {
  row: Extract<JeeFormRow, { viewOnly: false }>;
  open: boolean;
  canRecord: boolean;
  canReveal: boolean;
  showMentor: boolean;
  onToggle: () => void;
  onSaved: (form: JeeFormView) => void;
}) {
  const panelId = `${rowElementId(row.studentId)}-panel`;
  return (
    <li
      id={rowElementId(row.studentId)}
      className={`scroll-mt-4 rounded-lg border bg-bg-card shadow-sm ${open ? "border-accent" : "border-border"}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-11 w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:p-4"
      >
        <RowSummary row={row} showMentor={showMentor} />
        <ChevronDown
          aria-hidden="true"
          className={`mt-0.5 h-5 w-5 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={panelId} className="border-t border-border p-3 sm:p-4">
          <JeeFormPanel
            studentId={row.studentId}
            form={row.form}
            canRecord={canRecord}
            canReveal={canReveal}
            onSaved={onSaved}
            onClose={onToggle}
          />
        </div>
      )}
    </li>
  );
}

function EmptyList({ total }: { total: number }) {
  return (
    <Card elevation="sm" className="p-4 sm:p-6">
      <p className="text-sm text-text-secondary">
        {total === 0 ? "No students are in this list." : "No students match this filter."}
      </p>
    </Card>
  );
}

// Scroll a linked Student's row into view once, on arrival.
function useScrollToLinkedRow(studentId: number | null) {
  const arrived = useRef(studentId);
  useEffect(() => {
    if (arrived.current === null) return;
    document.getElementById(rowElementId(arrived.current))?.scrollIntoView({ block: "start" });
  }, []);
}

export function JeeFormTab({
  rows: initialRows,
  canRecord,
  canReveal,
  showMentor,
  ownMentorUserId = null,
}: {
  rows: JeeFormRow[];
  canRecord: boolean;
  // Show password: anyone not read-only (reveal_exam_password).
  canReveal: boolean;
  // Admins (every Mentor's Students) and team leads (theirs and their
  // reportees'): a Mentor filter and name per row.
  showMentor: boolean;
  // A team lead's own `user` id: their Students are "My students".
  ownMentorUserId?: number | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState(initialRows);
  // Rows saved under the current filters, kept in view until they change.
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set());
  const status = parseStatus(searchParams.get("status"));
  const mentorUserId = showMentor ? parseId(searchParams.get("mentor")) : null;
  const openStudent = parseId(searchParams.get("student"));
  useScrollToLinkedRow(openStudent);

  const inView = mentorUserId === null ? rows : rows.filter((row) => row.mentorUserId === mentorUserId);
  const listed =
    status === "all" ? inView : inView.filter((row) => jeeRowStatus(row.form) === status || kept.has(row.studentId));

  function filter(changes: Record<string, string | null>) {
    setKept(new Set());
    writeParams(pathname, changes, "push");
  }

  function saved(studentId: number, form: JeeFormView) {
    setRows((current) =>
      current.map((row) => (row.studentId === studentId && !row.viewOnly ? { ...row, form } : row))
    );
    setKept((current) => new Set(current).add(studentId));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-bold text-text-primary sm:text-xl">{JEE_FORM_EXAM.label} form</h2>
        <p className="text-sm text-text-secondary">
          <span className="font-mono font-bold text-text-primary">{inView.length}</span>{" "}
          {inView.length === 1 ? "student" : "students"}
        </p>
      </div>
      <CountTiles counts={countRows(inView)} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SegmentedControl
          label="Status"
          options={STATUS_FILTERS}
          value={status}
          onChange={(value) => filter({ status: value === "all" ? null : value })}
        />
        {showMentor && (
          <MentorFilter
            mentors={mentorOptions(rows, ownMentorUserId)}
            value={mentorUserId}
            onChange={(value) => filter({ mentor: value || null })}
          />
        )}
      </div>
      {listed.length === 0 ? (
        <EmptyList total={inView.length} />
      ) : (
        <ul aria-label="Students" className="space-y-2">
          {listed.map((row) =>
            row.viewOnly ? (
              <ViewOnlyRow key={row.studentId} row={row} showMentor={showMentor} />
            ) : (
              <StudentRow
                key={row.studentId}
                row={row}
                open={row.studentId === openStudent}
                canRecord={canRecord}
                canReveal={canReveal}
                showMentor={showMentor}
                onToggle={() =>
                  writeParams(pathname, { student: row.studentId === openStudent ? null : String(row.studentId) }, "replace")
                }
                onSaved={(form) => saved(row.studentId, form)}
              />
            )
          )}
        </ul>
      )}
    </div>
  );
}
