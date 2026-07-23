"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import EditStudentModal, { Batch } from "./EditStudentModal";
import {
  Card,
  Badge,
  Button,
  Modal,
  DetailField,
  DetailGroup,
} from "@/components/ui";
import { DocumentsList } from "@/components/documents/DocumentsList";
import { PROGRAM_IDS, PROGRAM_ID_TO_LABEL } from "@/lib/constants";

export interface Student {
  group_user_id: string;
  user_id: string;
  student_pk_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  student_id: string | null;
  pen_number?: string | null;
  apaar_id: string | null;
  category: string | null;
  physically_handicapped?: boolean | null;
  stream: string | null;
  gender: string | null;
  g10_board?: string | null;
  g10_roll_no?: string | null;
  // Additional editable profile fields. Optional because not every consumer
  // (or test fixture) selects them; the school roster query populates them.
  whatsapp_phone?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  pincode?: string | null;
  board_stream?: string | null;
  school_medium?: string | null;
  father_name?: string | null;
  father_phone?: string | null;
  father_profession?: string | null;
  father_education_level?: string | null;
  mother_name?: string | null;
  mother_phone?: string | null;
  mother_profession?: string | null;
  mother_education_level?: string | null;
  guardian_name?: string | null;
  guardian_relation?: string | null;
  guardian_phone?: string | null;
  guardian_education_level?: string | null;
  guardian_profession?: string | null;
  annual_family_income?: string | null;
  monthly_family_income?: string | null;
  program_name: string | null;
  program_id: number | null;
  student_program_ids?: Array<number | string> | null;
  dropout_program_ids?: Array<number | string> | null;
  can_undo_nvs_dropout?: boolean;
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
  canEdit?: boolean; // feature-level edit (from matrix)
  canEditStudent?: boolean; // student-addition edit gate
  canDropoutStudent?: boolean;
  selectedProgramId?: number | null;
  dropoutProgramIds?: number[] | null;
  userProgramIds?: number[] | null; // null = owns all (admin/passcode)
  isPasscodeUser?: boolean;
  isAdmin?: boolean;
  grades: Grade[];
  batches?: Batch[];
  nvsStreams?: string[];
  // Optional controlled grade filter. When provided, the parent owns the
  // selected grade (e.g. to also scope summary pills); otherwise the table
  // manages it internally. `hideGradeFilterUI` hides the in-table dropdown
  // when the parent renders its own filter control above.
  selectedGrade?: string;
  onGradeChange?: (grade: string) => void;
  selectedStream?: string;
  hideGradeFilterUI?: boolean;
  // Called after a save/upload (in addition to the internal router.refresh) so
  // the parent can refetch data it owns — e.g. the consent map behind the
  // admission summary.
  onDataChanged?: () => void;
}

function studentBelongsToProgram(student: Student, programId: number) {
  if (Array.isArray(student.student_program_ids)) {
    return student.student_program_ids.map(Number).includes(programId);
  }
  return Number(student.program_id) === programId;
}

