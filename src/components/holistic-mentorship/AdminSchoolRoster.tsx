"use client";

import { ArrowUpRight, Search, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Badge, Button, Input, Modal, Select } from "@/components/ui";
import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "@/lib/constants";
import {
  coveragePageKey,
  coverageReturnFor,
  hasActiveCoverageFilters,
  MAX_COVERAGE_SEARCH_LENGTH,
  readCoverageFilters,
  writeCoverageFilters,
  type CoverageFilters,
} from "@/lib/holistic-coverage-filters";
import { holisticStudentPhaseHref } from "@/lib/holistic-links";
import type {
  HolisticAssignmentCoverageSummary,
  HolisticAssignmentRosterStudent as Student,
} from "@/lib/holistic-mappings";
import HolisticTutorialLink from "./HolisticTutorialLink";
import StudentIdentity from "./StudentIdentity";

type EligibleMentor = { userId: number; name: string; email: string | null };
type MentorFilterOption = { value: string; label: string };
type StudentLinkContext = {
  schoolCode: string;
  programId: number;
  fromHolisticProgress: boolean;
  returnQuery: string;
};

const NO_MENTORS: EligibleMentor[] = [];
// Search writes to the URL once typing pauses (browsers throttle rapid
// history.replaceState calls). Leaving the search box, any click inside the
// roster, and unmounting (a School tab switch) write at once.
const URL_WRITE_DELAY_MS = 300;
const FILTER_LABEL = "block text-[11px] font-extrabold uppercase tracking-wide text-text-muted";

// A row's Current Progress, as on Students & Progress: Pending, Completed and
// No active phase describe an assigned Student's current Phase; a Student
// without a Mentor is Unassigned whatever their Phase.
type RowProgress = "completed" | "pending" | "no_active_phase" | "unassigned";

const PROGRESS_LABEL: Record<RowProgress, string> = {
  completed: "Completed",
  pending: "Pending",
  no_active_phase: "No active phase",
  unassigned: "Unassigned",
};

const PROGRESS_CLASSES: Record<Exclude<RowProgress, "unassigned">, string> = {
  completed: "bg-success-bg text-success",
  pending: "border border-border bg-bg-card-alt text-text-muted",
  no_active_phase: "border border-border bg-bg-card-alt text-text-muted",
};

function progress(student: Student): RowProgress {
  if (student.ownership === null) return "unassigned";
  if (student.activePhaseId === null) return "no_active_phase";
  if (student.activeNotesState === "submitted") return "completed";
  return "pending";
}

