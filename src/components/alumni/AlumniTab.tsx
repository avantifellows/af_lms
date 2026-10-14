"use client";

// The Alumni tab on the school page: pass-outs still to add (any year) and the
// school's existing alumni. Talks only to /api/alumni/*.
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, MousePointerClick, Pencil, Search, UserPlus } from "lucide-react";
import { Badge, Card, Input, Select } from "@/components/ui";
import AlumniForm from "./AlumniForm";
import Initials from "./Initials";

interface PendingStudent {
  userId: string;
  afid: string;
  name: string;
  /** Academic year they passed out. */
  cohortYear: string;
  program: string;
  gender: string;
  stream: string;
}

interface AlumniListItem {
  userId: string;
  afid: string;
  name: string;
  cohortYear: string;
  ugStatus: string;
  currentStatus: string;
  collegeUg: string;
}

type View = "pending" | "alumni";

interface SelectedStudent {
  kind: "new" | "edit";
  userId: string;
  afid: string;
  name: string;
}

interface Props {
  schoolCode: string;
  initialStudentId?: string;
}

interface Lists {
  pending: PendingStudent[];
  alumni: AlumniListItem[];
}

/**
 * Loads both lists; `refresh` reloads them after a save. A missing list counts
 * as empty. `onFirstLoad` runs once, with the first lists loaded.
 */
function useSchoolLists(schoolCode: string, refresh: number, onFirstLoad: (lists: Lists) => void) {
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState("");
  const firstLoad = useRef(onFirstLoad);
  const loadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/alumni/school/${encodeURIComponent(schoolCode)}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.error || "Couldn't load students.");
        const loaded = {
          pending: Array.isArray(body?.pending) ? body.pending : [],
          alumni: Array.isArray(body?.alumni) ? body.alumni : [],
        };
        setLists(loaded);
        if (!loadedOnce.current) {
          loadedOnce.current = true;
          firstLoad.current(loaded);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load students.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolCode, refresh]);

  return { lists, error };
}

/** Open the student picked from search, else start on whichever list has work in it. */
function initialSelection(lists: Lists, initialStudentId?: string): { view: View; selected: SelectedStudent | null } {
  const fromPending = initialStudentId ? lists.pending.find((s) => s.userId === initialStudentId) : undefined;
  if (fromPending) return { view: "pending", selected: { kind: "new", ...pick(fromPending) } };
  const fromAlumni = initialStudentId ? lists.alumni.find((s) => s.userId === initialStudentId) : undefined;
  if (fromAlumni) return { view: "alumni", selected: { kind: "edit", ...pick(fromAlumni) } };
  return { view: lists.pending.length > 0 ? "pending" : "alumni", selected: null };
}

const pick = (s: { userId: string; afid: string; name: string }) => ({ userId: s.userId, afid: s.afid, name: s.name });

/** Rows matching the year filter and the name / AFID text filter. */
function filterRows<T extends { name: string; afid: string; cohortYear: string }>(rows: T[], year: string, query: string): T[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!year || r.cohortYear === year) &&
      (!needle || r.name.toLowerCase().includes(needle) || r.afid.toLowerCase().includes(needle)),
  );
}

export default function AlumniTab({ schoolCode, initialStudentId }: Props) {
  /** Bumped after a save to reload the lists (a new alumnus moves to "Existing alumni"). */
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<View>("pending");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [selected, setSelected] = useState<SelectedStudent | null>(null);
  /** Students saved in this session (shown with a "Saved" badge). */
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  // Choose the starting list once; a refresh after saving keeps the current view and selection.
  const { lists, error } = useSchoolLists(schoolCode, refresh, (loaded) => {
    const start = initialSelection(loaded, initialStudentId);
    setView(start.view);
    setSelected(start.selected);
  });

  const rows = view === "pending" ? lists?.pending : lists?.alumni;
  const years = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.cohortYear).filter(Boolean))].sort().reverse(),
    [rows],
  );

  if (error) return <p className="py-10 text-center text-sm text-danger">{error}</p>;
  if (!lists) return <LoadingSkeleton />;

  const switchView = (next: View) => {
    setView(next);
    setYear("");
  };
  const onSaved = (id: string) => {
    setSavedIds((prev) => new Set(prev).add(id));
    setRefresh((n) => n + 1);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <Card elevation="sm" className="flex max-h-[78vh] flex-col overflow-hidden rounded-xl lg:sticky lg:top-20">
        <div className="grid grid-cols-2 border-b border-border text-sm" role="tablist" aria-label="Student lists">
          <ViewButton active={view === "pending"} onClick={() => switchView("pending")}>
            To add · {lists.pending.length}
          </ViewButton>
          <ViewButton active={view === "alumni"} onClick={() => switchView("alumni")}>
            Existing alumni · {lists.alumni.length}
          </ViewButton>
        </div>

        <ListFilters view={view} query={query} onQuery={setQuery} year={year} years={years} onYear={setYear} />

        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {view === "pending" ? (
            <PendingRows
              all={lists.pending}
              rows={filterRows(lists.pending, year, query)}
              selectedId={selected?.userId}
              savedIds={savedIds}
              onPick={(s) => setSelected({ kind: "new", ...pick(s) })}
            />
          ) : (
            <AlumniRows
              all={lists.alumni}
              rows={filterRows(lists.alumni, year, query)}
              selectedId={selected?.userId}
              savedIds={savedIds}
              onPick={(a) => setSelected({ kind: "edit", ...pick(a) })}
            />
          )}
        </ul>
      </Card>

      <Card elevation="sm" className="min-h-[300px] rounded-xl p-6">
        {selected ? (
          <AlumniForm key={selected.userId} userId={selected.userId} onSaved={onSaved} />
        ) : (
          <PickPrompt view={view} />
        )}
      </Card>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]" aria-busy="true" aria-label="Loading students">
      <Card elevation="sm" className="space-y-3 rounded-xl p-4">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-9 w-9 animate-pulse rounded-full bg-bg-card-alt" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-2/3 animate-pulse rounded-lg bg-bg-card-alt" />
              <div className="h-2.5 w-1/2 animate-pulse rounded-lg bg-bg-card-alt" />
            </div>
          </div>
        ))}
      </Card>
      <Card elevation="sm" className="rounded-xl p-6">
        <div className="h-6 w-1/3 animate-pulse rounded-lg bg-bg-card-alt" />
        <div className="mt-4 h-40 w-full animate-pulse rounded-lg bg-bg-card-alt" />
      </Card>
    </div>
  );
}

