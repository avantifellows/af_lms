"use client";

import { Download, ExternalLink, RefreshCw, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Badge, Button } from "@/components/ui";
import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS, PROGRAM_ID_TO_LABEL } from "@/lib/constants";
import type { HolisticProgressRow } from "@/types/holistic-progress";

type Row = HolisticProgressRow;
type Options = {
  schools: Array<{ code: string; name: string }>;
  mentors: Array<{ userId: number; name: string }>;
  phases: Array<{ id: number; number: number; title: string; grade: 11 | 12; state: string }>;
};
type Payload = {
  rows: Row[];
  counts: { totalMapped: number; pending: number; completed: number; skipped: number; noActivePhase: number };
  options: Options; academicYears: string[]; refreshedAt: string; pageSize: 50;
};
type RegenerationState = "queued" | "running" | "completed" | "failed";
type ProfilePayload = {
  summaries: Array<{ position: number; title: string; summary: string }>;
  regeneration: null | {
    requestKey: string;
    state: RegenerationState;
    requestedAt: string;
  };
};

type ProgressFilters = {
  academicYear: string;
  school: string;
  grade: string;
  mentor: string;
  phase: string;
  progress: string;
  search: string;
  sort: string;
  direction: string;
};
type ProgressFilterName = Exclude<keyof ProgressFilters, "academicYear" | "direction">;
type FilterChangeHandler = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