function ProgressBadge({ state }: { state: RowProgress }) {
  // Styled like Students & Progress's Unassigned badge.
  if (state === "unassigned") return <Badge variant="default">{PROGRESS_LABEL.unassigned}</Badge>;
  return <span
    className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${PROGRESS_CLASSES[state]}`}>
    {PROGRESS_LABEL[state]}
  </span>;
}

function studentHref(student: Student, link: StudentLinkContext) {
  if (!student.activePhaseId) return null;
  return holisticStudentPhaseHref({
    studentId: student.studentId,
    phaseId: student.activePhaseId,
    schoolCode: link.schoolCode,
    academicYear: CURRENT_ACADEMIC_YEAR,
    programId: link.programId,
    source: link.fromHolisticProgress ? "school-progress" : "school",
    returnQuery: link.returnQuery,
  });
}

function derivedSummary(students: Student[]): HolisticAssignmentCoverageSummary {
  const assigned = students.filter((student) => student.ownership).length;
  const mentors = new Set(students.flatMap((student) =>
    student.ownership ? [student.ownership.mentorUserId] : [])).size;
  const coveragePercentage = students.length
    // Multiply before dividing so half-way values round like Postgres ROUND
    // (201 of 400 is 50.3%; dividing first gives 502.4999… and 50.2%).
    ? Math.round((assigned * 1000) / students.length) / 10
    : 0;
  return {
    eligible: students.length,
    assigned,
    unassigned: students.length - assigned,
    activeMentors: mentors,
    coveragePercentage,
    completed: students.filter((student) => progress(student) === "completed").length,
    pending: students.filter((student) => progress(student) === "pending").length,
    noActivePhase: students.filter((student) => progress(student) === "no_active_phase").length,
  };
}

function Summary({ summary }: { summary: HolisticAssignmentCoverageSummary }) {
  const metrics = [
    ["Eligible Students", summary.eligible],
    ["Assigned", summary.assigned],
    ["Unassigned", summary.unassigned],
    ["Active Mentors", summary.activeMentors],
    ["Coverage", `${summary.coveragePercentage.toFixed(1)}%`],
    ["Completed", summary.completed],
    ["Pending", summary.pending],
    ["No active phase", summary.noActivePhase],
  ];
  return <div role="region" aria-label="Assignment Coverage summary"
    className="grid grid-cols-2 border-y border-border bg-bg-card sm:grid-cols-4 lg:grid-cols-8">
    {metrics.map(([label, value]) => <div key={label}
      className="border-b border-border px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="font-mono text-xl font-bold text-text-primary">{value}</div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
    </div>)}
  </div>;
}

type CoverageTableProps = {
  students: Student[];
  link: StudentLinkContext;
  canManage: boolean;
  controlsDisabled: boolean;
  onAssign: (student: Student) => void;
  onReassign: (student: Student) => void;
  onRemove: (student: Student) => void;
};

function CoverageTable({ students, link, canManage, controlsDisabled,
  onAssign, onReassign, onRemove }: CoverageTableProps) {
  return <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm">
    <div role="region" aria-label="School mentorship coverage" tabIndex={0}
      className="max-h-[36rem] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-bg-card-alt text-xs uppercase text-text-muted">
          <tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">Grade</th>
            <th className="px-4 py-3">Assigned Mentor</th><th className="px-4 py-3">Current Progress</th>
            <th className="w-36 px-4 py-3"><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody className="divide-y divide-border">{students.map((student) => {
          const href = studentHref(student, link);
          return <tr key={student.studentId} className="hover:bg-hover-bg">
            <td className="px-4 py-3"><StudentIdentity student={student} /></td>
            <td className="px-4 py-3 text-text-secondary">Grade {student.grade}</td>
            <td className="px-4 py-3">{student.ownership
              ? <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
                <UserRound aria-hidden="true" className="h-4 w-4 text-text-muted" />
                {student.ownership.mentorName}
              </span>
              : <span className="font-medium text-warning-text">Unassigned</span>}</td>
            <td className="px-4 py-3"><ProgressBadge state={progress(student)} /></td>
            <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">
              {href && <Link href={href} aria-label={`Open ${student.name}`}
                title="Open Student" className="grid h-10 w-10 place-items-center rounded-lg text-text-muted hover:bg-hover-bg hover:text-accent">
                <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
              </Link>}
              {student.ownership && canManage && <Button type="button" size="sm" variant="danger-ghost"
                aria-label={`Remove Mentor from ${student.name}`} disabled={controlsDisabled}
                onClick={() => onRemove(student)}>Remove</Button>}
              {student.ownership && canManage && <Button type="button" size="sm" variant="secondary"
                aria-label={`Reassign Mentor for ${student.name}`} disabled={controlsDisabled}
                onClick={() => onReassign(student)}>Reassign</Button>}
              {!student.ownership && canManage && <Button type="button" size="sm" variant="secondary"
                aria-label={`Assign ${student.name}`} disabled={controlsDisabled}
                onClick={() => onAssign(student)}>Assign</Button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

function RosterHeader({ canEdit, academicYear }: { canEdit: boolean; academicYear: string }) {
  return <div>
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">Holistic Mentorship</h2>
      <Badge variant="info">{canEdit ? "Mapping management" : "Read-only"}</Badge>
      <HolisticTutorialLink />
    </div>
    <p className="mt-1 text-sm text-text-muted">School assignment coverage for {academicYear}</p>
  </div>;
}

function RosterFilters({ filters, mentorOptions, onChange, onSearchBlur }: {
  filters: CoverageFilters;
  mentorOptions: MentorFilterOption[];
  onChange: (change: Partial<CoverageFilters>) => void;
  onSearchBlur: () => void;
}) {
  const mentorLabel = mentorOptions.find((option) => option.value === filters.mentor)?.label ?? "All Mentors";
  return <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_8rem_minmax(14rem,1.5fr)_11rem]">
    <label className={FILTER_LABEL}>
      Search Student
      <span className="relative mt-1 block">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-text-muted" />
        <Input aria-label="Search Students" value={filters.search} placeholder="Name or Student ID" className="pl-9"
          maxLength={MAX_COVERAGE_SEARCH_LENGTH} onBlur={onSearchBlur}
          onChange={(event) => onChange({ search: event.target.value })} />
      </span>
    </label>
    <label className={FILTER_LABEL}>
      Grade
      <Select aria-label="Filter by Grade" className="mt-1" value={filters.grade}
        onChange={(event) => onChange({ grade: event.target.value as CoverageFilters["grade"] })}>
        <option value="">All Grades</option><option value="11">Grade 11</option><option value="12">Grade 12</option>
      </Select>
    </label>
    <label className={FILTER_LABEL}>
      Mentor
      <Select aria-label="Filter by Mentor" className="mt-1" value={filters.mentor} title={mentorLabel}
        onChange={(event) => onChange({ mentor: event.target.value })}>
        <option value="">All Mentors</option>
        {mentorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </label>
    <label className={FILTER_LABEL}>
      Progress
      <Select aria-label="Filter by Progress" className="mt-1" value={filters.progress}
        onChange={(event) => onChange({ progress: event.target.value as CoverageFilters["progress"] })}>
        {/* Students & Progress's options and order, less Skipped. Skipped is rare
            on the current Phase (only after an Admin re-locks a later Phase);
            this view shows such a Student as Pending. */}
        <option value="">All Students</option><option value="assigned">All Assigned</option>
        <option value="pending">Pending</option><option value="completed">Completed</option>
        <option value="no_active_phase">No active phase</option>
        {/* A Mentor's Students are all assigned, so Unassigned would always be empty. */}
        <option value="unassigned" disabled={filters.mentor !== ""}>
          {filters.mentor ? "Unassigned (clear Mentor first)" : "Unassigned"}
        </option>
      </Select>
    </label>
  </div>;
}

function ShowingCount({ shown, total }: { shown: number; total: number }) {
  return <p role="status" className="text-sm text-text-muted">
    Showing <span className="font-mono font-semibold text-text-primary">{shown}</span> of{" "}
    <span className="font-mono font-semibold text-text-primary">{total}</span> Students
  </p>;
}

function NoMatchingStudents() {
  return <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-border bg-bg-card p-8 text-center">
    <div><Users aria-hidden="true" className="mx-auto h-9 w-9 text-text-muted" />
      <p className="mt-2 text-sm font-bold text-text-primary">No Students match</p>
      <p className="text-sm text-text-muted">Change the search or filters.</p></div>
  </div>;
}

type MentorModalProps = {
  student: Student | null;
  mentors: EligibleMentor[];
  mentorUserId: string;
  reason: string;
  submitting: boolean;
  submitError: string;
  onMentorChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

function MentorSelectField({ label, mentors, value, excludedUserId, onChange }: {
  label: string;
  mentors: EligibleMentor[];
  value: string;
  excludedUserId?: number;
  onChange: (value: string) => void;
}) {
  const options = excludedUserId === undefined
    ? mentors
    : mentors.filter((mentor) => mentor.userId !== excludedUserId);
  return <label className="block text-sm font-bold text-text-primary">
    {label}
    <Select aria-label={label} className="mt-1" value={value}
      onChange={(event) => onChange(event.target.value)}>
      <option value="">Select an eligible Mentor</option>
      {options.map((mentor) => <option key={mentor.userId} value={mentor.userId}>
        {mentor.name}{mentor.email ? ` (${mentor.email})` : ""}
      </option>)}
    </Select>
  </label>;
}

function AuditReasonField({ label, value, placeholder, onChange }: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return <label className="block text-sm font-bold text-text-primary">
    {label}
    <textarea aria-label={label} value={value} rows={4} maxLength={500}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 w-full rounded-lg border-2 border-border bg-bg-card px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      placeholder={placeholder} />
  </label>;
}

function MutationModalFooter({ submitError, submitting, submitDisabled, progressLabel, submitLabel,
  danger = false, onClose, onSubmit }: {
  submitError: string;
  submitting: boolean;
  submitDisabled: boolean;
  progressLabel: string;
  submitLabel: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return <>
    {submitError && <p role="alert" className="text-sm text-danger">{submitError}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
      <Button type="button" variant={danger ? "danger" : undefined} onClick={onSubmit}
        disabled={submitDisabled}>
        {submitting ? progressLabel : submitLabel}
      </Button>
    </div>
  </>;
}

function AssignMentorModal({ student, mentors, mentorUserId, reason, submitting, submitError,
  onMentorChange, onReasonChange, onClose, onSubmit }: MentorModalProps) {
  return <Modal open={student !== null} onClose={submitting ? undefined : onClose}
    role="dialog" aria-modal="true" aria-labelledby="assign-mentor-title">
    <div className="space-y-5 p-6">
      <div>
        <h3 id="assign-mentor-title" className="text-lg font-bold text-text-primary">
          Assign Mentor to {student?.name}
        </h3>
        <p className="mt-1 text-sm text-text-muted">This assignment is recorded in the audit history.</p>
      </div>
      <MentorSelectField label="Mentor" mentors={mentors} value={mentorUserId}
        onChange={onMentorChange} />
      <AuditReasonField label="Audit reason" value={reason}
        placeholder="Why is this Mentor being assigned?" onChange={onReasonChange} />
      <MutationModalFooter submitError={submitError} submitting={submitting}
        submitDisabled={submitting || !mentorUserId || !reason.trim()}
        progressLabel="Assigning…" submitLabel="Assign Mentor" onClose={onClose}
        onSubmit={onSubmit} />
    </div>
  </Modal>;
}

function ReassignMentorModal({ student, mentors, mentorUserId, reason, submitting, submitError,
  onMentorChange, onReasonChange, onClose, onSubmit }: MentorModalProps) {
  return <Modal open={student !== null} onClose={submitting ? undefined : onClose}
    role="dialog" aria-modal="true" aria-labelledby="reassign-mentor-title">
    <div className="space-y-5 p-6">
      <div>
        <h3 id="reassign-mentor-title" className="text-lg font-bold text-text-primary">
          Reassign Mentor for {student?.name}
        </h3>
        <p className="mt-1 text-sm text-text-muted">
          This ends the current Mapping. Submitted Notes remain in the Student&apos;s history.
        </p>
      </div>
      <MentorSelectField label="Replacement Mentor" mentors={mentors} value={mentorUserId}
        excludedUserId={student?.ownership?.mentorUserId} onChange={onMentorChange} />
      <AuditReasonField label="Reassignment reason" value={reason}
        placeholder="Why is this Mentor being reassigned?" onChange={onReasonChange} />
      <MutationModalFooter submitError={submitError} submitting={submitting}
        submitDisabled={submitting || !mentorUserId || !reason.trim()}
        progressLabel="Reassigning…" submitLabel="Reassign Mentor" onClose={onClose}
        onSubmit={onSubmit} />
    </div>
  </Modal>;
}

function RemoveMentorModal({ student, reason, submitting, submitError, onReasonChange,
  onClose, onSubmit }: Omit<MentorModalProps, "mentors" | "mentorUserId" | "onMentorChange">) {
  return <Modal open={student !== null} onClose={submitting ? undefined : onClose}
    role="dialog" aria-modal="true" aria-labelledby="remove-mentor-title">
    <div className="space-y-5 p-6">
      <div>
        <h3 id="remove-mentor-title" className="text-lg font-bold text-text-primary">
          Remove Mentor from {student?.name}
        </h3>
        <p className="mt-1 text-sm text-text-muted">
          This ends the current Mapping. Submitted Notes remain in the Student&apos;s history.
        </p>
      </div>
      <AuditReasonField label="Removal reason" value={reason}
        placeholder="Why is this Mentor being removed?" onChange={onReasonChange} />
      <MutationModalFooter submitError={submitError} submitting={submitting}
        submitDisabled={submitting || !reason.trim()} progressLabel="Removing…"
        submitLabel="Remove Mentor" danger onClose={onClose} onSubmit={onSubmit} />
    </div>
  </Modal>;
}

function filterStudents(students: Student[], filters: CoverageFilters) {
  const query = filters.search.trim().toLowerCase();
  return students.filter((student) =>
    matchesGrade(student, filters.grade) &&
    matchesMentor(student, filters.mentor) &&
    matchesProgress(student, filters.progress) &&
    matchesStudentQuery(student, query)
  );
}

function matchesGrade(student: Student, grade: string) {
  return !grade || String(student.grade) === grade;
}

function matchesMentor(student: Student, mentor: string) {
  return !mentor || String(student.ownership?.mentorUserId) === mentor;
}

function matchesProgress(student: Student, filter: CoverageFilters["progress"]) {
  if (!filter) return true;
  if (filter === "assigned") return student.ownership !== null;
  return progress(student) === filter;
}

function matchesStudentQuery(student: Student, query: string) {
  if (!query) return true;
  return student.name.toLowerCase().includes(query) ||
    (student.externalStudentId ?? "").toLowerCase().includes(query);
}

// With any filter active, the cards describe exactly the rows shown (the same
// set as "Showing N of M"); otherwise the server's whole-School summary.
function coverageSummary(students: Student[], shown: Student[], filters: CoverageFilters,
  summary?: HolisticAssignmentCoverageSummary) {
  if (hasActiveCoverageFilters(filters)) return derivedSummary(shown);
  return summary ?? derivedSummary(students);
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

// Every current Mentor in this roster (read from the rows, so read-only viewers
// get them too), by name, with their assigned-Student count. Mentors sharing a
// name are told apart by email when known, otherwise by user ID, after the count
// so a narrow closed select still shows the name and count.
function mentorFilterOptions(students: Student[], mentors: EligibleMentor[]): MentorFilterOption[] {
  const byId = new Map<number, { name: string; count: number }>();
  for (const { ownership } of students) {
    if (!ownership) continue;
    const count = (byId.get(ownership.mentorUserId)?.count ?? 0) + 1;
    byId.set(ownership.mentorUserId, { name: ownership.mentorName, count });
  }
  const rows = [...byId].map(([userId, entry]) => ({ userId, ...entry }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.userId - b.userId);
  const nameUses = new Map<string, number>();
  for (const row of rows) nameUses.set(nameKey(row.name), (nameUses.get(nameKey(row.name)) ?? 0) + 1);
  const emails = new Map(mentors.map((mentor) => [mentor.userId, mentor.email]));
  return rows.map(({ userId, name, count }) => {
    const shared = (nameUses.get(nameKey(name)) ?? 0) > 1;
    const suffix = shared ? ` · ${emails.get(userId) ?? `ID ${userId}`}` : "";
    return { value: String(userId), label: `${name} (${count})${suffix}` };
  });
}

// A Mentor no longer in the roster reads as All Mentors, and a Mentor rules
// out Unassigned (its Students are all assigned).
function resolveFilters(filters: CoverageFilters, mentorOptions: MentorFilterOption[]): CoverageFilters {
  const mentor = mentorOptions.some((option) => option.value === filters.mentor) ? filters.mentor : "";
  const progressFilter = mentor && filters.progress === "unassigned" ? "" : filters.progress;
  if (mentor === filters.mentor && progressFilter === filters.progress) return filters;
  return { ...filters, mentor, progress: progressFilter };
}

// Rewrites only the `hm_` params, in place: no history entry, no server round
// trip (Next's patched history API updates useSearchParams without a fetch,
// unlike router.replace, which would re-render the roster on the server).
// Every write is skipped unless the browser URL is still this roster's page:
// after leaving it (another Centre, a Program choice screen) the filters
// belong to no one there.
function replaceCoverageUrl(filters: CoverageFilters, page: string) {
  if (livePageKey() !== page) return;
  const url = new URL(window.location.href);
  writeCoverageFilters(url.searchParams, filters);
  if (url.search === new URL(window.location.href).search) return;
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function livePageKey() {
  return coveragePageKey(window.location.pathname, new URLSearchParams(window.location.search));
}

// This roster's page, fixed at mount from the router (usePathname and
// useSearchParams), which already names the new page while an in-app
// navigation renders it; the browser URL changes only after that render.
function useCoveragePage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [page] = useState(() => coveragePageKey(pathname, searchParams));
  return { page, searchParams };
}

// Prefer the live URL when it is this page: a School tab switch can remount
// the roster before useSearchParams has caught up with the filters it wrote on
// unmount. Mid-navigation the live URL is still the previous page's, so use
// useSearchParams.
function initialCoverageFilters(searchParams: URLSearchParams, page: string) {
  const live = typeof window !== "undefined" && livePageKey() === page;
  return readCoverageFilters(live ? new URLSearchParams(window.location.search) : searchParams);
}

// On unmount (a School tab switch), write any pending change, if the URL is
// still this page.
function useWriteOnUnmount(filters: CoverageFilters, page: string) {
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);
  useEffect(() => {
    const pending = latest;
    return () => replaceCoverageUrl(pending.current, page);
  }, [page]);
}

// `refreshing` holds every URL write while a roster refresh is in flight: Next
// treats a history.replaceState as a navigation-priority "restore", which
// discards a pending router.refresh(), leaving the old roster on screen. The
// held write goes out once the refresh lands.
function useCoverageFilters(students: Student[], mentors: EligibleMentor[], refreshing: boolean) {
  const { page, searchParams } = useCoveragePage();
  const [selected, setSelected] = useState(() => initialCoverageFilters(searchParams, page));
  const mentorOptions = useMemo(() => mentorFilterOptions(students, mentors), [students, mentors]);
  const filters = useMemo(() => resolveFilters(selected, mentorOptions), [selected, mentorOptions]);
  // Forget a value the roster dropped (a Mentor who lost their last Student),
  // so it can't come back on its own if that Mentor is assigned again.
  if (filters !== selected) setSelected(filters);
  useEffect(() => {
    if (refreshing) return;
    const timer = window.setTimeout(() => replaceCoverageUrl(filters, page), URL_WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [filters, page, refreshing]);
  useWriteOnUnmount(filters, page);
  return {
    filters,
    mentorOptions,
    // Only typing waits for a pause; a dropdown pick is written at once, so a
    // quick link click or tab switch after it can't race the delayed write.
    update: (change: Partial<CoverageFilters>) => {
      const next = resolveFilters({ ...filters, ...change }, mentorOptions);
      setSelected(next);
      if (!("search" in change) && !refreshing) replaceCoverageUrl(next, page);
    },
    writeUrl: () => {
      if (!refreshing) replaceCoverageUrl(filters, page);
    },
  };
}

async function requestMappingMutation(
  method: "POST" | "PATCH" | "DELETE",
  payload: Record<string, unknown>,
  fallbackError: string,
) {
  const response = await fetch("/api/holistic-mentorship/mappings", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || fallbackError);
}

function useMappingDialogs({ schoolCode, programId, academicYear, canEdit, students }: {
  schoolCode: string;
  programId: number;
  academicYear: string;
  canEdit: boolean;
  students: Student[];
}) {
  const router = useRouter();
  const [assigning, setAssigning] = useState<Student | null>(null);
  const [reassigning, setReassigning] = useState<Student | null>(null);
  const [removing, setRemoving] = useState<Student | null>(null);
  const [mentorUserId, setMentorUserId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [staleStudents, setStaleStudents] = useState<Student[] | null>(null);
  // A transition, so `refreshing` stays true until the refreshed roster lands.
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const resetFields = () => {
    setMentorUserId("");
    setReason("");
    setSubmitError("");
  };
  const closeAssign = () => {
    setAssigning(null);
    resetFields();
  };
  const closeRemove = () => {
    setRemoving(null);
    resetFields();
  };
  const closeReassign = () => {
    setReassigning(null);
    resetFields();
  };
  const submitAssign = async () => {
    if (!assigning || !mentorUserId || !reason.trim() || !canEdit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await requestMappingMutation("POST", {
        school_code: schoolCode,
        program_id: programId,
        academic_year: academicYear,
        student_id: assigning.studentId,
        mentor_user_id: Number(mentorUserId),
        expected_mapping_id: null,
        confirmed: true,
        reason: reason.trim(),
      }, "Unable to assign Mentor");
      closeAssign();
      refresh();
    } catch (problem) {
      setSubmitError(problem instanceof Error ? problem.message : "Unable to assign Mentor");
    } finally {
      setSubmitting(false);
    }
  };
  const submitReassign = async () => {
    if (!reassigning?.ownership || !mentorUserId || !reason.trim() || !canEdit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await requestMappingMutation("PATCH", {
        school_code: schoolCode,
        program_id: programId,
        academic_year: academicYear,
        student_id: reassigning.studentId,
        mentor_user_id: Number(mentorUserId),
        expected_mapping_id: reassigning.ownership.mappingId,
        confirmed: true,
        reason: reason.trim(),
      }, "Unable to reassign Mentor");
      setStaleStudents(students);
      closeReassign();
      refresh();
    } catch (problem) {
      setSubmitError(problem instanceof Error ? problem.message : "Unable to reassign Mentor");
    } finally {
      setSubmitting(false);
    }
  };
  const submitRemove = async () => {
    if (!removing?.ownership || !reason.trim() || !canEdit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await requestMappingMutation("DELETE", {
        school_code: schoolCode,
        program_id: programId,
        academic_year: academicYear,
        student_id: removing.studentId,
        expected_mapping_id: removing.ownership.mappingId,
        confirmed: true,
        reason: reason.trim(),
      }, "Unable to remove Mentor");
      closeRemove();
      refresh();
    } catch (problem) {
      setSubmitError(problem instanceof Error ? problem.message : "Unable to remove Mentor");
    } finally {
      setSubmitting(false);
    }
  };
  return {
    assigning, reassigning, removing, mentorUserId, reason, submitting, submitError,
    rosterStale: staleStudents === students,
    refreshing,
    setAssigning, setReassigning, setRemoving, setMentorUserId, setReason,
    closeAssign, closeReassign, closeRemove, submitAssign, submitReassign, submitRemove,
  };
}

function canManageMappings(role: string | undefined, academicYear: string) {
  const adminRole = role === "admin" || role === "holistic_mentorship_admin";
  return adminRole && academicYear === CURRENT_ACADEMIC_YEAR;
}

function CoverageResults({ students, link, canManage, controlsDisabled,
  onAssign, onReassign, onRemove }: CoverageTableProps) {
  if (students.length === 0) return <NoMatchingStudents />;
  return <CoverageTable students={students} link={link}
    canManage={canManage} controlsDisabled={controlsDisabled} onAssign={onAssign}
    onReassign={onReassign} onRemove={onRemove} />;
}

function MappingDialogs({ dialogs, mentors }: {
  dialogs: ReturnType<typeof useMappingDialogs>;
  mentors: EligibleMentor[];
}) {
  return <>
    <AssignMentorModal student={dialogs.assigning} mentors={mentors}
      mentorUserId={dialogs.mentorUserId} reason={dialogs.reason} submitting={dialogs.submitting}
      submitError={dialogs.submitError} onMentorChange={dialogs.setMentorUserId}
      onReasonChange={dialogs.setReason} onClose={dialogs.closeAssign}
      onSubmit={() => void dialogs.submitAssign()} />
    <ReassignMentorModal student={dialogs.reassigning} mentors={mentors}
      mentorUserId={dialogs.mentorUserId} reason={dialogs.reason} submitting={dialogs.submitting}
      submitError={dialogs.submitError} onMentorChange={dialogs.setMentorUserId}
      onReasonChange={dialogs.setReason} onClose={dialogs.closeReassign}
      onSubmit={() => void dialogs.submitReassign()} />
    <RemoveMentorModal student={dialogs.removing} reason={dialogs.reason}
      submitting={dialogs.submitting} submitError={dialogs.submitError}
      onReasonChange={dialogs.setReason} onClose={dialogs.closeRemove}
      onSubmit={() => void dialogs.submitRemove()} />
  </>;
}

export default function AdminSchoolRoster({
  fromHolisticProgress = false,
  centreId,
  students,
  schoolCode,
  programId = PROGRAM_IDS.COE,
  academicYear = CURRENT_ACADEMIC_YEAR,
  role,
  canEdit = true,
  mentors = NO_MENTORS,
  summary,
}: {
  students: Student[];
  schoolCode: string;
  /** Set on a Centre page, so a Student's back link returns to that Centre. */
  centreId?: number;
  programId?: number;
  academicYear?: string;
  role?: string;
  canEdit?: boolean;
  mentors?: EligibleMentor[];
  summary?: HolisticAssignmentCoverageSummary;
  fromHolisticProgress?: boolean;
}) {
  const dialogs = useMappingDialogs({ schoolCode, programId, academicYear, canEdit, students });
  const coverage = useCoverageFilters(students, mentors, dialogs.refreshing);
  const canManage = canManageMappings(role, academicYear);
  const shown = useMemo(() => filterStudents(students, coverage.filters), [coverage.filters, students]);
  const link = {
    schoolCode, programId, fromHolisticProgress,
    returnQuery: coverageReturnFor(coverage.filters, centreId),
  };

  // Clicking a Student (or anything else here) writes a pending search to the
  // URL first, so browser Back returns to it.
  return <section className="min-w-0 max-w-full space-y-5" onClickCapture={coverage.writeUrl}>
    <RosterHeader canEdit={canEdit} academicYear={academicYear} />
    <Summary summary={coverageSummary(students, shown, coverage.filters, summary)} />
    <RosterFilters filters={coverage.filters} mentorOptions={coverage.mentorOptions}
      onChange={coverage.update} onSearchBlur={coverage.writeUrl} />
    <ShowingCount shown={shown.length} total={students.length} />
    <CoverageResults students={shown} link={link}
      canManage={canManage} controlsDisabled={!canEdit || dialogs.submitting || dialogs.rosterStale}
      onAssign={dialogs.setAssigning} onReassign={dialogs.setReassigning}
      onRemove={dialogs.setRemoving} />
    <MappingDialogs dialogs={dialogs} mentors={mentors} />
  </section>;
}
