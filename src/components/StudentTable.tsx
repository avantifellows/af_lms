"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EditStudentModal, { Batch } from "./EditStudentModal";

interface Student {
  group_user_id: string;
  user_id: string;
  student_pk_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  student_id: string | null;
  apaar_id: string | null;
  category: string | null;
  stream: string | null;
  gender: string | null;
  program_name: string | null;
  program_id: number | null;
  grade: number | null;
  grade_id: string | null;
  status: string | null;
  updated_at: string | null;
}

export interface Grade {
  id: string;
  number: number;
  group_id: string;
}

interface StudentTableProps {
  students: Student[];
  dropoutStudents?: Student[];
  canEdit?: boolean;                   // feature-level edit (from matrix)
  userProgramIds?: number[] | null;    // null = owns all (admin/passcode)
  isPasscodeUser?: boolean;
  isAdmin?: boolean;
  grades: Grade[];
  batches?: Batch[];
  nvsStreams?: string[];
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  const d = new Date(dateString);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getCategoryColor(category: string | null): string {
  switch (category) {
    case "Gen":
      return "bg-green-100 text-green-800";
    case "OBC":
      return "bg-blue-100 text-blue-800";
    case "SC":
      return "bg-purple-100 text-purple-800";
    case "ST":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function getCurrentAcademicYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month >= 3) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

function formatDateForAPI(date: Date): string {
  return date.toISOString().split("T")[0];
}

interface StudentCardProps {
  student: Student;
  canEdit: boolean;
  onEdit: () => void;
  onDropout: () => void;
}

function StudentCard({ student, canEdit, onEdit, onDropout }: StudentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isDropout = student.status === "dropout";

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {/* Main card content - always visible */}
      <div className="p-4">
        <div className="flex items-center justify-between gap-4">
          {/* Left side - Student info */}
          <div className="flex-1 min-w-0">
            {/* Name and badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-gray-900">
                {[student.first_name, student.last_name].filter(Boolean).join(" ") || "—"}
              </h3>
              {student.grade && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                  Grade {student.grade}
                </span>
              )}
              {isDropout && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                  Dropout
                </span>
              )}
            </div>

            {/* Key info row */}
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
              <div>
                <span className="text-gray-400">Student ID/G10 Roll No.: </span>
                <span className="font-medium text-gray-700">{student.student_id || "—"}</span>
              </div>
              <div>
                <span className="text-gray-400">APAAR: </span>
                <span className="font-medium text-gray-700">{student.apaar_id || "—"}</span>
              </div>
              <div>
                <span className="text-gray-400">DOB: </span>
                <span className="text-gray-700">{formatDate(student.date_of_birth)}</span>
              </div>
            </div>
          </div>

          {/* Right side - Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {canEdit && !isDropout && (
              <>
                <button
                  onClick={onEdit}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-sm"
                >
                  Edit
                </button>
                <button
                  onClick={onDropout}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors shadow-sm"
                >
                  Dropout
                </button>
              </>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              <svg
                className={`w-5 h-5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 pt-3 border-t border-gray-100 bg-gray-50">
          <div className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Phone</span>
              <p className="text-gray-900 font-medium">{student.phone || "—"}</p>
            </div>
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Gender</span>
              <p className="text-gray-900">{student.gender || "—"}</p>
            </div>
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Category</span>
              <p>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getCategoryColor(student.category)}`}>
                  {student.category || "—"}
                </span>
              </p>
            </div>
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Stream</span>
              <p className="text-gray-900 capitalize">{student.stream || "—"}</p>
            </div>
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Program</span>
              <p className="text-gray-900">{student.program_name || "—"}</p>
            </div>
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Email</span>
              <p className="text-gray-900 truncate">{student.email || "—"}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface DropoutModalProps {
  student: Student;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function DropoutModal({ student, isOpen, onClose, onConfirm }: DropoutModalProps) {
  const [dropoutDate, setDropoutDate] = useState(formatDateForAPI(new Date()));
  const [dropoutYear, setDropoutYear] = useState(getCurrentAcademicYear());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setError("");
    setLoading(true);

    try {
      const identifier = student.student_id
        ? { student_id: student.student_id }
        : { apaar_id: student.apaar_id };

      const response = await fetch("/api/student/dropout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...identifier,
          start_date: dropoutDate,
          academic_year: dropoutYear,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to mark student as dropout");
      }

      onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const studentName = [student.first_name, student.last_name].filter(Boolean).join(" ") || "this student";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-30" onClick={onClose} />
        <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Mark as Dropout
          </h2>

          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <p className="text-sm text-gray-900 mb-4">
            Are you sure you want to mark <strong>{studentName}</strong> as a dropout?
            This action cannot be undone.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Dropout Date
              </label>
              <input
                type="date"
                value={dropoutDate}
                onChange={(e) => setDropoutDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Academic Year
              </label>
              <input
                type="text"
                value={dropoutYear}
                onChange={(e) => setDropoutYear(e.target.value)}
                placeholder="e.g., 2025-2026"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:bg-gray-300"
            >
              {loading ? "Processing..." : "Confirm Dropout"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StudentTable({
  students,
  dropoutStudents = [],
  canEdit = true,
  userProgramIds = null,
  isPasscodeUser = false,
  isAdmin = false,
  grades,
  batches = [],
  nvsStreams = [],
}: StudentTableProps) {
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [dropoutStudent, setDropoutStudent] = useState<Student | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"active" | "dropout">("active");
  const router = useRouter();

  // Per-row ownership check: combines feature-level canEdit with program ownership
  const canEditStudent = (student: Student): boolean => {
    if (!canEdit) return false;
    if (isPasscodeUser || isAdmin) return true;
    if (student.program_id === null) return true;
    if (!userProgramIds || userProgramIds.length === 0) return false;
    return userProgramIds.includes(Number(student.program_id));
  };

  // Determine which students to show based on tab
  const currentStudents = activeTab === "active" ? students : dropoutStudents;

  // Get unique grades from current students for filtering
  const studentGrades = [
    ...new Set(
      currentStudents.map((s) => s.grade).filter((g): g is number => g !== null),
    ),
  ].sort((a, b) => a - b);

  // Filter students by selected grade
  const filteredStudents =
    selectedGrade === "all"
      ? currentStudents
      : currentStudents.filter((s) => s.grade === parseInt(selectedGrade));

  // Reset grade filter when switching tabs if the selected grade doesn't exist in new tab
  const handleTabChange = (tab: "active" | "dropout") => {
    setActiveTab(tab);
    const targetStudents = tab === "active" ? students : dropoutStudents;
    const targetGrades = [...new Set(targetStudents.map((s) => s.grade).filter((g): g is number => g !== null))];
    if (selectedGrade !== "all" && !targetGrades.includes(parseInt(selectedGrade))) {
      setSelectedGrade("all");
    }
  };

  const handleSave = () => {
    router.refresh();
  };

  const showTabs = dropoutStudents.length > 0;

  return (
    <>
      {/* Tabs - only show if there are dropout students */}
      {showTabs && (
        <div className="max-w-3xl mx-auto mb-4">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => handleTabChange("active")}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "active"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Active Students ({students.length})
            </button>
            <button
              onClick={() => handleTabChange("dropout")}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "dropout"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Dropout ({dropoutStudents.length})
            </button>
          </div>
        </div>
      )}

      {/* Grade filter - centered */}
      <div className="max-w-3xl mx-auto mb-4 flex items-center gap-4">
        <label
          htmlFor="gradeFilter"
          className="text-sm font-medium text-gray-700"
        >
          Filter by Grade:
        </label>
        <select
          id="gradeFilter"
          value={selectedGrade}
          onChange={(e) => setSelectedGrade(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All Grades ({currentStudents.length})</option>
          {studentGrades.map((grade) => (
            <option key={grade} value={grade}>
              Grade {grade} ({currentStudents.filter((s) => s.grade === grade).length})
            </option>
          ))}
        </select>
        {selectedGrade !== "all" && (
          <span className="text-sm text-gray-500">
            Showing {filteredStudents.length} of {currentStudents.length} students
          </span>
        )}
      </div>

      {/* Student cards */}
      <div className="max-w-3xl mx-auto space-y-3">
        {filteredStudents.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
            {currentStudents.length === 0
              ? activeTab === "active"
                ? "No active students enrolled in this school"
                : "No dropout students"
              : "No students match the selected filter"}
          </div>
        ) : (
          filteredStudents.map((student) => (
            <StudentCard
              key={student.group_user_id}
              student={student}
              canEdit={canEditStudent(student)}
              onEdit={() => setEditingStudent(student)}
              onDropout={() => setDropoutStudent(student)}
            />
          ))
        )}
      </div>

      {/* Edit Modal */}
      {editingStudent && (
        <EditStudentModal
          student={editingStudent}
          isOpen={!!editingStudent}
          onClose={() => setEditingStudent(null)}
          onSave={handleSave}
          grades={grades}
          batches={batches}
          nvsStreams={nvsStreams}
        />
      )}

      {/* Dropout Modal */}
      {dropoutStudent && (
        <DropoutModal
          student={dropoutStudent}
          isOpen={!!dropoutStudent}
          onClose={() => setDropoutStudent(null)}
          onConfirm={handleSave}
        />
      )}
    </>
  );
}
