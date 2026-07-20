"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  SearchX,
  UserMinus,
  UserRound,
  UserRoundCheck,
  UserRoundPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

interface Student {
  studentId: number;
  name: string;
  externalStudentId: string | null;
  grade: number;
  activePhaseId: number | null;
  activeNotesState: "draft" | "submitted" | null;
  ownership: {
    mappingId: number;
    mentorUserId: number;
    mentorName: string;
  } | null;
}

interface SavedFilters {
  search: string;
  grade: "" | "11" | "12";
  assignment: "" | "unassigned" | "other";
  page: number;
  menteeSearch: string;
  menteeGrade: "" | "11" | "12";
  menteeStatus: "" | "draft" | "pending" | "completed" | "none";
}

const EMPTY_FILTERS: SavedFilters = {
  search: "",
  grade: "",
  assignment: "",
  page: 1,
  menteeSearch: "",
  menteeGrade: "",
  menteeStatus: "",
};

const ROSTER_PAGE_SIZE = 10;

const FIELD_LABEL_CLASSES =
  "block min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-text-muted";
const FIELD_INPUT_CLASSES =
  "mt-1 min-h-11 w-full rounded-md border border-border bg-bg px-3 text-sm font-normal normal-case tracking-normal";

function savedGrade(value: unknown): SavedFilters["grade"] {
  return value === "11" || value === "12" ? value : "";
}

function savedAssignment(value: unknown): SavedFilters["assignment"] {
  return value === "unassigned" || value === "other" ? value : "";
}

function savedMenteeStatus(value: unknown): SavedFilters["menteeStatus"] {
  return value === "draft" || value === "pending" || value === "completed" || value === "none"
    ? value
    : "";
}

function savedFilters(schoolCode: string): SavedFilters {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(`holistic-mappings:${schoolCode}`) || "null"
    ) as Partial<SavedFilters> | null;
    if (!parsed) return EMPTY_FILTERS;
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      grade: savedGrade(parsed.grade),
      assignment: savedAssignment(parsed.assignment),
      page: Number.isInteger(parsed.page) && (parsed.page as number) >= 1 ? (parsed.page as number) : 1,
      menteeSearch: typeof parsed.menteeSearch === "string" ? parsed.menteeSearch : "",
      menteeGrade: savedGrade(parsed.menteeGrade),
      menteeStatus: savedMenteeStatus(parsed.menteeStatus),
    };
  } catch {
    return EMPTY_FILTERS;
  }
}

function matchesQuery(student: Student, queryText: string) {
  const query = queryText.trim().toLowerCase();
  if (!query) return true;
  return (
    student.name.toLowerCase().includes(query) ||
    (student.externalStudentId ?? "").toLowerCase().includes(query)
  );
}

function rosterStudents(students: Student[], actorUserId: number | null) {
  return students.filter(
    (student) => student.ownership === null || student.ownership.mentorUserId !== actorUserId
  );
}

function visibleRosterStudents(roster: Student[], filters: SavedFilters) {
  return roster.filter((student) => {
    if (filters.grade && String(student.grade) !== filters.grade) return false;
    if (filters.assignment === "unassigned" && student.ownership !== null) return false;
    if (filters.assignment === "other" && student.ownership === null) return false;
    return matchesQuery(student, filters.search);
  });
}

type MenteeStatus = "draft" | "pending" | "completed" | "none";

function menteeStatus(student: Student): MenteeStatus {
  if (student.activePhaseId === null) return "none";
  if (student.activeNotesState === "submitted") return "completed";
  if (student.activeNotesState === "draft") return "draft";
  return "pending";
}

const MENTEE_STATUS_RANK: Record<MenteeStatus, number> = {
  draft: 0,
  pending: 1,
  completed: 2,
  none: 3,
};

const MENTEE_STATUS_LABEL: Record<MenteeStatus, string> = {
  draft: "Draft saved",
  pending: "Pending",
  completed: "Completed",
  none: "No active phase",
};

