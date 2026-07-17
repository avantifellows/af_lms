"use client";

import { Download, ExternalLink, RefreshCw, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  options: Options; refreshedAt: string; pageSize: 50;
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
  options: { schools: [], mentors: [], phases: [] }, refreshedAt: "", pageSize: 50,
};
const INITIAL_FILTERS: ProgressFilters = {
  academicYear: CURRENT_ACADEMIC_YEAR,
  school: "",
  grade: "",
  mentor: "",
  phase: "",
  progress: "",
  search: "",
  sort: "student_name",
  direction: "asc",
};

function yearOptions() {
  const start = Number(CURRENT_ACADEMIC_YEAR.slice(0, 4));
  return Array.from({ length: 3 }, (_, index) => `${start - index}-${start - index + 1}`);
}

export default function ProgressWorkspace() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profileStudent, setProfileStudent] = useState<Row | null>(null);

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
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refresh]);

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
  const exportHref = `/api/holistic-mentorship/progress?${params}&format=csv`;

  return (
    <div className="min-w-0 max-w-full space-y-5">
      <ProgressCounts counts={data.counts} />
      <ProgressFilterPanel
        filters={filters}
        options={data.options}
        refreshedAt={data.refreshedAt}
        loading={loading}
        exportHref={exportHref}
        onChange={update}
        onAcademicYearChange={updateAcademicYear}
        onRefresh={() => setRefresh((value) => value + 1)}
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
    {items.map(([label, value]) => <div key={label} className="bg-bg-card px-4 py-3">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-primary">{value}</p>
    </div>)}
  </div>;
}

function ProgressFilterPanel({
  filters,
  options,
  refreshedAt,
  loading,
  exportHref,
  onChange,
  onAcademicYearChange,
  onRefresh,
  onDirectionChange,
}: {
  filters: ProgressFilters;
  options: Options;
  refreshedAt: string;
  loading: boolean;
  exportHref: string;
  onChange: (name: ProgressFilterName) => FilterChangeHandler;
  onAcademicYearChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onRefresh: () => void;
  onDirectionChange: () => void;
}) {
  return <div className="space-y-3 border-y border-border py-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="relative sm:col-span-2">
        <span className="sr-only">Search Students</span>
        <Search aria-hidden="true" className="absolute left-3 top-3 h-5 w-5 text-text-muted" />
        <input className="min-h-11 w-full rounded-md border border-border bg-bg pl-10 pr-3 text-sm" value={filters.search}
          onChange={onChange("search")} placeholder="Student name or external ID" />
      </label>
      <select aria-label="Academic Year" className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm" value={filters.academicYear} onChange={onAcademicYearChange}>
        {yearOptions().map((year) => <option key={year}>{year}</option>)}
      </select>
      <select aria-label="Phase lens" className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm" value={filters.phase} onChange={onChange("phase")}>
        <option value="">Active Phase for each Grade</option>
        {options.phases.map((item) => <option key={item.id} value={item.id}>Phase {item.number}: {item.title} (Grade {item.grade})</option>)}
      </select>
      <select aria-label="Filter by School" className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm" value={filters.school} onChange={onChange("school")}>
        <option value="">All Schools</option>
        {options.schools.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
      </select>
      <select aria-label="Filter by Grade" className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm" value={filters.grade} onChange={onChange("grade")}>
        <option value="">All Grades</option><option value="11">Grade 11</option><option value="12">Grade 12</option>
      </select>
      <select aria-label="Filter by Mentor" className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm" value={filters.mentor} onChange={onChange("mentor")}>
        <option value="">All Mentors</option>
        {options.mentors.map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}
      </select>
      <select aria-label="Filter by Progress" className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm" value={filters.progress} onChange={onChange("progress")}>
        <option value="">All Progress</option><option value="pending">Pending</option><option value="completed">Completed</option>
        <option value="skipped">Skipped</option><option value="no_active_phase">No active phase</option>
      </select>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span>{refreshedAt ? `Last refreshed ${new Date(refreshedAt).toLocaleString()}` : "Not refreshed"}</span>
        <Button variant="icon" size="sm" aria-label="Refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <select aria-label="Sort results" className="min-h-9 rounded-md border border-border bg-bg px-2 text-xs" value={filters.sort} onChange={onChange("sort")}>
          <option value="student_name">Student</option><option value="school">School</option><option value="grade">Grade</option>
          <option value="mentor">Mentor</option><option value="phase">Phase</option><option value="progress">Progress</option>
        </select>
        <button type="button" className="min-h-9 rounded-md border border-border px-3 text-xs" onClick={onDirectionChange}>
          {filters.direction === "asc" ? "Ascending" : "Descending"}
        </button>
        <a href={exportHref} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-bg-card px-3 text-xs font-semibold hover:bg-hover-bg">
          <Download aria-hidden="true" className="h-4 w-4" /> Export CSV
        </a>
      </div>
    </div>
  </div>;
}

function ProgressResults({
  rows,
  loading,
  academicYear,
  onOpenProfile,
}: {
  rows: Row[];
  loading: boolean;
  academicYear: string;
  onOpenProfile: (row: Row) => void;
}) {
  return <div aria-label="Student progress results" className="w-full min-w-0 max-w-full overflow-x-auto border-y border-border">
    <table className="w-full min-w-[900px] text-left text-sm">
      <thead className="bg-bg-card-alt text-xs uppercase text-text-muted"><tr>
        <th className="px-3 py-3">Student</th><th className="px-3 py-3">School</th><th className="px-3 py-3">Grade</th>
        <th className="px-3 py-3">Mentor</th><th className="px-3 py-3">Phase</th><th className="px-3 py-3">Progress</th><th className="px-3 py-3"><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody className="divide-y divide-border">
        <ProgressRows rows={rows} loading={loading} academicYear={academicYear} onOpenProfile={onOpenProfile} />
      </tbody>
    </table>
  </div>;
}

function ProgressRows({ rows, loading, academicYear, onOpenProfile }: {
  rows: Row[];
  loading: boolean;
  academicYear: string;
  onOpenProfile: (row: Row) => void;
}) {
  if (loading && rows.length === 0) {
    return <tr><td colSpan={7} className="px-3 py-12 text-center text-text-muted">Loading mapped Students...</td></tr>;
  }
  if (rows.length === 0) {
    return <tr><td colSpan={7} className="px-3 py-12 text-center text-text-muted">No mapped Students match these filters.</td></tr>;
  }
  return rows.map((row) => <ProgressRow key={row.studentId} row={row} academicYear={academicYear} onOpenProfile={onOpenProfile} />);
}

function ProgressRow({ row, academicYear, onOpenProfile }: {
  row: Row;
  academicYear: string;
  onOpenProfile: (row: Row) => void;
}) {
  const badgeVariant = row.progress === "completed" ? "success" : row.progress === "skipped" ? "warning" : "default";
  return <tr className="hover:bg-hover-bg/50">
    <td className="px-3 py-3"><p className="font-semibold text-text-primary">{row.studentName}</p><p className="text-xs text-text-muted">{row.externalStudentId || "No external ID"}</p></td>
    <td className="px-3 py-3"><p>{row.schoolName}</p><p className="text-xs text-text-muted">{row.schoolCode}</p></td>
    <td className="px-3 py-3">{row.grade}</td><td className="px-3 py-3">{row.mentorName}</td>
    <td className="px-3 py-3">{row.phaseNumber ? `Phase ${row.phaseNumber}: ${row.phaseTitle}` : "No active phase"}</td>
    <td className="px-3 py-3"><Badge variant={badgeVariant}>{row.progress.replaceAll("_", " ")}</Badge></td>
    <td className="px-3 py-3"><div className="flex justify-end gap-1">
      <Button variant="icon" size="sm" aria-label={`Profile for ${row.studentName}`} onClick={() => onOpenProfile(row)}><Sparkles aria-hidden="true" className="h-4 w-4" /></Button>
      {row.phaseId && <Link aria-label={`Open ${row.studentName}`} className="inline-flex min-h-9 items-center rounded-md p-2 text-accent hover:bg-hover-bg"
        href={`/holistic-mentorship/students/${row.studentId}/phases/${row.phaseId}?${new URLSearchParams({ school_code: row.schoolCode, academic_year: academicYear })}`}>
        <ExternalLink aria-hidden="true" className="h-4 w-4" />
      </Link>}
    </div></td>
  </tr>;
}

function ProgressPagination({ page, totalPages, onPageChange }: {
  page: number;
  totalPages: number;
  onPageChange: React.Dispatch<React.SetStateAction<number>>;
}) {
  return <div className="flex items-center justify-between text-sm">
    <span className="text-text-muted">Page {page} of {totalPages}</span>
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange((value) => value - 1)}>Previous</Button>
      <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPageChange((value) => value + 1)}>Next</Button>
    </div>
  </div>;
}

