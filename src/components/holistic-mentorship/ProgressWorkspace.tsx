"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Clock, Download, History, RefreshCw, SearchX, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge, Button } from "@/components/ui";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
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
type ProgressFilters = {
  school: string;
  grade: string;
  mentor: string;
  phase: string;
  progress: string;
  search: string;
  sort: string;
  direction: string;
};
type ProgressFilterName = Exclude<keyof ProgressFilters, "direction">;
type FilterChangeHandler = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

const EMPTY: Payload = {
  rows: [], counts: { totalMapped: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
  options: { schools: [], mentors: [], phases: [] }, academicYears: [CURRENT_ACADEMIC_YEAR],
  refreshedAt: "", pageSize: 50,
};
const INITIAL_FILTERS: ProgressFilters = {
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

function useProgressView(academicYear: string) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [seenAcademicYear, setSeenAcademicYear] = useState(academicYear);
  if (seenAcademicYear !== academicYear) {
    setSeenAcademicYear(academicYear);
    setFilters((current) => ({ ...current, school: "", mentor: "", phase: "" }));
    setPage(1);
  }
  return { filters, setFilters, page, setPage };
}

function progressParams(academicYear: string, filters: ProgressFilters, page: number) {
  const params = new URLSearchParams({
    academic_year: academicYear,
    page: String(page),
    sort: filters.sort,
    direction: filters.direction,
  });
  if (filters.school) params.set("school_code", filters.school);
  if (filters.grade) params.set("grade", filters.grade);
  if (filters.mentor) params.set("mentor_user_id", filters.mentor);
  if (filters.phase) params.set("phase_id", filters.phase);
  if (filters.progress) params.set("progress", filters.progress);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  return params;
}

function progressIsFiltered(filters: ProgressFilters) {
  return Object.entries(filters).some(([key, value]) =>
    !["sort", "direction"].includes(key) && value.trim() !== ""
  );
}

export default function ProgressWorkspace({
  academicYear = CURRENT_ACADEMIC_YEAR,
  onAcademicYears,
}: {
  academicYear?: string;
  onAcademicYears?: (years: string[]) => void;
}) {
  const { filters, setFilters, page, setPage } = useProgressView(academicYear);
  const [ready, setReady] = useState(false);
  const savedScroll = useRef(0);
  const scrollRestored = useRef(false);
  const params = useMemo(
    () => progressParams(academicYear, filters, page),
    [academicYear, filters, page]
  );

  const { data, loading, error, reload } = useProgressData(params, ready);
  const { exporting, exportError, exportProgress } = useProgressExport(params, academicYear);

  useEffect(() => {
    if (data.academicYears.length > 0) onAcademicYears?.(data.academicYears);
  }, [data.academicYears, onAcademicYears]);


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
  }, [setFilters, setPage]);

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
  const clearFilters = () => {
    setFilters((current) => ({ ...INITIAL_FILTERS, sort: current.sort, direction: current.direction }));
    setPage(1);
  };
  const changeSort = (key: string) => {
    setFilters((current) => ({
      ...current,
      sort: key,
      direction: current.sort === key && current.direction === "asc" ? "desc" : "asc",
    }));
    setPage(1);
  };
  const filtered = progressIsFiltered(filters);
  const totalPages = Math.max(1, Math.ceil(data.counts.totalMapped / 50));
  return (
    <div aria-busy={loading} className="w-full min-w-0 max-w-full space-y-5">
      <ProgressIntro academicYear={academicYear} exporting={exporting} exportError={exportError}
        onExport={exportProgress} />
      <ProgressFilterPanel filters={filters} options={data.options} onChange={update} />
      <ProgressCounts counts={data.counts} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
          <Clock aria-hidden="true" className="h-4 w-4" />
          <span aria-live="polite" className="min-w-0 break-words">
            {refreshedLabel(data.refreshedAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" className="text-xs" onClick={clearFilters}>Clear filters</Button>
          <Button type="button" variant="secondary" className="text-xs" onClick={reload} disabled={loading}>
            <RefreshCw aria-hidden="true" className={`h-4 w-4 motion-reduce:animate-none ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ProgressResults
        rows={data.rows}
        loading={loading}
        academicYear={academicYear}
        hasMappings={data.options.schools.length > 0}
        filtered={filtered}
        sort={filters.sort}
        direction={filters.direction}
        onSort={changeSort}
        onClearFilters={clearFilters}
      />
      <ProgressPagination page={page} totalPages={totalPages} rowCount={data.rows.length}
        totalMapped={data.counts.totalMapped} onPageChange={setPage} />
    </div>
  );
}

function ProgressIntro({ academicYear, exporting, exportError, onExport }: {
  academicYear: string;
  exporting: boolean;
  exportError: string;
  onExport: () => Promise<void>;
}) {
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Students &amp; Progress</h2>
        <p className="text-sm text-text-muted">Mapped Mentees only. Mapping and Notes are read-only for Admins.</p>
      </div>
      <Button type="button" onClick={() => void onExport()} disabled={exporting}>
        <Download aria-hidden="true" className="h-4 w-4" /> {exporting ? "Exporting..." : "Export CSV"}
      </Button>
    </div>
    {academicYear !== CURRENT_ACADEMIC_YEAR && <div
      className="flex items-start gap-3 rounded-md bg-info-bg p-3 text-sm text-text-secondary">
      <History aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
      <p><strong className="text-text-primary">Viewing {academicYear}.</strong> This view shows Students
        who had a Mapping during that Academic Year. Earlier academic years are read-only.</p>
    </div>}
    {exportError && <p role="alert" className="text-sm text-danger">{exportError}</p>}
  </>;
}

function refreshedLabel(refreshedAt: string) {
  if (!refreshedAt) return "Not refreshed";
  return <>Last refreshed <span className="font-mono">{new Date(refreshedAt).toLocaleString()}</span></>;
}

function ProgressCounts({ counts }: { counts: Payload["counts"] }) {
  const items: Array<[string, number, string]> = [
    ["Total mapped Mentees", counts.totalMapped, ""],
    ["Pending", counts.pending, "border-t-[3px] border-t-warning-border"],
    ["Completed", counts.completed, "border-t-[3px] border-t-success"],
    ["Skipped", counts.skipped, "border-t-[3px] border-t-info"],
  ];
  if (counts.noActivePhase > 0) items.push(["No active phase", counts.noActivePhase, ""]);
  return <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border ${items.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
    {items.map(([label, value, accent]) => <div key={label} className={`bg-bg-card px-4 py-3 last:col-span-2 sm:last:col-span-1 ${accent}`}>
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl font-extrabold text-text-primary">{value}</p>
    </div>)}
  </div>;
}

const FILTER_LABEL = "block min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-text-muted";
const FILTER_CONTROL = "mt-1 min-h-11 w-full rounded-md border border-border bg-bg px-3 text-sm font-normal normal-case tracking-normal text-text-primary";

function ProgressFilterPanel({ filters, options, onChange }: {
  filters: ProgressFilters;
  options: Options;
  onChange: (name: ProgressFilterName) => FilterChangeHandler;
}) {
  return <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
    <label className={FILTER_LABEL}>
      School
      <select aria-label="Filter by School" className={FILTER_CONTROL} value={filters.school} onChange={onChange("school")}>
        <option value="">All Schools</option>
        {options.schools.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
      </select>
    </label>
    <label className={FILTER_LABEL}>
      Grade
      <select aria-label="Filter by Grade" className={FILTER_CONTROL} value={filters.grade} onChange={onChange("grade")}>
        <option value="">All Grades</option><option value="11">Grade 11</option><option value="12">Grade 12</option>
      </select>
    </label>
    <label className={FILTER_LABEL}>
      Phase
      <select aria-label="Phase lens" className={FILTER_CONTROL} value={filters.phase} onChange={onChange("phase")}>
        <option value="">Active Phase for each Grade</option>
        {options.phases.map((item) => <option key={item.id} value={item.id}>Phase {item.number}: {item.title} (Grade {item.grade})</option>)}
      </select>
    </label>
    <label className={FILTER_LABEL}>
      Mentor
      <select aria-label="Filter by Mentor" className={FILTER_CONTROL} value={filters.mentor} onChange={onChange("mentor")}>
        <option value="">All Mentors</option>
        {options.mentors.map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}
      </select>
    </label>
    <label className={FILTER_LABEL}>
      Progress
      <select aria-label="Filter by Progress" className={FILTER_CONTROL} value={filters.progress} onChange={onChange("progress")}>
        <option value="">All Progress</option><option value="pending">Pending</option><option value="completed">Completed</option>
        <option value="skipped">Skipped</option><option value="no_active_phase">No active phase</option>
      </select>
    </label>
    <label className={FILTER_LABEL}>
      Student
      <input aria-label="Search Students" className={FILTER_CONTROL} value={filters.search}
        onChange={onChange("search")} placeholder="Name or Student ID" />
    </label>
  </div>;
}

const SORTABLE_COLUMNS: Array<[string, string]> = [["student_name", "Student"], ["school", "School"], ["grade", "Grade"]];

function ProgressResults({
  rows,
  loading,
  academicYear,
  hasMappings,
  filtered,
  sort,
  direction,
  onSort,
  onClearFilters,
}: {
  rows: Row[];
  loading: boolean;
  academicYear: string;
  hasMappings: boolean;
  filtered: boolean;
  sort: string;
  direction: string;
  onSort: (key: string) => void;
  onClearFilters: () => void;
}) {
  if (!loading && rows.length === 0) {
    return <ProgressEmptyState hasMappings={hasMappings} filtered={filtered} onClearFilters={onClearFilters} />;
  }
  return <div role="region" aria-label="Student progress table" tabIndex={0}
    className="w-full min-w-0 max-w-full overflow-x-auto border-y border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset">
    <table aria-busy={loading} aria-label="Student progress results" className="w-full min-w-[1100px] text-left text-sm">
      <thead className="bg-bg-card-alt text-xs uppercase text-text-muted"><tr>
        {SORTABLE_COLUMNS.map(([key, label]) => <th key={key} className="px-3 py-3"
          aria-sort={sort === key ? (direction === "desc" ? "descending" : "ascending") : undefined}>
          <button type="button" className="inline-flex min-h-9 items-center gap-1 uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => onSort(key)}>
            {label}
            {sort === key && direction === "desc"
              ? <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
              : <ArrowUp aria-hidden="true" className={`h-3.5 w-3.5 ${sort === key ? "" : "opacity-30"}`} />}
          </button>
        </th>)}
        <th className="px-3 py-3">Mentor</th><th className="px-3 py-3">Phase</th>
        <th className="px-3 py-3">Progress</th><th className="px-3 py-3">Completed on</th>
        <th className="relative px-3 py-3"><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody className="divide-y divide-border">
        <ProgressRows rows={rows} loading={loading} academicYear={academicYear} />
      </tbody>
    </table>
  </div>;
}

function ProgressEmptyState({ hasMappings, filtered, onClearFilters }: {
  hasMappings: boolean;
  filtered: boolean;
  onClearFilters: () => void;
}) {
  const noMappings = !hasMappings && !filtered;
  const Icon = noMappings ? Users : SearchX;
  return <div className="flex min-h-64 flex-col items-center justify-center gap-3 border-y border-border p-8 text-center">
    <Icon aria-hidden="true" className="h-8 w-8 text-text-muted" />
    <p className="text-base font-semibold text-text-primary">
      {noMappings ? "No mapped Students exist for this Academic Year." : "No mapped Students match these filters."}
    </p>
    <p className="text-sm text-text-muted">
      {noMappings
        ? "Students appear here after Teachers assign them from their School workspace."
        : "Change or clear a filter to see more mapped Mentees."}
    </p>
    {!noMappings && <Button type="button" variant="secondary" onClick={onClearFilters}>Clear filters</Button>}
  </div>;
}

function ProgressRows({ rows, loading, academicYear }: {
  rows: Row[];
  loading: boolean;
  academicYear: string;
}) {
  if (loading && rows.length === 0) {
    return <tr><td colSpan={8} className="px-3 py-12 text-center text-text-muted"><span role="status">Loading mapped Students...</span></td></tr>;
  }
  return rows.map((row) => <ProgressRow key={row.studentId} row={row} academicYear={academicYear} />);
}

function ProgressRow({ row, academicYear }: {
  row: Row;
  academicYear: string;
}) {
  return <tr className="hover:bg-hover-bg/50">
    <td className="px-3 py-3"><p className="font-semibold text-text-primary">{row.studentName}</p><p className="font-mono text-xs text-text-muted">{row.externalStudentId || "No external ID"}</p></td>
    <td className="px-3 py-3"><p className="font-semibold text-text-primary">{row.schoolName}</p><p className="font-mono text-xs text-text-muted">{row.schoolCode}</p></td>
    <td className="px-3 py-3 font-mono">{row.grade}</td>
    <td className="px-3 py-3"><p className="font-semibold text-text-primary">{row.mentorName}</p><p className="text-xs text-text-muted">{row.mentorEmail || "No email"}</p></td>
    <td className="px-3 py-3"><PhaseCell row={row} /></td>
    <td className="px-3 py-3"><ProgressBadge progress={row.progress} /></td>
    <td className="px-3 py-3 font-mono"><CompletionTime value={row.completedAt} /></td>
    <td className="px-3 py-3"><ProgressActions row={row} academicYear={academicYear} /></td>
  </tr>;
}

function PhaseCell({ row }: { row: Row }) {
  if (row.phaseNumber === null) return <p className="font-semibold text-text-primary">No active phase</p>;
  return <>
    <p className="font-semibold text-text-primary">Phase {row.phaseNumber}: {row.phaseTitle}</p>
    <p className={`text-[11px] font-bold ${row.phaseState === "active" ? "text-accent" : "text-text-muted"}`}>
      {row.phaseState ? `${row.phaseState[0].toUpperCase()}${row.phaseState.slice(1)}` : ""}
    </p>
  </>;
}

const PROGRESS_LABELS: Record<string, string> = {
  completed: "Completed", pending: "Pending", skipped: "Skipped", no_active_phase: "No active phase",
};

function ProgressBadge({ progress }: { progress: Row["progress"] }) {
  const variant = progress === "completed" ? "success"
    : progress === "pending" ? "warning"
    : progress === "skipped" ? "info" : "default";
  return <Badge variant={variant}>{PROGRESS_LABELS[progress] ?? progress.replaceAll("_", " ")}</Badge>;
}

function CompletionTime({ value }: { value: string | null }) {
  if (!value) return <span className="text-text-muted">-</span>;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
}

function ProgressActions({ row, academicYear }: {
  row: Row;
  academicYear: string;
}) {
  const openable = row.phaseId && row.phaseState !== "locked";
  return <div className="flex items-center justify-end">
    {openable ? <Link aria-label={`Open ${row.studentName}`}
      className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-bg-card px-3 py-1.5 text-xs font-medium text-text-primary shadow-sm hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      href={`/holistic-mentorship/students/${row.studentId}/phases/${row.phaseId}?${new URLSearchParams({ school_code: row.schoolCode, academic_year: academicYear })}`}>
      Open Student
    </Link> : <Button type="button" variant="secondary" className="text-xs" disabled title="Phase is locked">Open Student</Button>}
  </div>;
}

function ProgressPagination({ page, totalPages, rowCount, totalMapped, onPageChange }: {
  page: number;
  totalPages: number;
  rowCount: number;
  totalMapped: number;
  onPageChange: React.Dispatch<React.SetStateAction<number>>;
}) {
  const start = rowCount > 0 ? (page - 1) * 50 + 1 : 0;
  const end = rowCount > 0 ? start + rowCount - 1 : 0;
  return <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
    <span className="text-text-muted">
      Showing <span className="font-mono">{start}-{end}</span> of <span className="font-mono">{totalMapped}</span> mapped Mentees
    </span>
    <div className="flex items-center gap-2">
      <Button className="min-w-11" variant="icon" aria-label="Previous page" disabled={page <= 1}
        onClick={() => onPageChange((value) => value - 1)}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></Button>
      <span aria-label={`Page ${page} of ${totalPages}`} className="font-mono text-xs text-text-secondary">{page} / {totalPages}</span>
      <Button className="min-w-11" variant="icon" aria-label="Next page" disabled={page >= totalPages}
        onClick={() => onPageChange((value) => value + 1)}><ChevronRight aria-hidden="true" className="h-4 w-4" /></Button>
    </div>
  </div>;
}
