"use client";

import { ArrowUpRight, Search, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge, Button, Input, Modal, Select } from "@/components/ui";
import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "@/lib/constants";
import type {
  HolisticAssignmentCoverageSummary,
  HolisticAssignmentRosterStudent as Student,
} from "@/lib/holistic-mappings";
import HolisticTutorialLink from "./HolisticTutorialLink";
import StudentIdentity from "./StudentIdentity";

type AssignmentFilter = "all" | "assigned" | "unassigned";
type Progress = "completed" | "pending" | "none";
type EligibleMentor = { userId: number; name: string; email: string | null };

const PROGRESS_LABEL: Record<Progress, string> = {
  completed: "Completed",
  pending: "Pending",
  none: "No active phase",
};

const PROGRESS_CLASSES: Record<Progress, string> = {
  completed: "bg-success-bg text-success",
  pending: "border border-border bg-bg-card-alt text-text-muted",
  none: "border border-border bg-bg-card-alt text-text-muted",
};

function progress(student: Student): Progress {
  if (student.activePhaseId === null) return "none";
  if (student.activeNotesState === "submitted") return "completed";
  return "pending";
}

function studentHref(student: Student, schoolCode: string, programId: number) {
  if (!student.activePhaseId) return null;
  const params = new URLSearchParams({
    school_code: schoolCode,
    academic_year: CURRENT_ACADEMIC_YEAR,
    program_id: String(programId),
    source: "school",
  });
  return `/holistic-mentorship/students/${student.studentId}/phases/${student.activePhaseId}?${params}`;
}

function derivedSummary(students: Student[]): HolisticAssignmentCoverageSummary {
  const assigned = students.filter((student) => student.ownership).length;
  const mentors = new Set(students.flatMap((student) =>
    student.ownership ? [student.ownership.mentorUserId] : [])).size;
  return {
    eligible: students.length,
    assigned,
    unassigned: students.length - assigned,
    activeMentors: mentors,
    coveragePercentage: students.length ? Math.round((assigned / students.length) * 100) : 0,
    completed: students.filter((student) => progress(student) === "completed").length,
    pending: students.filter((student) => progress(student) === "pending").length,
    noActivePhase: students.filter((student) => progress(student) === "none").length,
  };
}