const EMPTY: Payload = {
  rows: [], counts: { totalMapped: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
  options: { schools: [], mentors: [], phases: [] }, academicYears: [CURRENT_ACADEMIC_YEAR],
  refreshedAt: "", pageSize: 50,
};
const INITIAL_FILTERS: ProgressFilters = {
  academicYear: CURRENT_ACADEMIC_YEAR,
  school: "",
  grade: "",
  mentor: "",
  phase: "",
  progress: "",
  search: "",
  sort: "school",
  direction: "asc",
};
const VIEW_STATE_KEY = "holistic-progress-view";
const SCROLL_KEY = "holistic-progress-scroll";

async function jsonObject(response: Response): Promise<Record<string, unknown> | null> {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

function responseError(body: Record<string, unknown> | null, fallback: string) {
  return typeof body?.error === "string" ? body.error : fallback;
}

function regenerationVariant(state: RegenerationState) {
  if (state === "completed") return "success" as const;
  if (state === "failed") return "danger" as const;
  return "info" as const;
}

async function fetchProfile(studentId: number, academicYear: string): Promise<ProfilePayload> {
  const response = await fetch(`/api/holistic-mentorship/profiles/${studentId}?academic_year=${academicYear}`);
  const body = await jsonObject(response);
  if (!response.ok) throw new Error(responseError(body, `Unable to load Profile (${response.status})`));
  if (!body || !Array.isArray(body.summaries)) throw new Error("Unable to load Profile");
  return body as ProfilePayload;
}

function regenerationSuccessMessage(body: Record<string, unknown> | null) {
  if (body?.delivery === "ambiguous") return "Regeneration queued. Delivery is not yet confirmed.";
  const state = typeof body?.state === "string" ? body.state : "queued";
  return state === "queued" ? "Regeneration queued." : `Regeneration is ${state}.`;
}

async function queueProfileRegeneration(studentId: number, requestKey: string) {
  try {
    const response = await fetch(`/api/holistic-mentorship/profiles/${studentId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_key: requestKey, force: true }),
    });
    const body = await jsonObject(response);
    return response.ok
      ? { message: { error: false, text: regenerationSuccessMessage(body) }, refresh: true }
      : { message: { error: true, text: responseError(body, `Unable to queue regeneration (${response.status})`) }, refresh: true };
  } catch {
    return {
      message: { error: true, text: "Could not confirm regeneration. Refresh status before retrying." },
      refresh: false,
    };
  }
}

function storedView() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(VIEW_STATE_KEY) ?? "null") as {
      filters?: Partial<ProgressFilters>;
      page?: number;
    } | null;
    const filters = Object.fromEntries(Object.entries(stored?.filters ?? {})
      .filter(([, value]) => typeof value === "string"));
    return {
      filters: { ...INITIAL_FILTERS, ...filters },
      page: Number.isSafeInteger(stored?.page) && stored!.page! > 0 ? stored!.page! : 1,
    };
  } catch {
    return { filters: INITIAL_FILTERS, page: 1 };
  }
}

function useProgressData(params: URLSearchParams, ready: boolean) {
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/holistic-mentorship/progress?${params}`, { signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load progress");
      setData(body);
      setError("");
    } catch (problem) {
      if ((problem as Error).name !== "AbortError") setError((problem as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, ready, refresh]);

  return { data, loading, error, reload: () => setRefresh((value) => value + 1) };
}

function useProgressExport(params: URLSearchParams, academicYear: string) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportProgress = async () => {
    const exportParams = new URLSearchParams(params);
    exportParams.delete("page");
    exportParams.set("format", "csv");
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch(`/api/holistic-mentorship/progress?${exportParams}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Unable to export progress (${response.status})`);
      }
      const downloadUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `holistic-progress-${academicYear}.csv`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (problem) {
      setExportError(problem instanceof Error ? problem.message : "Unable to export progress");
    } finally {
      setExporting(false);
    }
  };
  return { exporting, exportError, exportProgress };
}

export default function ProgressWorkspace() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [profileStudent, setProfileStudent] = useState<Row | null>(null);
  const savedScroll = useRef(0);
  const scrollRestored = useRef(false);

  const params = useMemo(() => {
    const value = new URLSearchParams({
      academic_year: filters.academicYear,
      page: String(page),
      sort: filters.sort,
      direction: filters.direction,
    });
    if (filters.school) value.set("school_code", filters.school);
    if (filters.grade) value.set("grade", filters.grade);
    if (filters.mentor) value.set("mentor_user_id", filters.mentor);
    if (filters.phase) value.set("phase_id", filters.phase);
    if (filters.progress) value.set("progress", filters.progress);
    if (filters.search.trim()) value.set("search", filters.search.trim());
    return value;
  }, [filters, page]);

  const { data, loading, error, reload } = useProgressData(params, ready);
  const { exporting, exportError, exportProgress } = useProgressExport(params, filters.academicYear);

  useEffect(() => {
    const stored = storedView();
    savedScroll.current = Number(sessionStorage.getItem(SCROLL_KEY)) || 0;
    queueMicrotask(() => {
      setFilters(stored.filters);
      setPage(stored.page);
      setReady(true);
    });
    const rememberScroll = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => window.removeEventListener("scroll", rememberScroll);
  }, []);

  useEffect(() => {
    if (!ready) return;
    sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ filters, page }));
  }, [filters, page, ready]);

  useEffect(() => {
    if (!ready || loading || scrollRestored.current || savedScroll.current <= 0) return;
    scrollRestored.current = true;
    window.scrollTo({ top: savedScroll.current });
  }, [loading, ready]);

  const update = (name: ProgressFilterName): FilterChangeHandler => (event) => {
    setFilters((current) => ({ ...current, [name]: event.target.value }));
    setPage(1);
  };
  const updateAcademicYear = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((current) => ({
      ...current,
      academicYear: event.target.value,
      school: "",
      mentor: "",
      phase: "",
    }));
    setPage(1);
  };
  const totalPages = Math.max(1, Math.ceil(data.counts.totalMapped / 50));
  return (
    <div aria-busy={loading} className="w-full min-w-0 max-w-full space-y-5">
      <ProgressCounts counts={data.counts} />
      <ProgressFilterPanel
        filters={filters}
        options={data.options}
        academicYears={data.academicYears}
        refreshedAt={data.refreshedAt}
        loading={loading}
        exporting={exporting}
        exportError={exportError}
        onChange={update}
        onAcademicYearChange={updateAcademicYear}
        onRefresh={reload}
        onExport={() => void exportProgress()}
        onDirectionChange={() => setFilters((current) => ({
          ...current,
          direction: current.direction === "asc" ? "desc" : "asc",
        }))}
      />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ProgressResults
        rows={data.rows}
        loading={loading}
        academicYear={filters.academicYear}
        hasMappings={data.options.schools.length > 0}
        onOpenProfile={setProfileStudent}
      />
      <ProgressPagination page={page} totalPages={totalPages} onPageChange={setPage} />
      {profileStudent && <ProfilePanel student={profileStudent} academicYear={filters.academicYear} onClose={() => setProfileStudent(null)} />}
    </div>
  );
}

