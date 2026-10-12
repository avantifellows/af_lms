"use client";

// The Alumni tab on the school page: this year's (and earlier) pass-outs still
// to add, and the school's existing alumni. Talks only to /api/alumni/*.
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

export interface SelectedStudent {
  kind: "new" | "edit";
  userId: string;
  afid: string;
  name: string;
}

interface Props {
  schoolCode: string;
  initialStudentId?: string;
}

export default function AlumniTab({ schoolCode, initialStudentId }: Props) {
  const [pending, setPending] = useState<PendingStudent[]>([]);
  const [alumni, setAlumni] = useState<AlumniListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("pending");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [selected, setSelected] = useState<SelectedStudent | null>(null);
  /** Students saved in this session (shown with a "Saved" badge). */
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  /** Bumped after a save to reload the lists (a new alumnus moves to "Existing alumni"). */
  const [refresh, setRefresh] = useState(0);
  const initialised = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/alumni/school/${encodeURIComponent(schoolCode)}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || "Couldn't load students.");
        // Treat a missing list as empty rather than crashing on an unexpected reply.
        const pendingList: PendingStudent[] = Array.isArray(body?.pending) ? body.pending : [];
        const alumniList: AlumniListItem[] = Array.isArray(body?.alumni) ? body.alumni : [];
        setPending(pendingList);
        setAlumni(alumniList);

        // On a refresh after saving, keep the current view and selection.
        if (initialised.current) return;
        initialised.current = true;

        // Open the student picked from the dashboard search, else start on
        // whichever list has work in it.
        const fromPending = initialStudentId && pendingList.find((s) => s.userId === initialStudentId);
        const fromAlumni = initialStudentId && alumniList.find((s) => s.userId === initialStudentId);
        if (fromPending) {
          setView("pending");
          setSelected({ kind: "new", userId: fromPending.userId, afid: fromPending.afid, name: fromPending.name });
        } else if (fromAlumni) {
          setView("alumni");
          setSelected({ kind: "edit", userId: fromAlumni.userId, afid: fromAlumni.afid, name: fromAlumni.name });
        } else {
          setView(pendingList.length > 0 ? "pending" : "alumni");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load students.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolCode, initialStudentId, refresh]);

  const years = useMemo(
    () => [...new Set((view === "pending" ? pending : alumni).map((a) => a.cohortYear).filter(Boolean))].sort().reverse(),
    [view, pending, alumni],
  );

  const needle = query.trim().toLowerCase();
  const matches = (name: string, afid: string) =>
    !needle || name.toLowerCase().includes(needle) || afid.toLowerCase().includes(needle);

  const visiblePending = pending.filter((s) => (!year || s.cohortYear === year) && matches(s.name, s.afid));
  const visibleAlumni = alumni.filter((a) => (!year || a.cohortYear === year) && matches(a.name, a.afid));

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]" aria-busy="true" aria-label="Loading students">
        <Card elevation="sm" className="space-y-3 rounded-xl p-4">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="animate-pulse rounded-full bg-bg-card-alt h-9 w-9 " />
              <div className="flex-1 space-y-1.5">
                <div className="animate-pulse rounded-lg bg-bg-card-alt h-3 w-2/3" />
                <div className="animate-pulse rounded-lg bg-bg-card-alt h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </Card>
        <Card elevation="sm" className="rounded-xl p-6">
          <div className="animate-pulse rounded-lg bg-bg-card-alt h-6 w-1/3" />
          <div className="animate-pulse rounded-lg bg-bg-card-alt mt-4 h-40 w-full" />
        </Card>
      </div>
    );
  }
  if (error) return <p className="py-10 text-center text-sm text-danger">{error}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <Card elevation="sm" className="flex max-h-[78vh] flex-col overflow-hidden rounded-xl lg:sticky lg:top-20">
        <div className="grid grid-cols-2 border-b border-border text-sm" role="tablist" aria-label="Student lists">
          <ViewButton active={view === "pending"} onClick={() => { setView("pending"); setYear(""); }}>
            To add · {pending.length}
          </ViewButton>
          <ViewButton active={view === "alumni"} onClick={() => { setView("alumni"); setYear(""); }}>
            Existing alumni · {alumni.length}
          </ViewButton>
        </div>

        <div className="space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Filter by name or AFID" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {years.length > 1 && (
            <Select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Pass-out year">
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

        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {view === "pending" &&
            (visiblePending.length === 0 ? (
              <EmptyRow>
                {pending.length === 0 ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> Everyone who passed out is added.
                  </span>
                ) : (
                  "No students match."
                )}
              </EmptyRow>
            ) : (
              visiblePending.map((s) => (
                <StudentRow
                  key={s.userId}
                  active={selected?.userId === s.userId}
                  onClick={() => setSelected({ kind: "new", userId: s.userId, afid: s.afid, name: s.name })}
                  name={s.name}
                  meta={[`AFID ${s.afid}`, s.cohortYear && `Passed out ${s.cohortYear}`, s.program].filter(Boolean).join(" · ")}
                  saved={savedIds.has(s.userId)}
                  action={<UserPlus className="h-4 w-4 text-accent" aria-label="Add" />}
                />
              ))
            ))}

          {view === "alumni" &&
            (visibleAlumni.length === 0 ? (
              <EmptyRow>{alumni.length === 0 ? "No alumni recorded for this school." : "No alumni match."}</EmptyRow>
            ) : (
              visibleAlumni.map((a) => (
                <StudentRow
                  key={a.userId}
                  active={selected?.userId === a.userId}
                  onClick={() => setSelected({ kind: "edit", userId: a.userId, afid: a.afid, name: a.name })}
                  name={a.name}
                  meta={[a.cohortYear && `Cohort ${a.cohortYear}`, a.ugStatus, a.collegeUg].filter(Boolean).join(" · ")}
                  saved={savedIds.has(a.userId)}
                  action={<Pencil className="h-4 w-4 text-text-muted" aria-label="Edit" />}
                />
              ))
            ))}
        </ul>
      </Card>

      <Card elevation="sm" className="min-h-[300px] rounded-xl p-6">
        {selected ? (
          <AlumniForm
            key={selected.userId}
            userId={selected.userId}
            onSaved={(id) => {
              setSavedIds((prev) => new Set(prev).add(id));
              setRefresh((n) => n + 1);
            }}
          />
        ) : (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-coral-bg text-accent">
              <MousePointerClick className="h-7 w-7" aria-hidden />
            </span>
            <p className="text-lg font-bold text-text-primary">Pick a student to begin</p>
            <p className="max-w-xs text-sm text-text-muted">
              Choose someone from the list on the left to {view === "pending" ? "add them as an alumnus" : "update their alumni record"}.
            </p>
          </div>
        )}
      </Card>
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
