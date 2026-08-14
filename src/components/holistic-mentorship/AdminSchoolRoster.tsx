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
  if (!student.ownership || !student.activePhaseId) return null;
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

function CoverageTable({ students, schoolCode, programId, canManage, controlsDisabled, onAssign, onRemove }: {
  students: Student[];
  schoolCode: string;
  programId: number;
  canManage: boolean;
  controlsDisabled: boolean;
  onAssign: (student: Student) => void;
  onRemove: (student: Student) => void;
}) {
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
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("");
  const [assignment, setAssignment] = useState<AssignmentFilter>("all");
  const [assigning, setAssigning] = useState<Student | null>(null);
  const [removing, setRemoving] = useState<Student | null>(null);
  const [mentorUserId, setMentorUserId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const canManage = (role === "admin" || role === "holistic_mentorship_admin") &&
    academicYear === CURRENT_ACADEMIC_YEAR;
  const shown = useMemo(
    () => filterStudents(students, search, grade, assignment),
    [assignment, grade, search, students]
  );

  const closeAssign = () => {
    setAssigning(null);
    setMentorUserId("");
    setReason("");
    setSubmitError("");
  };
  const submitAssign = async () => {
    if (!assigning || !mentorUserId || !reason.trim() || !canEdit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/holistic-mentorship/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: schoolCode,
          program_id: programId,
          academic_year: academicYear,
          student_id: assigning.studentId,
          mentor_user_id: Number(mentorUserId),
          expected_mapping_id: null,
          confirmed: true,
          reason: reason.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to assign Mentor");
      closeAssign();
      router.refresh();
    } catch (problem) {
      setSubmitError(problem instanceof Error ? problem.message : "Unable to assign Mentor");
    } finally {
      setSubmitting(false);
    }
  };
  const closeRemove = () => {
    setRemoving(null);
    setReason("");
    setSubmitError("");
  };
  const submitRemove = async () => {
    if (!removing?.ownership || !reason.trim() || !canEdit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/holistic-mentorship/mappings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: schoolCode,
          program_id: programId,
          academic_year: academicYear,
          student_id: removing.studentId,
          expected_mapping_id: removing.ownership.mappingId,
          confirmed: true,
          reason: reason.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to remove Mentor");
      closeRemove();
      router.refresh();
    } catch (problem) {
      setSubmitError(problem instanceof Error ? problem.message : "Unable to remove Mentor");
    } finally {
      setSubmitting(false);
    }
  };

  return <section className="min-w-0 max-w-full space-y-5">
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">Holistic Mentorship</h2>
        <Badge variant="info">{canEdit ? "Mapping management" : "Read-only"}</Badge>
        <HolisticTutorialLink />
      </div>
      <p className="mt-1 text-sm text-text-muted">School assignment coverage for {academicYear}</p>
    </div>
    <Summary summary={summary ?? derivedSummary(students)} />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_12rem]">
      <label className="block text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
        Search Student
        <span className="relative mt-1 block">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-text-muted" />
          <Input aria-label="Search Students" value={search} placeholder="Name or Student ID" className="pl-9"
            onChange={(event) => setSearch(event.target.value)} />
        </span>
      </label>
      <label className="block text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
        Grade
        <Select aria-label="Filter by Grade" className="mt-1 w-full" value={grade}
          onChange={(event) => setGrade(event.target.value)}>
          <option value="">All Grades</option><option value="11">Grade 11</option><option value="12">Grade 12</option>
        </Select>
      </label>
      <label className="block text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
        Assignment
        <Select aria-label="Filter by Assignment" className="mt-1 w-full" value={assignment}
          onChange={(event) => setAssignment(event.target.value as AssignmentFilter)}>
          <option value="all">All Students</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option>
        </Select>
      </label>
    </div>
    {shown.length ? <CoverageTable
      students={shown}
      schoolCode={schoolCode}
      programId={programId}
      canManage={canManage}
      controlsDisabled={!canEdit}
      onAssign={setAssigning}
      onRemove={setRemoving}
    />
      : <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-border bg-bg-card p-8 text-center">
        <div><Users aria-hidden="true" className="mx-auto h-9 w-9 text-text-muted" />
          <p className="mt-2 text-sm font-bold text-text-primary">No Students match</p>
          <p className="text-sm text-text-muted">Change the search or filters.</p></div>
      </div>}
    <div className="sr-only" role="status">Showing {shown.length} of {students.length} Students</div>
    <Modal open={assigning !== null} onClose={submitting ? undefined : closeAssign}
      role="dialog" aria-modal="true" aria-labelledby="assign-mentor-title">
      <div className="space-y-5 p-6">
        <div>
          <h3 id="assign-mentor-title" className="text-lg font-bold text-text-primary">
            Assign Mentor to {assigning?.name}
          </h3>
          <p className="mt-1 text-sm text-text-muted">This assignment is recorded in the audit history.</p>
        </div>
        <label className="block text-sm font-bold text-text-primary">
          Mentor
          <Select aria-label="Mentor" className="mt-1 w-full" value={mentorUserId}
            onChange={(event) => setMentorUserId(event.target.value)}>
            <option value="">Select an eligible Mentor</option>
            {mentors.map((mentor) => <option key={mentor.userId} value={mentor.userId}>
              {mentor.name}{mentor.email ? ` (${mentor.email})` : ""}
            </option>)}
          </Select>
        </label>
        <label className="block text-sm font-bold text-text-primary">
          Audit reason
          <textarea aria-label="Audit reason" value={reason} rows={4} maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded-lg border-2 border-border bg-bg-card px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            placeholder="Why is this Mentor being assigned?" />
        </label>
        {submitError && <p role="alert" className="text-sm text-danger">{submitError}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={closeAssign} disabled={submitting}>Cancel</Button>
          <Button type="button" onClick={() => void submitAssign()}
            disabled={submitting || !mentorUserId || !reason.trim()}>
            {submitting ? "Assigning…" : "Assign Mentor"}
          </Button>
        </div>
      </div>
    </Modal>
    <Modal open={removing !== null} onClose={submitting ? undefined : closeRemove}
      role="dialog" aria-modal="true" aria-labelledby="remove-mentor-title">
      <div className="space-y-5 p-6">
        <div>
          <h3 id="remove-mentor-title" className="text-lg font-bold text-text-primary">
            Remove Mentor from {removing?.name}
          </h3>
          <p className="mt-1 text-sm text-text-muted">
            This ends the current Mapping. Submitted Notes remain in the Student&apos;s history.
          </p>
        </div>
        <label className="block text-sm font-bold text-text-primary">
          Removal reason
          <textarea aria-label="Removal reason" value={reason} rows={4} maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded-lg border-2 border-border bg-bg-card px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            placeholder="Why is this Mentor being removed?" />
        </label>
        {submitError && <p role="alert" className="text-sm text-danger">{submitError}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={closeRemove} disabled={submitting}>Cancel</Button>
          <Button type="button" variant="danger" onClick={() => void submitRemove()}
            disabled={submitting || !reason.trim()}>
            {submitting ? "Removing…" : "Remove Mentor"}
          </Button>
        </div>
      </div>
    </Modal>
  </section>;
}