function userCanManageProgram(
  isAdmin: boolean,
  userProgramIds: number[] | null,
  programId: number,
) {
  return isAdmin || Boolean(userProgramIds?.includes(programId));
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  const d = new Date(dateString);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getCategoryColor(category: string | null): string {
  switch (category) {
    case "Gen":
      return "bg-green-100 text-green-800";
    case "OBC":
      return "bg-hover-bg text-accent-hover";
    case "SC":
      return "bg-purple-100 text-purple-800";
    case "ST":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

interface StudentCardProps {
  student: Student;
  canEditStudent: boolean;
  canDropout: boolean;
  canUndoDropout: boolean;
  onEdit: () => void;
  onDropout: () => void;
  onUndoDropout: () => void;
  isDropoutView?: boolean;
  /**
   * Bumped by the parent when something outside this card may have changed
   * the student's documents (e.g. an upload via EditStudentModal). Forwarded
   * to the inline DocumentsList so it refetches.
   */
  documentsRefreshNonce?: number;
}

// Coerce a `string | null` PK into a safe positive integer; rejects NaN +
// non-numeric junk so the Documents UI can disable cleanly instead of firing
// /api/students/NaN/documents.
function parseStudentPkId(raw: string | null): number | null {
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// A compact labeled field for the collapsed card summary grid.
function KeyField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="truncate text-sm font-medium text-gray-700">
        {children}
      </div>
    </div>
  );
}

// fallow-ignore-next-line complexity
function StudentCard({
  student,
  canEditStudent,
  canDropout,
  canUndoDropout,
  onEdit,
  onDropout,
  onUndoDropout,
  isDropoutView = false,
  documentsRefreshNonce,
}: StudentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isDropout = isDropoutView || student.status === "dropout";
  const studentPkId = parseStudentPkId(student.student_pk_id);

  return (
    <Card elevation="md" className="overflow-hidden">
      {/* Main card content - always visible */}
      <div className="p-3 sm:p-4">
        {/* Top row: name + badges (left), expand (right) */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">
              {[student.first_name, student.last_name]
                .filter(Boolean)
                .join(" ") || "—"}
            </h3>
            {student.grade && (
              <Badge variant="info">Grade {student.grade}</Badge>
            )}
            {isDropout && <Badge variant="danger">Dropout</Badge>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="icon"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              <svg
                className={`w-5 h-5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </Button>
          </div>
        </div>

        {/* Key fields — spread across the card width so it isn't mostly empty */}
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
          <KeyField label="Student ID">{student.student_id || "—"}</KeyField>
          <KeyField label="PEN">{student.pen_number || "—"}</KeyField>
          <KeyField label="APAAR ID">{student.apaar_id || "—"}</KeyField>
          <KeyField label="Phone">{student.phone || "—"}</KeyField>
          <KeyField label="Gender">{student.gender || "—"}</KeyField>
          <KeyField label="Category">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getCategoryColor(student.category)}`}
            >
              {student.category || "—"}
            </span>
          </KeyField>
          <KeyField label="Program">{student.program_name || "—"}</KeyField>
          <KeyField label="DOB">{formatDate(student.date_of_birth)}</KeyField>
        </div>

        {/* Action buttons */}
        {(canEditStudent || canDropout) && !isDropout && (
          <div className="mt-3 flex items-center justify-end gap-2">
            {canEditStudent && (
              <Button variant="ghost" size="sm" onClick={onEdit}>
                Edit
              </Button>
            )}
            {canDropout && (
              <Button variant="danger-ghost" size="sm" onClick={onDropout}>
                Dropout
              </Button>
            )}
          </div>
        )}
        {canUndoDropout && isDropout && (
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" onClick={onUndoDropout}>
              Undo Dropout
            </Button>
          </div>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-3 border-t border-border bg-bg-card-alt px-4 pb-4 pt-4">
          {/* Phone / Gender / Category / Program now live in the always-visible
              card summary above, so the expanded view covers the rest. */}
          <DetailGroup title="Personal">
            <DetailField
              label="Stream"
              value={student.stream}
              className="capitalize"
            />
            <DetailField
              label="Email"
              value={student.email}
              className="truncate"
            />
          </DetailGroup>

          <DetailGroup title="Academic">
            <DetailField label="Board Stream" value={student.board_stream} />
            <DetailField label="School Medium" value={student.school_medium} />
          </DetailGroup>

          <DetailGroup title="Contact & Address">
            <DetailField label="WhatsApp" value={student.whatsapp_phone} />
            <DetailField label="Address" value={student.address} />
            <DetailField label="City" value={student.city} />
            <DetailField label="District" value={student.district} />
            <DetailField label="State" value={student.state} />
            <DetailField label="Pincode" value={student.pincode} />
          </DetailGroup>

          <DetailGroup title="Father">
            <DetailField label="Name" value={student.father_name} />
            <DetailField label="Phone" value={student.father_phone} />
            <DetailField label="Profession" value={student.father_profession} />
            <DetailField
              label="Education Level"
              value={student.father_education_level}
            />
          </DetailGroup>

          <DetailGroup title="Mother">
            <DetailField label="Name" value={student.mother_name} />
            <DetailField label="Phone" value={student.mother_phone} />
            <DetailField label="Profession" value={student.mother_profession} />
            <DetailField
              label="Education Level"
              value={student.mother_education_level}
            />
          </DetailGroup>

          <DetailGroup title="Guardian">
            <DetailField label="Name" value={student.guardian_name} />
            <DetailField label="Relation" value={student.guardian_relation} />
            <DetailField label="Phone" value={student.guardian_phone} />
            <DetailField
              label="Profession"
              value={student.guardian_profession}
            />
            <DetailField
              label="Education Level"
              value={student.guardian_education_level}
            />
          </DetailGroup>

          <DetailGroup title="Socio-economic">
            <DetailField
              label="Annual Family Income"
              value={student.annual_family_income}
            />
            <DetailField
              label="Monthly Family Income"
              value={student.monthly_family_income}
            />
          </DetailGroup>

          {studentPkId !== null && (
            <section className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
              <h4 className="mb-3 border-b border-border pb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                Documents
              </h4>
              <DocumentsList
                studentId={studentPkId}
                canDelete={canEditStudent || canDropout}
                refreshNonce={documentsRefreshNonce}
              />
            </section>
          )}
        </div>
      )}
    </Card>
  );
}

interface DropoutModalProps {
  student: Student;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  programId: number;
  programLabel: string;
}

function DropoutModal({
  student,
  isOpen,
  onClose,
  onConfirm,
  programId,
  programLabel,
}: DropoutModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/student/dropout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_pk_id: student.student_pk_id,
          program_id: programId,
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

  const studentName =
    [student.first_name, student.last_name].filter(Boolean).join(" ") ||
    "this student";

  return (
    <Modal open={isOpen} onClose={onClose} className="max-w-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Mark as Dropout
      </h2>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <p className="text-sm text-gray-900 mb-4">
        Are you sure you want to mark <strong>{studentName}</strong> as a
        dropout from {programLabel}?
      </p>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleSubmit} disabled={loading}>
          {loading ? "Processing..." : "Confirm Dropout"}
        </Button>
      </div>
    </Modal>
  );
}

function UndoDropoutModal({
  student,
  isOpen,
  onClose,
  onConfirm,
}: {
  student: Student;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const name =
    [student.first_name, student.last_name].filter(Boolean).join(" ") ||
    "this student";

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/student/dropout/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_pk_id: student.student_pk_id }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to undo dropout");
      }
      onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to undo dropout");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} className="max-w-md p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Undo Dropout</h2>
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <p className="mb-4 text-sm text-gray-900">
        Restore <strong>{name}</strong> to their previous NVS batch?
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? "Restoring..." : "Undo Dropout"}
        </Button>
      </div>
    </Modal>
  );
}