function ProgressCounts({ counts }: { counts: Payload["counts"] }) {
  const items: Array<[string, number]> = [
    ["Mapped", counts.totalMapped],
    ["Pending", counts.pending],
    ["Completed", counts.completed],
    ["Skipped", counts.skipped],
    ["No active phase", counts.noActivePhase],
  ];
  return <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5">
    {items.map(([label, value]) => <div key={label} className="bg-bg-card px-4 py-3 last:col-span-2 sm:last:col-span-1">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-primary">{value}</p>
    </div>)}
  </div>;
}

function ProgressFilterPanel({
  filters,
  options,
  academicYears,
  refreshedAt,
  loading,
  exporting,
  exportError,
  onChange,
  onAcademicYearChange,
  onRefresh,
  onExport,
  onDirectionChange,
}: {
  filters: ProgressFilters;
  options: Options;
  academicYears: string[];
  refreshedAt: string;
  loading: boolean;
  exporting: boolean;
  exportError: string;
  onChange: (name: ProgressFilterName) => FilterChangeHandler;
  onAcademicYearChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onRefresh: () => void;
  onExport: () => void;
  onDirectionChange: () => void;
}) {
  return <div className="space-y-3 border-y border-border py-4">
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="relative min-w-0 sm:col-span-2">
        <span className="sr-only">Search Students</span>
        <Search aria-hidden="true" className="absolute left-3 top-3 h-5 w-5 text-text-muted" />
        <input className="min-h-11 w-full rounded-md border border-border bg-bg pl-10 pr-3 text-sm" value={filters.search}
          onChange={onChange("search")} placeholder="Student name or external ID" />
      </label>
      <label className="min-w-0 text-xs font-medium text-text-muted">
        Program
        <select aria-label="Program" className="mt-1 min-h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-text-primary" value={PROGRAM_IDS.COE} disabled>
          <option value={PROGRAM_IDS.COE}>{PROGRAM_ID_TO_LABEL[PROGRAM_IDS.COE]} (Program {PROGRAM_IDS.COE})</option>
        </select>
      </label>
      <label className="min-w-0 text-xs font-medium text-text-muted">
        Academic Year
        <select aria-label="Academic Year" className="mt-1 min-h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-text-primary" value={filters.academicYear} onChange={onAcademicYearChange}>
          {academicYears.map((year) => <option key={year}>{year}</option>)}
        </select>
      </label>
      <select aria-label="Phase lens" className="min-h-11 min-w-0 w-full rounded-md border border-border bg-bg px-3 text-sm" value={filters.phase} onChange={onChange("phase")}>
        <option value="">Active Phase for each Grade</option>
        {options.phases.map((item) => <option key={item.id} value={item.id}>Phase {item.number}: {item.title} (Grade {item.grade})</option>)}
      </select>
      <select aria-label="Filter by School" className="min-h-11 min-w-0 w-full rounded-md border border-border bg-bg px-3 text-sm" value={filters.school} onChange={onChange("school")}>
        <option value="">All Schools</option>
        {options.schools.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
      </select>
      <select aria-label="Filter by Grade" className="min-h-11 min-w-0 w-full rounded-md border border-border bg-bg px-3 text-sm" value={filters.grade} onChange={onChange("grade")}>
        <option value="">All Grades</option><option value="11">Grade 11</option><option value="12">Grade 12</option>
      </select>
      <select aria-label="Filter by Mentor" className="min-h-11 min-w-0 w-full rounded-md border border-border bg-bg px-3 text-sm" value={filters.mentor} onChange={onChange("mentor")}>
        <option value="">All Mentors</option>
        {options.mentors.map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}
      </select>
      <select aria-label="Filter by Progress" className="min-h-11 min-w-0 w-full rounded-md border border-border bg-bg px-3 text-sm" value={filters.progress} onChange={onChange("progress")}>
        <option value="">All Progress</option><option value="pending">Pending</option><option value="completed">Completed</option>
        <option value="skipped">Skipped</option><option value="no_active_phase">No active phase</option>
      </select>
    </div>
    {filters.academicYear !== CURRENT_ACADEMIC_YEAR &&
      <p className="text-sm font-medium text-text-muted">Earlier academic years are read-only.</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-muted">
        <span aria-live="polite" className="min-w-0 break-words">{refreshedAt ? `Last refreshed ${new Date(refreshedAt).toLocaleString()}` : "Not refreshed"}</span>
        <Button className="min-w-11" variant="icon" aria-label="Refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw aria-hidden="true" className={`h-4 w-4 motion-reduce:animate-none ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <select aria-label="Sort results" className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-xs sm:flex-none" value={filters.sort} onChange={onChange("sort")}>
          <option value="student_name">Student</option><option value="school">School</option><option value="grade">Grade</option>
          <option value="mentor">Mentor</option><option value="phase">Phase</option><option value="progress">Progress</option>
        </select>
        <button type="button" className="min-h-11 rounded-md border border-border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={onDirectionChange}>
          {filters.direction === "asc" ? "Ascending" : "Descending"}
        </button>
        <Button type="button" variant="secondary" onClick={onExport} disabled={exporting}>
          <Download aria-hidden="true" className="h-4 w-4" /> {exporting ? "Exporting..." : "Export CSV"}
        </Button>
      </div>
    </div>
    {exportError && <p role="alert" className="text-sm text-danger">{exportError}</p>}
  </div>;
}

function ProgressResults({
  rows,
  loading,
  academicYear,
  hasMappings,
  onOpenProfile,
}: {
  rows: Row[];
  loading: boolean;
  academicYear: string;
  hasMappings: boolean;
  onOpenProfile: (row: Row) => void;
}) {
  return <div role="region" aria-label="Student progress table" tabIndex={0}
    className="w-full min-w-0 max-w-full overflow-x-auto border-y border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset">
    <table aria-busy={loading} aria-label="Student progress results" className="w-full min-w-[1200px] text-left text-sm">
      <thead className="bg-bg-card-alt text-xs uppercase text-text-muted"><tr>
        <th className="px-3 py-3">Student</th><th className="px-3 py-3">School</th><th className="px-3 py-3">Grade</th>
        <th className="px-3 py-3">Mentor</th><th className="px-3 py-3">Phase</th><th className="px-3 py-3">Availability</th>
        <th className="px-3 py-3">Progress</th><th className="px-3 py-3">Completed on</th><th className="px-3 py-3">Actions</th>
      </tr></thead>
      <tbody className="divide-y divide-border">
        <ProgressRows rows={rows} loading={loading} academicYear={academicYear} hasMappings={hasMappings} onOpenProfile={onOpenProfile} />
      </tbody>
    </table>
  </div>;
}

function ProgressRows({ rows, loading, academicYear, hasMappings, onOpenProfile }: {
  rows: Row[];
  loading: boolean;
  academicYear: string;
  hasMappings: boolean;
  onOpenProfile: (row: Row) => void;
}) {
  if (loading && rows.length === 0) {
    return <tr><td colSpan={9} className="px-3 py-12 text-center text-text-muted"><span role="status">Loading mapped Students...</span></td></tr>;
  }
  if (rows.length === 0) {
    return <tr><td colSpan={9} className="px-3 py-12 text-center text-text-muted">
      {hasMappings ? "No mapped Students match these filters." : "No mapped Students exist for this Academic Year."}
    </td></tr>;
  }
  return rows.map((row) => <ProgressRow key={row.studentId} row={row} academicYear={academicYear} onOpenProfile={onOpenProfile} />);
}

function ProgressRow({ row, academicYear, onOpenProfile }: {
  row: Row;
  academicYear: string;
  onOpenProfile: (row: Row) => void;
}) {
  return <tr className="hover:bg-hover-bg/50">
    <td className="px-3 py-3"><p className="font-semibold text-text-primary">{row.studentName}</p><p className="text-xs text-text-muted">{row.externalStudentId || "No external ID"}</p></td>
    <td className="px-3 py-3"><p>{row.schoolName}</p><p className="text-xs text-text-muted">{row.schoolCode}</p></td>
    <td className="px-3 py-3">{row.grade}</td><td className="px-3 py-3"><p>{row.mentorName}</p><p className="text-xs text-text-muted">{row.mentorEmail || "No email"}</p></td>
    <td className="px-3 py-3"><PhaseName row={row} /></td>
    <td className="px-3 py-3"><PhaseAvailability state={row.phaseState} /></td>
    <td className="px-3 py-3"><ProgressBadge progress={row.progress} /></td>
    <td className="px-3 py-3"><CompletionTime value={row.completedAt} /></td>
    <td className="px-3 py-3"><ProgressActions row={row} academicYear={academicYear} onOpenProfile={onOpenProfile} /></td>
  </tr>;
}

function PhaseName({ row }: { row: Row }) {
  if (row.phaseNumber === null) return <>No active phase</>;
  return <>Phase {row.phaseNumber}: {row.phaseTitle}</>;
}

function PhaseAvailability({ state }: { state: Row["phaseState"] }) {
  if (!state) return <span className="text-text-muted">-</span>;
  const variant = state === "active" ? "success" : state === "open" ? "info" : "default";
  return <Badge variant={variant}>{state[0].toUpperCase()}{state.slice(1)}</Badge>;
}

function ProgressBadge({ progress }: { progress: Row["progress"] }) {
  const variant = progress === "completed" ? "success" : progress === "skipped" ? "warning" : "default";
  return <Badge variant={variant}>{progress.replaceAll("_", " ")}</Badge>;
}

function CompletionTime({ value }: { value: string | null }) {
  if (!value) return <span className="text-text-muted">-</span>;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ProgressActions({ row, academicYear, onOpenProfile }: {
  row: Row;
  academicYear: string;
  onOpenProfile: (row: Row) => void;
}) {
  return <div className="flex justify-end gap-1">
    <Button className="min-w-11" variant="icon" aria-label={`Profile for ${row.studentName}`} onClick={() => onOpenProfile(row)}>
      <Sparkles aria-hidden="true" className="h-4 w-4" />
    </Button>
    {row.phaseId && <Link aria-label={`Open ${row.studentName}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 text-accent hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      href={`/holistic-mentorship/students/${row.studentId}/phases/${row.phaseId}?${new URLSearchParams({ school_code: row.schoolCode, academic_year: academicYear })}`}>
      <ExternalLink aria-hidden="true" className="h-4 w-4" />
    </Link>}
  </div>;
}

function ProgressPagination({ page, totalPages, onPageChange }: {
  page: number;
  totalPages: number;
  onPageChange: React.Dispatch<React.SetStateAction<number>>;
}) {
  return <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
    <span className="text-text-muted">Page {page} of {totalPages}</span>
    <div className="flex gap-2">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange((value) => value - 1)}>Previous</Button>
      <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange((value) => value + 1)}>Next</Button>
    </div>
  </div>;
}

function useProfilePanel(student: Row, academicYear: string) {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusKnown, setStatusKnown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionMessage, setActionMessage] = useState<{ error: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setStatusKnown(false);
    setLoadError("");
    try {
      setProfile(await fetchProfile(student.studentId, academicYear));
      setStatusKnown(true);
    } catch (problem) {
      setLoadError(problem instanceof Error ? problem.message : "Unable to load Profile");
    } finally {
      setLoading(false);
    }
  }, [academicYear, student.studentId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const regenerate = async () => {
    if (!window.confirm(`Regenerate ${student.studentName}'s Profile from the approved source?`)) return;
    const requestKey = profile?.regeneration?.state === "queued"
      ? profile.regeneration.requestKey
      : crypto.randomUUID();
    setSubmitting(true);
    setStatusKnown(false);
    setActionMessage(null);
    const result = await queueProfileRegeneration(student.studentId, requestKey);
    setActionMessage(result.message);
    if (result.refresh) await load();
    setSubmitting(false);
  };
  return { profile, loading, statusKnown, submitting, loadError, actionMessage, load, regenerate };
}

function ProfilePanel({ student, academicYear, onClose }: { student: Row; academicYear: string; onClose: () => void }) {
  const panel = useProfilePanel(student, academicYear);
  const running = panel.profile?.regeneration?.state === "running";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const handledClose = useRef(false);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const finishClose = useCallback(() => {
    if (handledClose.current) return;
    handledClose.current = true;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    closeButtonRef.current?.focus();
    return () => { openerRef.current?.focus(); };
  }, []);

  const requestClose = () => {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    finishClose();
  };

  const keepFocusInDialog = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return <dialog
    ref={dialogRef}
    aria-modal="true"
    aria-labelledby={`${titleId} ${subtitleId}`}
    className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
    onClose={finishClose}
    onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onKeyDown={keepFocusInDialog}
  >
    <div className="flex h-full justify-end bg-black/30">
      <div className="h-full w-full max-w-xl min-w-0 overflow-y-auto overscroll-contain bg-bg-card p-4 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4"><div className="min-w-0"><h2 id={titleId} className="break-words text-lg font-semibold">{student.studentName}</h2><p id={subtitleId} className="text-sm text-text-muted">Student Profile</p></div>
          <Button ref={closeButtonRef} className="shrink-0" variant="secondary" onClick={requestClose}>Close</Button></div>
        <div className="space-y-4 py-5">
          <ProfilePanelContent {...panel} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!panel.statusKnown || panel.submitting || running} onClick={panel.regenerate} aria-busy={panel.submitting}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" /> Regenerate Profile
            </Button>
            <Button variant="secondary" disabled={panel.loading || panel.submitting} onClick={() => void panel.load()}>
              Refresh Status
            </Button>
          </div>
        </div>
      </div>
    </div>
  </dialog>;
}

function ProfilePanelContent({ profile, loading, loadError, actionMessage }: ReturnType<typeof useProfilePanel>) {
  return <>
    {profile?.regeneration && <p className="text-sm">Regeneration status: <Badge variant={regenerationVariant(profile.regeneration.state)}>{profile.regeneration.state}</Badge></p>}
    {loading && <p role="status" className="text-sm text-text-muted">Refreshing Profile status...</p>}
    {profile?.summaries.length === 0 && <p className="text-sm text-text-muted">Profile unavailable for the Active configuration.</p>}
    {profile?.summaries.map((summary) => <section key={summary.position} className="min-w-0 border-b border-border pb-4"><h3 className="break-words text-sm font-semibold">{summary.title}</h3><p className="mt-1 break-words whitespace-pre-wrap text-sm text-text-secondary">{summary.summary}</p></section>)}
    {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}
    {actionMessage && <p role={actionMessage.error ? "alert" : "status"} className={actionMessage.error ? "text-sm text-danger" : "text-sm text-text-secondary"}>{actionMessage.text}</p>}
  </>;
}
