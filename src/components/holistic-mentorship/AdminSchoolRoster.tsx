"use client";

import { ArrowUpRight, Search, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge, Input, Select } from "@/components/ui";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import type { HolisticAssignmentRosterStudent as Student } from "@/lib/holistic-mappings";

type AssignmentFilter = "all" | "assigned" | "unassigned";
type Progress = "completed" | "draft" | "pending" | "none" | "unassigned";

const PROGRESS_LABEL: Record<Progress, string> = {
  completed: "Completed",
  draft: "Draft saved",
  pending: "Pending",
  none: "No active phase",
  unassigned: "Not assigned",
};

const PROGRESS_CLASSES: Record<Progress, string> = {
  completed: "bg-success-bg text-success",
  draft: "bg-brand-blue-bg text-text-secondary",
  pending: "border border-border bg-bg-card-alt text-text-muted",
  none: "border border-border bg-bg-card-alt text-text-muted",
  unassigned: "border border-border bg-bg-card-alt text-text-muted",
};

function progress(student: Student): Progress {
  if (!student.ownership) return "unassigned";
  if (student.activePhaseId === null) return "none";
  if (student.activeNotesState === "submitted") return "completed";
  if (student.activeNotesState === "draft") return "draft";
  return "pending";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("");
}

function studentHref(student: Student, schoolCode: string) {
  if (!student.ownership || !student.activePhaseId) return null;
  const params = new URLSearchParams({
    school_code: schoolCode,
    academic_year: CURRENT_ACADEMIC_YEAR,
    source: "school",
  });
  return `/holistic-mentorship/students/${student.studentId}/phases/${student.activePhaseId}?${params}`;
}

function Summary({ students }: { students: Student[] }) {
  const assigned = students.filter((student) => student.ownership).length;
  const mentors = new Set(students.flatMap((student) =>
    student.ownership ? [student.ownership.mentorUserId] : [])).size;
  const metrics = [
    ["Eligible Students", students.length],
    ["Assigned", assigned],
    ["Unassigned", students.length - assigned],
    ["Active Mentors", mentors],
    ["Coverage", students.length ? `${Math.round((assigned / students.length) * 100)}%` : "0%"],
  ];
  return <div className="grid grid-cols-2 border-y border-border bg-bg-card sm:grid-cols-5">
    {metrics.map(([label, value]) => <div key={label}
      className="border-b border-border px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="font-mono text-xl font-bold text-text-primary">{value}</div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
    </div>)}
  </div>;
}

function StudentIdentity({ student }: { student: Student }) {
  return <span className="flex min-w-0 items-center gap-2.5">
    <span aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-info-bg text-xs font-extrabold text-info">
      {initials(student.name)}
    </span>
    <span className="min-w-0">
      <span className="block font-semibold text-text-primary">{student.name}</span>
      {student.externalStudentId &&
        <span className="block font-mono text-xs text-text-muted">{student.externalStudentId}</span>}
    </span>
  </span>;
}

function CoverageTable({ students, schoolCode }: { students: Student[]; schoolCode: string }) {
  return <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm">
    <div role="region" aria-label="School mentorship coverage" tabIndex={0}
      className="max-h-[36rem] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-bg-card-alt text-xs uppercase text-text-muted">
          <tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">Grade</th>
            <th className="px-4 py-3">Assigned Mentor</th><th className="px-4 py-3">Current Progress</th>
            <th className="w-16 px-4 py-3"><span className="sr-only">Open</span></th></tr>
        </thead>
        <tbody className="divide-y divide-border">{students.map((student) => {
          const href = studentHref(student, schoolCode);
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
            <td className="px-4 py-3">{href && <Link href={href} aria-label={`Open ${student.name}`}
              title="Open Student" className="grid h-10 w-10 place-items-center rounded-lg text-text-muted hover:bg-hover-bg hover:text-accent">
              <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
            </Link>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

export default function AdminSchoolRoster({ students, schoolCode }: {
  students: Student[];
  schoolCode: string;
}) {
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("");
  const [assignment, setAssignment] = useState<AssignmentFilter>("all");
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return students.filter((student) => {
      if (grade && String(student.grade) !== grade) return false;
      if (assignment === "assigned" && !student.ownership) return false;
      if (assignment === "unassigned" && student.ownership) return false;
      return !query || student.name.toLowerCase().includes(query) ||
        (student.externalStudentId ?? "").toLowerCase().includes(query);
    });
  }, [assignment, grade, search, students]);

  return <section className="min-w-0 max-w-full space-y-5">
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">Holistic Mentorship</h2>
        <Badge variant="info">Read-only</Badge>
      </div>
      <p className="mt-1 text-sm text-text-muted">School assignment coverage for {CURRENT_ACADEMIC_YEAR}</p>
    </div>
    <Summary students={students} />
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
    {shown.length ? <CoverageTable students={shown} schoolCode={schoolCode} />
      : <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-border bg-bg-card p-8 text-center">
        <div><Users aria-hidden="true" className="mx-auto h-9 w-9 text-text-muted" />
          <p className="mt-2 text-sm font-bold text-text-primary">No Students match</p>
          <p className="text-sm text-text-muted">Change the search or filters.</p></div>
      </div>}
    <div className="sr-only" role="status">Showing {shown.length} of {students.length} Students</div>
  </section>;
}