// fallow-ignore-next-line complexity
export default function StudentTable({
  students,
  dropoutStudents = [],
  canEdit = true,
  canEditStudent: canEditStudentEntry = canEdit,
  canDropoutStudent = canEditStudentEntry,
  selectedProgramId = null,
  dropoutProgramIds = null,
  userProgramIds = null,
  isAdmin = false,
  isPasscodeUser = false,
  grades,
  batches = [],
  nvsStreams = [],
  selectedGrade: controlledGrade,
  onGradeChange,
  selectedStream = "all",
  hideGradeFilterUI = false,
  onDataChanged,
}: StudentTableProps) {
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [dropoutStudent, setDropoutStudent] = useState<Student | null>(null);
  const [undoStudent, setUndoStudent] = useState<Student | null>(null);
  // Grade filter can be controlled by the parent (to also scope summary pills)
  // or managed internally when used standalone.
  const [internalGrade, setInternalGrade] = useState<string>("all");
  const selectedGrade = controlledGrade ?? internalGrade;
  const setSelectedGrade = onGradeChange ?? setInternalGrade;
  // Bumped when something inside EditStudentModal (e.g. an upload or a
  // delete) may have changed any open card's documents. Forwarded to each
  // StudentCard so its inline DocumentsList refetches.
  const [documentsRefresh, setDocumentsRefresh] = useState(0);
  const router = useRouter();
  const searchParams = useSearchParams();
  const dropoutRequested = searchParams.get("students") === "dropout";
  const [activeTab, setActiveTabState] = useState<"active" | "dropout">(
    dropoutRequested && dropoutStudents.length > 0 ? "dropout" : "active",
  );
  const effectiveProgramId =
    selectedProgramId ??
    (students[0]?.program_id == null ? null : Number(students[0].program_id));

  useEffect(() => {
    if (!dropoutRequested || dropoutStudents.length > 0) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("students");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }, [dropoutRequested, dropoutStudents.length, router, searchParams]);

  // Per-row edit gate: feature-level student edit (the permission matrix) plus
  // ownership of the selected program. Admins edit any student in the program;
  // other staff edit students in a program they manage. Mirrors the server's
  // requireStudentEditAccess. Not NVS-restricted — editing was previously (and
  // incorrectly) limited to NVS students only.
  const canEditStudentInSelectedProgram = (student: Student): boolean => {
    if (!canEditStudentEntry || effectiveProgramId == null) return false;
    if (isPasscodeUser || !student.student_pk_id) return false;
    if (!studentBelongsToProgram(student, effectiveProgramId)) return false;
    return userCanManageProgram(isAdmin, userProgramIds, effectiveProgramId);
  };

  const canDropoutFromSelectedProgram = (student: Student): boolean => {
    if (!canDropoutStudent || effectiveProgramId == null) return false;
    if (dropoutProgramIds && !dropoutProgramIds.includes(effectiveProgramId))
      return false;
    if (isPasscodeUser || !student.student_pk_id) return false;
    if (!studentBelongsToProgram(student, effectiveProgramId)) return false;
    return userCanManageProgram(isAdmin, userProgramIds, effectiveProgramId);
  };

  const canUndoNvsDropout = (student: Student): boolean =>
    Boolean(
      canDropoutStudent &&
      effectiveProgramId === PROGRAM_IDS.NVS &&
      !isPasscodeUser &&
      student.student_pk_id &&
      student.can_undo_nvs_dropout &&
      (isAdmin || userProgramIds?.includes(PROGRAM_IDS.NVS)) &&
      student.dropout_program_ids?.map(Number).includes(PROGRAM_IDS.NVS),
    );

  // Determine which students to show based on tab
  const currentStudents = activeTab === "active" ? students : dropoutStudents;

  // Get unique grades from current students for filtering
  const studentGrades = [
    ...new Set(
      currentStudents
        .map((s) => s.grade)
        .filter((g): g is number => g !== null),
    ),
  ].sort((a, b) => a - b);

  // Filter students by selected grade
  const filteredStudents = currentStudents.filter(
    (student) =>
      (selectedGrade === "all" || student.grade === parseInt(selectedGrade)) &&
      (selectedStream === "all" ||
        student.stream?.toLowerCase() === selectedStream.toLowerCase()),
  );

  // Reset grade filter when switching tabs if the selected grade doesn't exist in new tab
  const handleTabChange = (tab: "active" | "dropout") => {
    setActiveTabState(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "active") params.delete("students");
    else params.set("students", tab);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });

    const targetStudents = tab === "active" ? students : dropoutStudents;
    const targetGrades = [
      ...new Set(
        targetStudents
          .map((s) => s.grade)
          .filter((g): g is number => g !== null),
      ),
    ];
    if (
      selectedGrade !== "all" &&
      !targetGrades.includes(parseInt(selectedGrade))
    ) {
      setSelectedGrade("all");
    }
  };

  const handleSave = () => {
    router.refresh();
    setDocumentsRefresh((n) => n + 1);
    // Lets the parent refetch data it owns (e.g. the consent map behind the
    // admission summary) so an uploaded consent doc reflects without a full
    // page reload.
    onDataChanged?.();
  };

  const showTabs = dropoutStudents.length > 0;

  return (
    <>
      {/* Tabs - only show if there are dropout students */}
      {showTabs && (
        <div className="mb-4">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => handleTabChange("active")}
              className={`px-3 sm:px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "active"
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Active ({students.length})
            </button>
            <button
              onClick={() => handleTabChange("dropout")}
              className={`px-3 sm:px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "dropout"
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Dropout ({dropoutStudents.length})
            </button>
          </div>
        </div>
      )}

      {/* Grade filter - centered. Hidden when the parent renders its own
          filter control above (controlled mode). */}
      {!hideGradeFilterUI && (
        <div className="mb-4 flex flex-wrap items-center gap-3 sm:gap-4">
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
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
          >
            <option value="all">All Grades ({currentStudents.length})</option>
            {studentGrades.map((grade) => (
              <option key={grade} value={grade}>
                Grade {grade} (
                {currentStudents.filter((s) => s.grade === grade).length})
              </option>
            ))}
          </select>
          {selectedGrade !== "all" && (
            <span className="text-sm text-gray-500">
              Showing {filteredStudents.length} of {currentStudents.length}{" "}
              students
            </span>
          )}
        </div>
      )}

      {/* Student cards — one per row, full width. The card's own field grid
          fills the width, so a single column reads cleanly. */}
      <div className="space-y-3">
        {filteredStudents.length === 0 ? (
          <Card
            elevation="sm"
            className="p-8 text-center text-sm text-gray-500"
          >
            {currentStudents.length === 0
              ? activeTab === "active"
                ? "No active students enrolled in this school"
                : "No dropout students"
              : "No students match the selected filter"}
          </Card>
        ) : (
          filteredStudents.map((student) => (
            <StudentCard
              key={student.group_user_id}
              student={student}
              canEditStudent={
                activeTab === "active" &&
                canEditStudentInSelectedProgram(student)
              }
              canDropout={
                activeTab === "active" && canDropoutFromSelectedProgram(student)
              }
              canUndoDropout={
                activeTab === "dropout" && canUndoNvsDropout(student)
              }
              onEdit={() => setEditingStudent(student)}
              onDropout={() => setDropoutStudent(student)}
              onUndoDropout={() => setUndoStudent(student)}
              isDropoutView={activeTab === "dropout"}
              documentsRefreshNonce={documentsRefresh}
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
          programId={effectiveProgramId}
        />
      )}

      {/* Dropout Modal */}
      {dropoutStudent && (
        <DropoutModal
          student={dropoutStudent}
          isOpen={!!dropoutStudent}
          onClose={() => setDropoutStudent(null)}
          onConfirm={handleSave}
          programId={effectiveProgramId!}
          programLabel={
            PROGRAM_ID_TO_LABEL[effectiveProgramId!] ||
            `Program ${effectiveProgramId}`
          }
        />
      )}
      {undoStudent && (
        <UndoDropoutModal
          student={undoStudent}
          isOpen
          onClose={() => setUndoStudent(null)}
          onConfirm={() => {
            handleSave();
            if (dropoutStudents.length === 1) handleTabChange("active");
          }}
        />
      )}
    </>
  );
}