function Summary({ summary }: { summary: HolisticAssignmentCoverageSummary }) {
  const metrics = [
    ["Eligible Students", summary.eligible],
    ["Assigned", summary.assigned],
    ["Unassigned", summary.unassigned],
    ["Active Mentors", summary.activeMentors],
    ["Coverage", `${summary.coveragePercentage}%`],
    ["Completed", summary.completed],
    ["Pending", summary.pending],
    ["No active Phase", summary.noActivePhase],
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
  schoolCode: string;
  programId: number;
  canManage: boolean;
  controlsDisabled: boolean;
  onAssign: (student: Student) => void;
  onReassign: (student: Student) => void;
  onRemove: (student: Student) => void;
};

function CoverageTable({ students, schoolCode, programId, canManage, controlsDisabled,
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
          const href = studentHref(student, schoolCode, programId);
          const state = progress(student);
          return <tr key={student.studentId} className="hover:bg-hover-bg">
            <td className="px-4 py-3"><StudentIdentity student={student} /></td>
            <td className="px-4 py-3 text-text-secondary">Grade {student.grade}</td>
            <td className="px-4 py-3">{student.ownership
              ? <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
                <UserRound aria-hidden="true" className="h-4 w-4 text-text-muted" />
                {student.ownership.mentorName}
              </span>
              : <span className="font-medium text-warning-text">Unassigned</span>}</td>
            <td className="px-4 py-3"><span
              className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${PROGRESS_CLASSES[state]}`}>
              {PROGRESS_LABEL[state]}
            </span></td>
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

function RosterFilters({ search, grade, assignment, onSearchChange, onGradeChange,
  onAssignmentChange }: {
  search: string;
  grade: string;
  assignment: AssignmentFilter;
  onSearchChange: (value: string) => void;
  onGradeChange: (value: string) => void;
  onAssignmentChange: (value: AssignmentFilter) => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_12rem]">
    <label className="block text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
      Search Student
      <span className="relative mt-1 block">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-text-muted" />
        <Input aria-label="Search Students" value={search} placeholder="Name or Student ID" className="pl-9"
          onChange={(event) => onSearchChange(event.target.value)} />
      </span>
    </label>
    <label className="block text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
      Grade
      <Select aria-label="Filter by Grade" className="mt-1 w-full" value={grade}
        onChange={(event) => onGradeChange(event.target.value)}>
        <option value="">All Grades</option><option value="11">Grade 11</option><option value="12">Grade 12</option>
      </Select>
    </label>
    <label className="block text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
      Assignment
      <Select aria-label="Filter by Assignment" className="mt-1 w-full" value={assignment}
        onChange={(event) => onAssignmentChange(event.target.value as AssignmentFilter)}>
        <option value="all">All Students</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option>
      </Select>
    </label>
  </div>;
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
    <Select aria-label={label} className="mt-1 w-full" value={value}
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

function filterStudents(
  students: Student[],
  search: string,
  grade: string,
  assignment: AssignmentFilter
) {
  const query = search.trim().toLowerCase();
  return students.filter((student) =>
    matchesGrade(student, grade) &&
    matchesAssignment(student, assignment) &&
    matchesStudentQuery(student, query)
  );
}

function matchesGrade(student: Student, grade: string) {
  return !grade || String(student.grade) === grade;
}

function matchesAssignment(student: Student, assignment: AssignmentFilter) {
  if (assignment === "assigned") return student.ownership !== null;
  if (assignment === "unassigned") return student.ownership === null;
  return true;
}

function matchesStudentQuery(student: Student, query: string) {
  if (!query) return true;
  return student.name.toLowerCase().includes(query) ||
    (student.externalStudentId ?? "").toLowerCase().includes(query);
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
      router.refresh();
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
      router.refresh();
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
      router.refresh();
    } catch (problem) {
      setSubmitError(problem instanceof Error ? problem.message : "Unable to remove Mentor");
    } finally {
      setSubmitting(false);
    }
  };
  return {
    assigning, reassigning, removing, mentorUserId, reason, submitting, submitError,
    rosterStale: staleStudents === students,
    setAssigning, setReassigning, setRemoving, setMentorUserId, setReason,
    closeAssign, closeReassign, closeRemove, submitAssign, submitReassign, submitRemove,
  };
}

function canManageMappings(role: string | undefined, academicYear: string) {
  const adminRole = role === "admin" || role === "holistic_mentorship_admin";
  return adminRole && academicYear === CURRENT_ACADEMIC_YEAR;
}

function CoverageResults({ students, schoolCode, programId, canManage, controlsDisabled,
  onAssign, onReassign, onRemove }: CoverageTableProps) {
  if (students.length === 0) return <NoMatchingStudents />;
  return <CoverageTable students={students} schoolCode={schoolCode} programId={programId}
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
  students,
  schoolCode,
  programId = PROGRAM_IDS.COE,
  academicYear = CURRENT_ACADEMIC_YEAR,
  role,
  canEdit = true,
  mentors = [],
  summary,
}: {
  students: Student[];
  schoolCode: string;
  programId?: number;
  academicYear?: string;
  role?: string;
  canEdit?: boolean;
  mentors?: EligibleMentor[];
  summary?: HolisticAssignmentCoverageSummary;
}) {
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("");
  const [assignment, setAssignment] = useState<AssignmentFilter>("all");
  const dialogs = useMappingDialogs({ schoolCode, programId, academicYear, canEdit, students });
  const canManage = canManageMappings(role, academicYear);
  const shown = useMemo(
    () => filterStudents(students, search, grade, assignment),
    [assignment, grade, students, search]
  );

  return <section className="min-w-0 max-w-full space-y-5">
    <RosterHeader canEdit={canEdit} academicYear={academicYear} />
    <Summary summary={summary ?? derivedSummary(students)} />
    <RosterFilters search={search} grade={grade} assignment={assignment}
      onSearchChange={setSearch} onGradeChange={setGrade} onAssignmentChange={setAssignment} />
    <CoverageResults students={shown} schoolCode={schoolCode} programId={programId}
      canManage={canManage} controlsDisabled={!canEdit || dialogs.submitting || dialogs.rosterStale}
      onAssign={dialogs.setAssigning} onReassign={dialogs.setReassigning}
      onRemove={dialogs.setRemoving} />
    <div className="sr-only" role="status">Showing {shown.length} of {students.length} Students</div>
    <MappingDialogs dialogs={dialogs} mentors={mentors} />
  </section>;
}