const MENTEE_STATUS_CLASSES: Record<MenteeStatus, string> = {
  draft: "bg-accent/10 text-accent",
  pending: "border border-border bg-bg-card-alt text-text-muted",
  completed: "bg-success/10 text-success",
  none: "border border-border bg-bg-card-alt text-text-muted",
};

function visibleMentees(mentees: Student[], filters: SavedFilters) {
  return mentees
    .filter((student) => {
      if (filters.menteeGrade && String(student.grade) !== filters.menteeGrade) return false;
      if (filters.menteeStatus && menteeStatus(student) !== filters.menteeStatus) return false;
      return matchesQuery(student, filters.menteeSearch);
    })
    .sort((a, b) =>
      MENTEE_STATUS_RANK[menteeStatus(a)] - MENTEE_STATUS_RANK[menteeStatus(b)] ||
      a.name.localeCompare(b.name)
    );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function studentCount(count: number): string {
  return `${count} Student${count === 1 ? "" : "s"}`;
}

function assignmentConfirmation(choices: Student[], reassigned: Student[]): string {
  if (reassigned.length === 0) return `Assign ${studentCount(choices.length)} to yourself?`;
  const mentors = [...new Set(reassigned.map((student) => student.ownership!.mentorName))];
  const verb = reassigned.length === 1 ? "is" : "are";
  return `${studentCount(reassigned.length)} ${verb} currently assigned to ${mentors.join(", ")}. Assign all ${studentCount(choices.length)} to yourself?`;
}

function assignmentSuccess(choices: Student[], reassigned: Student[]): string {
  if (reassigned.length === 0) return `Assigned ${studentCount(choices.length)} to you.`;
  return `Assigned ${studentCount(choices.length)} to you, including ${studentCount(reassigned.length)} reassigned from another Mentor.`;
}

async function mappingChangeError(
  method: "POST" | "DELETE",
  body: unknown,
  networkError: string
): Promise<string> {
  try {
    const response = await fetch("/api/holistic-mentorship/mappings", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return response.ok ? "" : data.error || "Mapping changed; review the refreshed roster";
  } catch {
    return networkError;
  }
}

export default function TeacherMappingWorkspace({
  schoolCode,
  canEdit = true,
}: {
  schoolCode: string;
  canEdit?: boolean;
}) {
  const [filters, setFilters] = useState(() => savedFilters(schoolCode));
  const [students, setStudents] = useState<Student[]>([]);
  const [actorUserId, setActorUserId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setSuccess("");
    let loaded = false;
    const params = new URLSearchParams({
      school_code: schoolCode,
      academic_year: CURRENT_ACADEMIC_YEAR,
      search: "",
    });
    try {
      const response = await fetch(`/api/holistic-mentorship/mappings?${params}`, { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load Students");
      setStudents(data.students);
      setActorUserId(data.actorUserId);
      setSelected([]);
      setMessage("");
      const hasMentees = (data.students as Student[]).some(
        (student) => student.ownership?.mentorUserId === data.actorUserId
      );
      if (!hasMentees) setAssignOpen(true);
      loaded = true;
    } catch (error) {
      if ((error as Error).name !== "AbortError") setMessage((error as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
    return loaded;
  }, [schoolCode]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    sessionStorage.setItem(`holistic-mappings:${schoolCode}`, JSON.stringify(filters));
  }, [filters, schoolCode]);

  useEffect(() => {
    const key = `holistic-mappings-scroll:${schoolCode}`;
    const saved = Number(sessionStorage.getItem(key));
    if (Number.isFinite(saved) && saved > 0) window.scrollTo({ top: saved });
    const remember = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [schoolCode]);

  const roster = rosterStudents(students, actorUserId);
  const visibleRoster = visibleRosterStudents(roster, filters);
  const rosterPageCount = Math.max(1, Math.ceil(visibleRoster.length / ROSTER_PAGE_SIZE));
  const rosterPage = Math.min(Math.max(1, filters.page), rosterPageCount);
  const pagedRoster = visibleRoster.slice(
    (rosterPage - 1) * ROSTER_PAGE_SIZE,
    rosterPage * ROSTER_PAGE_SIZE
  );
  const mentees = students.filter((student) => student.ownership?.mentorUserId === actorUserId);
  const shownMentees = visibleMentees(mentees, filters);

  const toggle = (studentId: number) => {
    setSelected((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  };

  const changeFilter = (updates: Partial<SavedFilters>) => {
    const next = { ...updates };
    if ("search" in updates || "grade" in updates || "assignment" in updates) {
      setSelected([]);
      next.page = 1;
    }
    setFilters((current) => ({ ...current, ...next }));
  };

  const assign = async () => {
    const choices = visibleRoster.filter((student) => selected.includes(student.studentId));
    const reassigned = choices.filter(
      (student) => student.ownership && student.ownership.mentorUserId !== actorUserId
    );
    if (choices.length === 0) return;
    const takeover = reassigned.length > 0;
    if (!window.confirm(assignmentConfirmation(choices, reassigned))) return;
    setBusy(true);
    const problem = await mappingChangeError("POST", {
      school_code: schoolCode,
      academic_year: CURRENT_ACADEMIC_YEAR,
      takeover_confirmed: takeover,
      selections: choices.map((student) => ({
        student_id: student.studentId,
        expected_mapping_id: student.ownership?.mappingId ?? null,
      })),
    }, "Unable to update Mappings");
    const refreshed = await load();
    if (problem) {
      setMessage(problem);
    } else if (refreshed) {
      setSuccess(assignmentSuccess(choices, reassigned));
    }
    setBusy(false);
  };

  const remove = async (student: Student) => {
    if (!student.ownership || !window.confirm(
      `Remove ${student.name} from My Mentees? The Student will become unassigned and you will lose access to their Holistic Mentorship data.`
    )) return;
    setBusy(true);
    const problem = await mappingChangeError("DELETE", {
      school_code: schoolCode,
      academic_year: CURRENT_ACADEMIC_YEAR,
      confirmed: true,
      mappings: [{
        student_id: student.studentId,
        expected_mapping_id: student.ownership.mappingId,
      }],
    }, "Unable to remove Mapping");
    const refreshed = await load();
    if (problem) setMessage(problem);
    if (!problem && refreshed) {
      setSuccess(`Removed ${student.name}. The Student is now unassigned.`);
    }
    setBusy(false);
  };

  return (
    <section className="min-w-0 max-w-full space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
            Holistic Mentorship
          </h2>
          <p className="text-sm text-text-muted">Assign Students to yourself to start mentorship</p>
        </div>
        <span className="self-start rounded-full bg-info-bg px-3 py-1.5 font-mono text-xs font-bold text-info sm:self-auto">
          {CURRENT_ACADEMIC_YEAR}
        </span>
      </div>
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      {success && <p role="status" className="text-sm text-success">{success}</p>}
      {loading ? (
        <p role="status" aria-live="polite" className="py-12 text-center text-sm text-text-muted">
          Loading Students...
        </p>
      ) : (
        <>
          <AssignmentRoster
            students={pagedRoster}
            visibleCount={visibleRoster.length}
            page={rosterPage}
            pageCount={rosterPageCount}
            allCount={roster.length}
            filters={filters}
            canEdit={canEdit}
            selected={selected}
            busy={busy}
            open={assignOpen}
            onOpenChange={setAssignOpen}
            onFilterChange={changeFilter}
            onToggle={toggle}
            onSelectShown={() => setSelected(pagedRoster.map((student) => student.studentId))}
            onAssign={assign}
          />
          <MenteesSection
            mentees={mentees}
            shown={shownMentees}
            filters={filters}
            canEdit={canEdit}
            busy={busy}
            schoolCode={schoolCode}
            onFilterChange={changeFilter}
            onRemove={remove}
            onOpenRoster={() => setAssignOpen(true)}
          />
        </>
      )}
    </section>
  );
}

function AssignmentRoster({ students, visibleCount, page, pageCount, allCount, filters, canEdit, selected, busy, open, onOpenChange, onFilterChange, onToggle, onSelectShown, onAssign }: {
  students: Student[];
  visibleCount: number;
  page: number;
  pageCount: number;
  allCount: number;
  filters: SavedFilters;
  canEdit: boolean;
  selected: number[];
  busy: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilterChange: (updates: Partial<SavedFilters>) => void;
  onToggle: (studentId: number) => void;
  onSelectShown: () => void;
  onAssign: () => Promise<void>;
}) {
  return <details open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}
    className="group overflow-hidden rounded-md border border-border bg-bg-card shadow-sm">
    <summary className="flex min-h-[58px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-extrabold uppercase tracking-wide text-text-primary [&::-webkit-details-marker]:hidden">
      <span className="flex flex-wrap items-center gap-2">
        <UserRoundPlus aria-hidden="true" className="h-[18px] w-[18px]" />
        Assign Students
        <span className="text-xs font-medium normal-case tracking-normal text-text-muted">
          School roster only
        </span>
      </span>
      <ChevronDown aria-hidden="true"
        className="h-[18px] w-[18px] shrink-0 transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-border">
      <RosterToolbar filters={filters} allCount={allCount} canEdit={canEdit}
        selectedCount={selected.length} busy={busy} onFilterChange={onFilterChange} onAssign={onAssign} />
      <RosterTable students={students} allCount={allCount} canEdit={canEdit} selected={selected}
        page={page} visibleCount={visibleCount}
        onToggle={onToggle} onClearFilters={() => onFilterChange({ search: "", grade: "", assignment: "" })} />
      {visibleCount > 0 && <RosterPagination page={page} pageCount={pageCount} total={visibleCount}
        onPageChange={(nextPage) => onFilterChange({ page: nextPage })} />}
      <div className="flex min-h-16 flex-col justify-between gap-2 border-t border-border px-4 py-2 sm:flex-row sm:items-center">
        <span className="text-xs text-text-muted">
          You can view full mentorship data only after a Student is assigned to you.
        </span>
        {canEdit && students.length > 0 && (
          <Button type="button" variant="ghost" className="text-xs" onClick={onSelectShown}>
            Select all shown
          </Button>
        )}
      </div>
    </div>
  </details>;
}

function RosterPagination({ page, pageCount, total, onPageChange }: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const start = (page - 1) * ROSTER_PAGE_SIZE + 1;
  const end = Math.min(page * ROSTER_PAGE_SIZE, total);
  return <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
    <span className="text-xs text-text-muted">
      Showing <span className="font-mono font-semibold text-text-secondary">{start}-{end}</span> of{" "}
      <span className="font-mono font-semibold text-text-secondary">{total}</span> Students
    </span>
    <div className="flex items-center gap-1">
      <Button type="button" variant="icon" title="Previous page" aria-label="Previous page"
        disabled={page === 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
      </Button>
      <span aria-label={`Page ${page} of ${pageCount}`}
        className="px-1 font-mono text-xs font-bold text-text-secondary">
        {page} / {pageCount}
      </span>
      <Button type="button" variant="icon" title="Next page" aria-label="Next page"
        disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>
        <ChevronRight aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  </div>;
}

function RosterToolbar({ filters, allCount, canEdit, selectedCount, busy, onFilterChange, onAssign }: {
  filters: SavedFilters;
  allCount: number;
  canEdit: boolean;
  selectedCount: number;
  busy: boolean;
  onFilterChange: (updates: Partial<SavedFilters>) => void;
  onAssign: () => Promise<void>;
}) {
  return <div className="grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_13rem_auto]">
    <label className={FIELD_LABEL_CLASSES}>
      Search Student
      <input aria-label="Search Students" className={FIELD_INPUT_CLASSES}
        value={filters.search} placeholder="Name or Student ID"
        onChange={(event) => onFilterChange({ search: event.target.value })} />
    </label>
    <label className={FIELD_LABEL_CLASSES}>
      Grade
      <select aria-label="Filter by Grade" className={FIELD_INPUT_CLASSES}
        value={filters.grade}
        onChange={(event) => onFilterChange({ grade: event.target.value as SavedFilters["grade"] })}>
        <option value="">All Grades</option><option value="11">Grade 11</option><option value="12">Grade 12</option>
      </select>
    </label>
    <label className={FIELD_LABEL_CLASSES}>
      Show
      <select aria-label="Filter by Assignment" className={FIELD_INPUT_CLASSES}
        value={filters.assignment}
        onChange={(event) => onFilterChange({ assignment: event.target.value as SavedFilters["assignment"] })}>
        <option value="">All available ({allCount})</option>
        <option value="unassigned">Unassigned</option>
        <option value="other">Assigned to others</option>
      </select>
    </label>
    {canEdit && (
      <Button type="button" disabled={busy || selectedCount === 0} onClick={() => void onAssign()}>
        <UserRoundCheck aria-hidden="true" className="h-4 w-4" />
        Assign to me{selectedCount > 0 ? ` (${selectedCount})` : ""}
      </Button>
    )}
  </div>;
}

function RosterTable({ students, allCount, canEdit, selected, page, visibleCount, onToggle, onClearFilters }: {
  students: Student[];
  allCount: number;
  canEdit: boolean;
  selected: number[];
  page: number;
  visibleCount: number;
  onToggle: (studentId: number) => void;
  onClearFilters: () => void;
}) {
  if (allCount === 0) {
    return <RosterEmptyState icon={Users}
      title="No eligible Students at this School"
      body="No current Grade 11 or 12 Program 1 Students are available for Holistic Mentor assignment." />;
  }
  if (students.length === 0) {
    return <RosterEmptyState title="No Students match" body="Change the filter or search text.">
      <Button type="button" variant="secondary" onClick={onClearFilters}>
        Clear search and filters
      </Button>
    </RosterEmptyState>;
  }
  return <>
    <p role="status" aria-live="polite" className="sr-only">
      Showing Students {(page - 1) * ROSTER_PAGE_SIZE + 1} to{" "}
      {(page - 1) * ROSTER_PAGE_SIZE + students.length} of {visibleCount}.
    </p>
    <div role="region" aria-label="Student assignment results" tabIndex={0}
      className="overflow-x-auto border-t border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset">
      <table aria-label="Student assignment results" className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-bg-card-alt text-xs uppercase text-text-muted"><tr>
          {canEdit && <th className="w-12 px-3 py-3"><span className="sr-only">Select</span></th>}
          <th className="px-3 py-3">Student</th><th className="px-3 py-3">Grade</th>
          <th className="px-3 py-3">Current assignment</th>
        </tr></thead>
        <tbody className="divide-y divide-border">
          {students.map((student) => <tr key={student.studentId} className="hover:bg-accent/5">
            {canEdit && <td className="px-3 py-2">
              <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2">
                <input type="checkbox" aria-label={`Select ${student.name}`}
                  checked={selected.includes(student.studentId)}
                  className="h-5 w-5 accent-accent" onChange={() => onToggle(student.studentId)} />
              </label>
            </td>}
            <td className="px-3 py-2">
              <StudentCell student={student} />
            </td>
            <td className="px-3 py-2 text-text-muted">Grade {student.grade}</td>
            <td className="px-3 py-2"><AssignmentBadge student={student} /></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </>;
}

function StudentCell({ student }: { student: Student }) {
  return <span className="flex min-w-0 items-center gap-2.5">
    <span aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-info-bg text-xs font-extrabold text-info">
      {initials(student.name)}
    </span>
    <span className="min-w-0">
      <span className="block font-semibold text-text-primary">{student.name}</span>
      {student.externalStudentId && (
        <span className="block font-mono text-xs text-text-muted">{student.externalStudentId}</span>
      )}
    </span>
  </span>;
}

function AssignmentBadge({ student }: { student: Student }) {
  if (!student.ownership) {
    return <span className="inline-flex items-center rounded-full border border-border bg-bg-card-alt px-2.5 py-1 text-xs font-bold text-text-muted">
      Unassigned
    </span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-bold text-warning-text">
    <UserRound aria-hidden="true" className="h-3.5 w-3.5" />
    {student.ownership.mentorName}
  </span>;
}

function RosterEmptyState({ icon: Icon = SearchX, title, body, children }: {
  icon?: typeof SearchX;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return <div className="grid min-h-44 place-items-center border-t border-border px-5 py-8 text-center">
    <div className="max-w-md space-y-2">
      <Icon aria-hidden="true" className="mx-auto h-10 w-10 text-text-muted" />
      <h3 className="text-sm font-bold text-text-primary">{title}</h3>
      <p className="text-sm text-text-muted">{body}</p>
      {children}
    </div>
  </div>;
}

function MenteesSection({ mentees, shown, filters, canEdit, busy, schoolCode, onFilterChange, onRemove, onOpenRoster }: {
  mentees: Student[];
  shown: Student[];
  filters: SavedFilters;
  canEdit: boolean;
  busy: boolean;
  schoolCode: string;
  onFilterChange: (updates: Partial<SavedFilters>) => void;
  onRemove: (student: Student) => Promise<void>;
  onOpenRoster: () => void;
}) {
  const countLabel = shown.length === mentees.length
    ? `${mentees.length} current ${mentees.length === 1 ? "Mentee" : "Mentees"}`
    : `${shown.length} of ${mentees.length} Mentees shown`;
  return <div className="space-y-4 pt-2">
    <div>
      <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">My Mentees</h2>
      <p className="text-sm text-text-muted">{countLabel}</p>
    </div>
    {mentees.length > 0 && (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_13rem]">
        <label className={FIELD_LABEL_CLASSES}>
          Search Mentees
          <input aria-label="Search Mentees" className={FIELD_INPUT_CLASSES}
            value={filters.menteeSearch} placeholder="Name or Student ID"
            onChange={(event) => onFilterChange({ menteeSearch: event.target.value })} />
        </label>
        <label className={FIELD_LABEL_CLASSES}>
          Grade
          <select aria-label="Filter Mentees by Grade" className={FIELD_INPUT_CLASSES}
            value={filters.menteeGrade}
            onChange={(event) => onFilterChange({ menteeGrade: event.target.value as SavedFilters["menteeGrade"] })}>
            <option value="">All Grades</option><option value="11">Grade 11</option><option value="12">Grade 12</option>
          </select>
        </label>
        <label className={FIELD_LABEL_CLASSES}>
          Active-Phase status
          <select aria-label="Active-Phase status" className={FIELD_INPUT_CLASSES}
            value={filters.menteeStatus}
            onChange={(event) => onFilterChange({ menteeStatus: event.target.value as SavedFilters["menteeStatus"] })}>
            <option value="">All statuses</option>
            <option value="draft">Draft saved</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="none">No active phase</option>
          </select>
        </label>
      </div>
    )}
    <MenteeCards mentees={mentees} shown={shown} canEdit={canEdit} busy={busy} schoolCode={schoolCode}
      onRemove={onRemove} onOpenRoster={onOpenRoster}
      onClearFilters={() => onFilterChange({ menteeSearch: "", menteeGrade: "", menteeStatus: "" })} />
  </div>;
}

function MenteeCards({ mentees, shown, canEdit, busy, schoolCode, onRemove, onOpenRoster, onClearFilters }: {
  mentees: Student[];
  shown: Student[];
  canEdit: boolean;
  busy: boolean;
  schoolCode: string;
  onRemove: (student: Student) => Promise<void>;
  onOpenRoster: () => void;
  onClearFilters: () => void;
}) {
  if (mentees.length === 0) {
    return <div className="grid min-h-52 place-items-center rounded-md border border-border bg-bg-card px-5 py-10 text-center shadow-sm">
      <div className="max-w-md space-y-2">
        <Users aria-hidden="true" className="mx-auto h-10 w-10 text-text-muted" />
        <h3 className="text-sm font-bold text-text-primary">No Mentees assigned</h3>
        <p className="text-sm text-text-muted">
          Select Students from the assignment roster and choose Assign to me.
        </p>
        <Button type="button" variant="secondary" onClick={onOpenRoster}>
          View assignment roster
        </Button>
      </div>
    </div>;
  }
  if (shown.length === 0) {
    return <div className="grid min-h-44 place-items-center rounded-md border border-border bg-bg-card px-5 py-8 text-center shadow-sm">
      <div className="max-w-md space-y-2">
        <SearchX aria-hidden="true" className="mx-auto h-10 w-10 text-text-muted" />
        <h3 className="text-sm font-bold text-text-primary">No Mentees match</h3>
        <p className="text-sm text-text-muted">Change the search or filters.</p>
        <Button type="button" variant="secondary" onClick={onClearFilters}>
          Clear search and filters
        </Button>
      </div>
    </div>;
  }
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {shown.map((student) => <MenteeCard key={student.studentId} student={student} canEdit={canEdit}
      busy={busy} schoolCode={schoolCode} onRemove={onRemove} />)}
  </div>;
}

function MenteeCard({ student, canEdit, busy, schoolCode, onRemove }: {
  student: Student;
  canEdit: boolean;
  busy: boolean;
  schoolCode: string;
  onRemove: (student: Student) => Promise<void>;
}) {
  const status = menteeStatus(student);
  const body = (
    <div className="flex items-start justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-info-bg text-xs font-extrabold text-info">
          {initials(student.name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-base font-bold text-text-primary">{student.name}</span>
          <span className="block font-mono text-xs text-text-muted">
            Grade {student.grade}{student.externalStudentId ? ` | ${student.externalStudentId}` : ""}
          </span>
        </span>
      </span>
      <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold ${MENTEE_STATUS_CLASSES[status]}`}>
        {MENTEE_STATUS_LABEL[status]}
      </span>
    </div>
  );
  return <article className="overflow-hidden rounded-md border border-border bg-bg-card shadow-sm transition-shadow hover:shadow-md">
    {student.activePhaseId ? (
      <Link
        href={`/holistic-mentorship/students/${student.studentId}/phases/${student.activePhaseId}?${new URLSearchParams({ school_code: schoolCode, academic_year: CURRENT_ACADEMIC_YEAR })}`}
        aria-label={`Open ${student.name}`}
        className="block min-h-[74px] p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset">
        {body}
      </Link>
    ) : (
      <div className="min-h-[74px] p-4">{body}</div>
    )}
    <div className="flex min-h-11 items-center justify-between gap-2 border-t border-border py-1 pl-4 pr-1.5">
      <span className="text-xs text-text-muted">Current-year Mentee</span>
      {canEdit && (
        <button type="button" aria-label={`Remove ${student.name}`} title="Remove assignment"
          disabled={busy} onClick={() => void onRemove(student)}
          className="grid h-11 w-11 place-items-center rounded-md text-text-muted hover:bg-accent/10 hover:text-accent disabled:opacity-50">
          <UserMinus aria-hidden="true" className="h-[18px] w-[18px]" />
        </button>
      )}
    </div>
  </article>;
}