function ListFilters({
  view, query, onQuery, year, years, onYear,
}: { view: View; query: string; onQuery: (q: string) => void; year: string; years: string[]; onYear: (y: string) => void }) {
  return (
    <div className="space-y-2 border-b border-border p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <Input className="pl-9" placeholder="Filter by name or AFID" value={query} onChange={(e) => onQuery(e.target.value)} />
      </div>
      {years.length > 1 && (
        <Select value={year} onChange={(e) => onYear(e.target.value)} aria-label="Pass-out year">
          <option value="">{view === "pending" ? "All pass-out years" : "All cohort years"}</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>
      )}
      <p className="text-xs text-text-muted">
        {view === "pending"
          ? "Passed out (any year), not in alumni records yet."
          : "Already in alumni records — open one to update it."}
      </p>
    </div>
  );
}

interface RowsProps<T> {
  all: T[];
  rows: T[];
  selectedId?: string;
  savedIds: Set<string>;
  onPick: (row: T) => void;
}

function PendingRows({ all, rows, selectedId, savedIds, onPick }: RowsProps<PendingStudent>) {
  if (rows.length === 0) {
    return (
      <EmptyRow>
        {all.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Everyone who passed out is added.
          </span>
        ) : (
          "No students match."
        )}
      </EmptyRow>
    );
  }
  return rows.map((s) => (
    <StudentRow
      key={s.userId}
      active={selectedId === s.userId}
      onClick={() => onPick(s)}
      name={s.name}
      meta={[`AFID ${s.afid}`, s.cohortYear && `Passed out ${s.cohortYear}`, s.program].filter(Boolean).join(" · ")}
      saved={savedIds.has(s.userId)}
      action={<UserPlus className="h-4 w-4 text-accent" aria-label="Add" />}
    />
  ));
}

function AlumniRows({ all, rows, selectedId, savedIds, onPick }: RowsProps<AlumniListItem>) {
  if (rows.length === 0) {
    return <EmptyRow>{all.length === 0 ? "No alumni recorded for this school." : "No alumni match."}</EmptyRow>;
  }
  return rows.map((a) => (
    <StudentRow
      key={a.userId}
      active={selectedId === a.userId}
      onClick={() => onPick(a)}
      name={a.name}
      meta={[a.cohortYear && `Cohort ${a.cohortYear}`, a.ugStatus, a.collegeUg].filter(Boolean).join(" · ")}
      saved={savedIds.has(a.userId)}
      action={<Pencil className="h-4 w-4 text-text-muted" aria-label="Edit" />}
    />
  ));
}

function PickPrompt({ view }: { view: View }) {
  return (
    <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-coral-bg text-accent">
        <MousePointerClick className="h-7 w-7" aria-hidden />
      </span>
      <p className="text-lg font-bold text-text-primary">Pick a student to begin</p>
      <p className="max-w-xs text-sm text-text-muted">
        Choose someone from the list on the left to {view === "pending" ? "add them as an alumnus" : "update their alumni record"}.
      </p>
    </div>
  );
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-[48px] px-3 font-bold transition-colors ${
        active ? "border-b-2 border-accent bg-hover-bg text-accent" : "border-b-2 border-transparent text-text-muted hover:bg-hover-bg"
      }`}
    >
      {children}
    </button>
  );
}

function StudentRow({
  active, onClick, name, meta, saved, action,
}: { active: boolean; onClick: () => void; name: string; meta: string; saved: boolean; action: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-center justify-between gap-3 border-l-4 px-3 py-2.5 text-left transition-colors ${
          active ? "border-accent bg-hover-bg" : "border-transparent hover:bg-hover-bg"
        }`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Initials name={name} />
          <span className="min-w-0">
            <span className={`block truncate text-sm ${active ? "font-bold text-accent" : "font-semibold text-text-primary"}`}>{name}</span>
            <span className="block truncate text-xs text-text-muted">{meta}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {saved && <Badge variant="success">Saved</Badge>}
          {action}
        </span>
      </button>
    </li>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <li className="px-3 py-8 text-center text-sm text-text-muted">{children}</li>;
}
