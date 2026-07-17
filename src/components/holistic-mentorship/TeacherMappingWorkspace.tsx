"use client";

import { ArrowRight, Search, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

interface Student {
  studentId: number;
  name: string;
  externalStudentId: string | null;
  grade: number;
  activePhaseId: number | null;
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
}

const EMPTY_FILTERS: SavedFilters = { search: "", grade: "", assignment: "" };

function savedGrade(value: unknown): SavedFilters["grade"] {
  return value === "11" || value === "12" ? value : "";
}

function savedAssignment(value: unknown): SavedFilters["assignment"] {
  return value === "unassigned" || value === "other" ? value : "";
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
    };
  } catch {
    return EMPTY_FILTERS;
  }
}

function studentsForView(
  students: Student[],
  view: "assign" | "mentees",
  actorUserId: number | null,
  assignment: SavedFilters["assignment"]
) {
  if (view === "mentees") {
    return students.filter((student) => student.ownership?.mentorUserId === actorUserId);
  }
  return students.filter((student) => {
    if (student.ownership?.mentorUserId === actorUserId) return false;
    if (assignment === "unassigned") return student.ownership === null;
    if (assignment === "other") return student.ownership !== null;
    return true;
  });
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
  view,
  canEdit = true,
}: {
  schoolCode: string;
  view: "assign" | "mentees";
  canEdit?: boolean;
}) {
  const [filters, setFilters] = useState(() => savedFilters(schoolCode));
  const { search, grade, assignment } = filters;
  const [students, setStudents] = useState<Student[]>([]);
  const [actorUserId, setActorUserId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setSuccess("");
    let loaded = false;
    const params = new URLSearchParams({
      school_code: schoolCode,
      academic_year: CURRENT_ACADEMIC_YEAR,
      search,
    });
    if (grade) params.set("grade", grade);
    try {
      const response = await fetch(`/api/holistic-mentorship/mappings?${params}`, { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load Students");
      setStudents(data.students);
      setActorUserId(data.actorUserId);
      setSelected([]);
      setMessage("");
      loaded = true;
    } catch (error) {
      if ((error as Error).name !== "AbortError") setMessage((error as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
    return loaded;
  }, [grade, schoolCode, search]);

  useEffect(() => {
    sessionStorage.setItem(
      `holistic-mappings:${schoolCode}`,
      JSON.stringify({ search, grade, assignment })
    );
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [assignment, grade, load, schoolCode, search]);

  useEffect(() => setSelected([]), [view]);

  useEffect(() => {
    const key = `holistic-mappings-scroll:${schoolCode}`;
    const saved = Number(sessionStorage.getItem(key));
    if (Number.isFinite(saved) && saved > 0) window.scrollTo({ top: saved });
    const remember = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [schoolCode]);

  const visible = studentsForView(students, view, actorUserId, assignment);

  const toggle = (studentId: number) => {
    setSelected((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  };

  const changeFilter = (updates: Partial<SavedFilters>) => {
    setSelected([]);
    setFilters((current) => ({ ...current, ...updates }));
  };

  const assign = async () => {
    const choices = visible.filter((student) => selected.includes(student.studentId));
    const reassigned = choices.filter(
      (student) => student.ownership && student.ownership.mentorUserId !== actorUserId
    );
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
    <div className="space-y-4">
      <MappingFilters
        search={search}
        grade={grade}
        assignment={assignment}
        view={view}
        onSearchChange={(search) => changeFilter({ search })}
        onGradeChange={(grade) => changeFilter({ grade })}
        onAssignmentChange={(assignment) => changeFilter({ assignment })}
      />
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      {success && <p role="status" className="text-sm text-success">{success}</p>}
      <MappingResults
        loading={loading}
        students={visible}
        view={view}
        canEdit={canEdit}
        actorUserId={actorUserId}
        selected={selected}
        busy={busy}
        schoolCode={schoolCode}
        onToggle={toggle}
        onRemove={remove}
      />
      <AssignSelectedButton
        view={view}
        canEdit={canEdit}
        selectedCount={selected.length}
        busy={busy}
        onAssign={assign}
      />
    </div>
  );
}

function MappingFilters({ search, grade, assignment, view, onSearchChange, onGradeChange, onAssignmentChange }: {
  search: string;
  grade: SavedFilters["grade"];
  assignment: SavedFilters["assignment"];
  view: "assign" | "mentees";
  onSearchChange: (value: string) => void;
  onGradeChange: (value: SavedFilters["grade"]) => void;
  onAssignmentChange: (value: SavedFilters["assignment"]) => void;
}) {
  return <div className="flex flex-col gap-3 sm:flex-row">
    <label className="relative min-w-0 flex-1">
      <span className="sr-only">Search Students</span>
      <Search aria-hidden="true" className="absolute left-3 top-3 h-5 w-5 text-text-muted" />
      <input className="min-h-11 w-full rounded-md border border-border bg-bg pl-10 pr-3 text-sm"
        value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search by Student name or ID" />
    </label>
    <select aria-label="Filter by Grade" className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm"
      value={grade} onChange={(event) => onGradeChange(event.target.value as SavedFilters["grade"])}>
      <option value="">All Grades</option><option value="11">Grade 11</option><option value="12">Grade 12</option>
    </select>
    {view === "assign" && <select aria-label="Filter by Assignment" className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm"
      value={assignment} onChange={(event) => onAssignmentChange(event.target.value as SavedFilters["assignment"])}>
      <option value="">All available</option><option value="unassigned">Unassigned</option>
      <option value="other">Assigned to another Mentor</option>
    </select>}
  </div>;
}

function MappingResults({ loading, students, view, canEdit, actorUserId, selected, busy, schoolCode, onToggle, onRemove }: {
  loading: boolean;
  students: Student[];
  view: "assign" | "mentees";
  canEdit: boolean;
  actorUserId: number | null;
  selected: number[];
  busy: boolean;
  schoolCode: string;
  onToggle: (studentId: number) => void;
  onRemove: (student: Student) => Promise<void>;
}) {
  if (loading) return <p className="py-12 text-center text-sm text-text-muted">Loading Students...</p>;
  if (students.length === 0) {
    return <p className="py-12 text-center text-sm font-medium text-text-muted">
      {view === "assign" ? "No eligible Students to show yet." : "No Mentees assigned yet."}
    </p>;
  }
  return <MappingTable students={students} view={view} canEdit={canEdit} actorUserId={actorUserId} selected={selected}
    busy={busy} schoolCode={schoolCode} onToggle={onToggle} onRemove={onRemove} />;
}

function MappingTable({ students, view, canEdit, actorUserId, selected, busy, schoolCode, onToggle, onRemove }: {
  students: Student[];
  view: "assign" | "mentees";
  canEdit: boolean;
  actorUserId: number | null;
  selected: number[];
  busy: boolean;
  schoolCode: string;
  onToggle: (studentId: number) => void;
  onRemove: (student: Student) => Promise<void>;
}) {
  return <div className="overflow-x-auto border-y border-border">
    <table className="w-full min-w-[640px] text-left text-sm">
      <thead className="bg-bg-card-alt text-xs uppercase text-text-muted"><tr>
        {view === "assign" && canEdit && <th className="w-12 px-3 py-3"><span className="sr-only">Select</span></th>}
        <th className="px-3 py-3">Student</th><th className="px-3 py-3">Grade</th><th className="px-3 py-3">Current Mentor</th>
        {view === "mentees" && <th className="w-56 px-3 py-3"><span className="sr-only">Actions</span></th>}
      </tr></thead>
      <tbody className="divide-y divide-border">
        {students.map((student) => <MappingRow key={student.studentId} student={student} view={view}
          canEdit={canEdit} mine={student.ownership?.mentorUserId === actorUserId} selected={selected.includes(student.studentId)}
          busy={busy} schoolCode={schoolCode} onToggle={onToggle} onRemove={onRemove} />)}
      </tbody>
    </table>
  </div>;
}

function MappingRow({ student, view, canEdit, mine, selected, busy, schoolCode, onToggle, onRemove }: {
  student: Student;
  view: "assign" | "mentees";
  canEdit: boolean;
  mine: boolean;
  selected: boolean;
  busy: boolean;
  schoolCode: string;
  onToggle: (studentId: number) => void;
  onRemove: (student: Student) => Promise<void>;
}) {
  return <tr>
    <MappingSelectCell view={view} canEdit={canEdit} student={student} selected={selected}
      mine={mine} onToggle={onToggle} />
    <td className="px-3 py-3 font-medium text-text-primary">
      {student.name}
      {student.externalStudentId && <span className="block text-xs font-normal text-text-muted">{student.externalStudentId}</span>}
    </td>
    <td className="px-3 py-3">{student.grade}</td>
    <td className="px-3 py-3">{mine ? "You" : student.ownership?.mentorName ?? "Unassigned"}</td>
    <MappingActionsCell view={view} student={student} canEdit={canEdit} busy={busy}
      schoolCode={schoolCode} onRemove={onRemove} />
  </tr>;
}

function MappingSelectCell({ view, canEdit, student, selected, mine, onToggle }: {
  view: "assign" | "mentees";
  canEdit: boolean;
  student: Student;
  selected: boolean;
  mine: boolean;
  onToggle: (studentId: number) => void;
}) {
  if (view !== "assign" || !canEdit) return null;
  return <td className="px-3 py-3">
    <input type="checkbox" aria-label={`Select ${student.name}`} checked={selected} disabled={mine}
      onChange={() => onToggle(student.studentId)} />
  </td>;
}

function MappingActionsCell({ view, student, canEdit, busy, schoolCode, onRemove }: {
  view: "assign" | "mentees";
  student: Student;
  canEdit: boolean;
  busy: boolean;
  schoolCode: string;
  onRemove: (student: Student) => Promise<void>;
}) {
  if (view !== "mentees") return null;
  return <td className="px-3 py-3 text-right">
      <div className="flex justify-end gap-2">
        {student.activePhaseId && <Link
          href={`/holistic-mentorship/students/${student.studentId}/phases/${student.activePhaseId}?${new URLSearchParams({ school_code: schoolCode, academic_year: CURRENT_ACADEMIC_YEAR })}`}
          aria-label={`Open ${student.name}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-3 font-medium text-text-on-accent hover:bg-accent-hover">
          Open <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>}
        {canEdit && (
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 font-medium hover:bg-hover-bg disabled:opacity-50"
            disabled={busy} onClick={() => void onRemove(student)}>
            <UserMinus aria-hidden="true" className="h-4 w-4" /> Remove
          </button>
        )}
      </div>
    </td>;
}

function AssignSelectedButton({ view, canEdit, selectedCount, busy, onAssign }: {
  view: "assign" | "mentees";
  canEdit: boolean;
  selectedCount: number;
  busy: boolean;
  onAssign: () => Promise<void>;
}) {
  if (!canEdit || view !== "assign" || selectedCount === 0) return null;
  return <div className="flex justify-end">
    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-text-on-accent hover:bg-accent-hover disabled:opacity-50"
      disabled={busy} onClick={() => void onAssign()}>
      <UserPlus aria-hidden="true" className="h-4 w-4" /> Assign {selectedCount} selected
    </button>
  </div>;
}