function ProfilePanel({ student, academicYear, onClose }: { student: Row; academicYear: string; onClose: () => void }) {
  const [profile, setProfile] = useState<{ summaries: Array<{ position: number; title: string; summary: string }>; regeneration: null | { requestKey: string; state: string; requestedAt: string } } | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/holistic-mentorship/profiles/${student.studentId}?academic_year=${academicYear}`);
    const body = await response.json();
    if (response.ok) setProfile(body); else setMessage(body.error || "Unable to load Profile");
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
    const response = await fetch(`/api/holistic-mentorship/profiles/${student.studentId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_key: requestKey, force: true }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Regeneration queued." : body.error || "Unable to queue regeneration");
    await load();
  };
  return <div role="dialog" aria-modal="true" aria-label={`${student.studentName} Profile`} className="fixed inset-0 z-50 flex justify-end bg-black/30">
    <div className="h-full w-full max-w-xl overflow-y-auto bg-bg-card p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4"><div><h2 className="text-lg font-semibold">{student.studentName}</h2><p className="text-sm text-text-muted">Student Profile</p></div>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button></div>
      <div className="space-y-4 py-5">
        {profile?.regeneration && <p className="text-sm">Regeneration status: <Badge>{profile.regeneration.state}</Badge></p>}
        {profile?.summaries.length === 0 && <p className="text-sm text-text-muted">Profile unavailable for the Active configuration.</p>}
        {profile?.summaries.map((summary) => <section key={summary.position} className="border-b border-border pb-4"><h3 className="text-sm font-semibold">{summary.title}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{summary.summary}</p></section>)}
        {message && <p role="status" className="text-sm text-text-secondary">{message}</p>}
        <Button onClick={regenerate}><RefreshCw aria-hidden="true" className="h-4 w-4" /> Regenerate Profile</Button>
      </div>
    </div>
  </div>;
}
