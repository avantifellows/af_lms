"use client";

import { ArrowRight, Search, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
}

function savedFilters(schoolCode: string): SavedFilters {
  if (typeof window === "undefined") return { search: "", grade: "" };
  try {
    return JSON.parse(sessionStorage.getItem(`holistic-mappings:${schoolCode}`) || "null") ??
      { search: "", grade: "" };
  } catch {
    return { search: "", grade: "" };
  }
}

function studentsForView(students: Student[], view: "assign" | "mentees", actorUserId: number | null) {
  if (view === "assign") return students;
  return students.filter((student) => student.ownership?.mentorUserId === actorUserId);
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
  const initial = useMemo(() => savedFilters(schoolCode), [schoolCode]);
  const [search, setSearch] = useState(initial.search);
  const [grade, setGrade] = useState<SavedFilters["grade"]>(initial.grade);
  const [students, setStudents] = useState<Student[]>([]);
  const [actorUserId, setActorUserId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
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
    } catch (error) {
      if ((error as Error).name !== "AbortError") setMessage((error as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [grade, schoolCode, search]);

  useEffect(() => {
    sessionStorage.setItem(
      `holistic-mappings:${schoolCode}`,
      JSON.stringify({ search, grade })
    );
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [grade, load, schoolCode, search]);

  useEffect(() => {
    const key = `holistic-mappings-scroll:${schoolCode}`;
    const saved = Number(sessionStorage.getItem(key));
    if (Number.isFinite(saved) && saved > 0) window.scrollTo({ top: saved });
    const remember = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [schoolCode]);

  const visible = studentsForView(students, view, actorUserId);

  const toggle = (studentId: number) => {
    setSelected((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  };

  const assign = async () => {
    const choices = students.filter((student) => selected.includes(student.studentId));
    const takeover = choices.some(
      (student) => student.ownership && student.ownership.mentorUserId !== actorUserId
    );
    if (takeover && !window.confirm("Take over the selected Students from their current Mentor?")) return;
    setBusy(true);
    let problem = "";
    try {
      const response = await fetch("/api/holistic-mentorship/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: schoolCode,
          academic_year: CURRENT_ACADEMIC_YEAR,
          takeover_confirmed: takeover,
          selections: choices.map((student) => ({
            student_id: student.studentId,
            expected_mapping_id: student.ownership?.mappingId ?? null,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) problem = data.error || "Mapping changed; review the refreshed roster";
    } catch {
      problem = "Unable to update Mappings";
    }
    await load();
    setMessage(problem);
    setBusy(false);
  };

  const remove = async (student: Student) => {
    if (!student.ownership || !window.confirm(`Remove ${student.name} from My Mentees?`)) return;
    setBusy(true);
    let problem = "";
    try {
      const response = await fetch("/api/holistic-mentorship/mappings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: schoolCode,
          academic_year: CURRENT_ACADEMIC_YEAR,
          confirmed: true,
          mappings: [{
            student_id: student.studentId,
            expected_mapping_id: student.ownership.mappingId,
          }],
        }),
      });
      const data = await response.json();
      if (!response.ok) problem = data.error || "Mapping changed; review the refreshed roster";
    } catch {
      problem = "Unable to remove Mapping";
    }
    await load();
    setMessage(problem);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <MappingFilters search={search} grade={grade} onSearchChange={setSearch} onGradeChange={setGrade} />
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
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
      {canEdit && (
        <AssignSelectedButton view={view} selectedCount={selected.length} busy={busy} onAssign={assign} />
      )}
    </div>
  );
}

function MappingFilters({ search, grade, onSearchChange, onGradeChange }: {
  search: string;
  grade: SavedFilters["grade"];
  onSearchChange: (value: string) => void;
  onGradeChange: (value: SavedFilters["grade"]) => void;
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
    {view === "assign" && canEdit && <td className="px-3 py-3">
      <input type="checkbox" aria-label={`Select ${student.name}`} checked={selected} disabled={mine}
        onChange={() => onToggle(student.studentId)} />
    </td>}
    <td className="px-3 py-3 font-medium text-text-primary">
      {student.name}
      {student.externalStudentId && <span className="block text-xs font-normal text-text-muted">{student.externalStudentId}</span>}
    </td>
    <td className="px-3 py-3">{student.grade}</td>
    <td className="px-3 py-3">{mine ? "You" : student.ownership?.mentorName ?? "Unassigned"}</td>
    {view === "mentees" && <td className="px-3 py-3 text-right">
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
    </td>}
  </tr>;
}

function AssignSelectedButton({ view, selectedCount, busy, onAssign }: {
  view: "assign" | "mentees";
  selectedCount: number;
  busy: boolean;
  onAssign: () => Promise<void>;
}) {
  if (view !== "assign" || selectedCount === 0) return null;
  return <div className="flex justify-end">
    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-text-on-accent hover:bg-accent-hover disabled:opacity-50"
      disabled={busy} onClick={() => void onAssign()}>
      <UserPlus aria-hidden="true" className="h-4 w-4" /> Assign {selectedCount} selected
    </button>
  </div>;
}
