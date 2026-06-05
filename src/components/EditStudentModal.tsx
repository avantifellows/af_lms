"use client";

import { useState, useMemo } from "react";
import { type Grade, type Student } from "./StudentTable";
import { Modal, Button } from "@/components/ui";
import { UploadDocumentForm } from "@/components/documents/UploadDocumentForm";
import { DocumentsList } from "@/components/documents/DocumentsList";

export interface Batch {
  id: number;
  name: string;
  batch_id: string;
  program_id: number;
  group_id: string;
  metadata: { stream?: string; grade?: number } | null;
}

interface EditStudentModalProps {
  student: Student;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  grades: Grade[];
  batches?: Batch[];
  nvsStreams?: string[];
}

const CATEGORY_OPTIONS = ["Gen", "OBC", "SC", "ST", "Gen-EWS"];

// Parse category to extract base category and PWD status
function parseCategory(category: string | null): {
  baseCategory: string;
  isPWD: boolean;
} {
  if (!category) return { baseCategory: "", isPWD: false };

  if (category.startsWith("PWD-")) {
    const base = category.replace("PWD-", "");
    // Normalize variations like "PWD-General" to "Gen"
    const normalizedBase = base === "General" ? "Gen" : base;
    return { baseCategory: normalizedBase, isPWD: true };
  }

  return { baseCategory: category, isPWD: false };
}

// Combine base category and PWD status
function combineCategory(baseCategory: string, isPWD: boolean): string {
  if (!baseCategory) return "";
  return isPWD ? `PWD-${baseCategory}` : baseCategory;
}
const GENDER_OPTIONS = ["Male", "Female", "Other"];

// Format a date string from the database to YYYY-MM-DD for HTML date input
function formatDateForInput(dateString: string | null): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    // Use UTC methods to avoid timezone shifts
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch {
    return "";
  }
}

const inputClassName =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20";
const labelClassName = "block text-sm font-medium text-gray-700";
const sectionHeadingClassName =
  "text-xs font-bold uppercase tracking-wide text-text-muted pt-2";

export default function EditStudentModal({
  student,
  isOpen,
  onClose,
  onSave,
  grades,
  batches = [],
  nvsStreams = [],
}: EditStudentModalProps) {
  const { baseCategory, isPWD } = parseCategory(student.category);

  // Find the group_id for the student's current grade
  // Use String() to handle potential type mismatches (number vs string)
  const currentGrade = grades.find(
    (g) => String(g.id) === String(student.grade_id)
  );
  const initialGroupId = currentGrade?.group_id || "";
  const originalStream = student.stream || "";
  const originalGradeGroupId = initialGroupId;

  const [formData, setFormData] = useState({
    first_name: student.first_name || "",
    last_name: student.last_name || "",
    phone: student.phone || "",
    whatsapp_phone: student.whatsapp_phone || "",
    gender: student.gender || "",
    date_of_birth: formatDateForInput(student.date_of_birth),
    baseCategory: baseCategory,
    isPWD: isPWD,
    stream: student.stream || "",
    board_stream: student.board_stream || "",
    school_medium: student.school_medium || "",
    group_id: initialGroupId,
    batch_group_id: "", // Will be set when stream changes
    // Address (user table)
    address: student.address || "",
    city: student.city || "",
    district: student.district || "",
    state: student.state || "",
    pincode: student.pincode || "",
    // Family / guardian (student table)
    father_name: student.father_name || "",
    father_phone: student.father_phone || "",
    father_profession: student.father_profession || "",
    father_education_level: student.father_education_level || "",
    mother_name: student.mother_name || "",
    mother_phone: student.mother_phone || "",
    mother_profession: student.mother_profession || "",
    mother_education_level: student.mother_education_level || "",
    guardian_name: student.guardian_name || "",
    guardian_relation: student.guardian_relation || "",
    guardian_phone: student.guardian_phone || "",
    guardian_education_level: student.guardian_education_level || "",
    guardian_profession: student.guardian_profession || "",
    annual_family_income: student.annual_family_income || "",
    monthly_family_income: student.monthly_family_income || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"details" | "documents">("details");
  // Bumped after a successful upload so DocumentsList refetches.
  const [documentsRefresh, setDocumentsRefresh] = useState(0);
  const studentName = [student.first_name, student.last_name].filter(Boolean).join(" ").trim();
  // Reject NaN + non-numeric junk so the Documents tab disables cleanly
  // instead of firing /api/students/NaN/documents.
  const studentPkId = (() => {
    const raw = student.student_pk_id;
    if (!raw || !/^\d+$/.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // Check if stream or grade has changed
  const streamChanged = formData.stream !== originalStream && formData.stream !== "";
  const gradeChanged = formData.group_id !== originalGradeGroupId && formData.group_id !== "";
  const needsBatchUpdate = streamChanged || gradeChanged;

  // Get the current grade number from the selected group_id
  const selectedGradeObj = grades.find((g) => g.group_id === formData.group_id);
  const currentGradeNumber = selectedGradeObj?.number || student.grade;

  // Filter batches by program, grade, and stream when either changes
  const availableBatches = useMemo(() => {
    if (!needsBatchUpdate || !currentGradeNumber || !student.program_id) return [];
    return batches.filter(
      (b) =>
        b.program_id === student.program_id &&
        b.metadata?.grade === currentGradeNumber &&
        b.metadata?.stream === formData.stream
    );
  }, [needsBatchUpdate, currentGradeNumber, formData.stream, batches, student.program_id]);

  // Auto-select batch if only one option
  useMemo(() => {
    if (availableBatches.length === 1 && formData.batch_group_id !== availableBatches[0].group_id) {
      setFormData((prev) => ({ ...prev, batch_group_id: availableBatches[0].group_id }));
    } else if (availableBatches.length === 0 && formData.batch_group_id !== "") {
      setFormData((prev) => ({ ...prev, batch_group_id: "" }));
    }
  }, [availableBatches]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!student.student_pk_id) {
      setError("Cannot update student: missing student record ID");
      setLoading(false);
      return;
    }

    // Validate phone numbers (10 digits if provided)
    const phoneFields: { label: string; value: string }[] = [
      { label: "Phone number", value: formData.phone },
      { label: "WhatsApp number", value: formData.whatsapp_phone },
      { label: "Father's phone", value: formData.father_phone },
      { label: "Mother's phone", value: formData.mother_phone },
      { label: "Guardian's phone", value: formData.guardian_phone },
    ];
    for (const { label, value } of phoneFields) {
      if (value && !/^\d{10}$/.test(value.replace(/\s/g, ""))) {
        setError(`${label} must be exactly 10 digits`);
        setLoading(false);
        return;
      }
    }

    // Validate: if stream or grade changed, batch must be selected
    if (needsBatchUpdate && !formData.batch_group_id) {
      setError("Please select a batch for the new stream/grade combination");
      setLoading(false);
      return;
    }

    try {
      // Combine category and PWD status before sending
      const { baseCategory, isPWD, group_id, batch_group_id, ...rest } = formData;

      // Find the grade_id (grade table ID) from the selected group_id
      const selectedGrade = grades.find((g) => g.group_id === group_id);
      const gradeId = selectedGrade?.id || null;

      const dataToSend: Record<string, unknown> = {
        ...rest,
        category: combineCategory(baseCategory, isPWD),
        // Include user_id for grade/batch enrollment updates
        user_id: student.user_id,
        // group_id for enrollment_record update (via PATCH /update-group-user-by-type)
        group_id: group_id,
        // grade_id for student table update (via PATCH /student)
        grade_id: gradeId,
      };

      // Include batch_group_id if stream or grade changed
      if (needsBatchUpdate && batch_group_id) {
        dataToSend.batch_group_id = batch_group_id;
      }

      const response = await fetch(`/api/student/${student.student_pk_id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dataToSend),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update student");
      }

      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  // Labeled text input bound to a formData key. Keeps the many optional
  // profile fields below concise without diverging from the inline style above.
  const textField = (
    name: keyof typeof formData,
    label: string,
    inputMode?: "text" | "numeric" | "tel",
  ) => (
    <div>
      <label className={labelClassName}>{label}</label>
      <input
        type="text"
        name={name}
        inputMode={inputMode}
        value={String(formData[name] ?? "")}
        onChange={handleChange}
        className={inputClassName}
      />
    </div>
  );

  return (
    <Modal open={isOpen} onClose={onClose} className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">
          Edit Student
        </h2>
        <Button variant="icon" onClick={onClose}>
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </Button>
      </div>

      <div role="tablist" aria-label="Edit student sections" className="mb-4 flex border-b border-border">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "details"}
          onClick={() => setActiveTab("details")}
          className={`min-h-[48px] px-4 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${
            activeTab === "details"
              ? "border-b-2 border-accent text-text-primary"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "documents"}
          onClick={() => setActiveTab("documents")}
          disabled={studentPkId === null}
          className={`min-h-[48px] px-4 py-3 text-sm font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            activeTab === "documents"
              ? "border-b-2 border-accent text-text-primary"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          Documents
        </button>
      </div>

      {activeTab === "documents" && studentPkId !== null ? (
        <div className="space-y-6">
          <UploadDocumentForm
            studentId={studentPkId}
            studentName={studentName || "this student"}
            onUploaded={() => {
              // Bump the modal's own list, and also tell the parent
              // (StudentTable) so any inline DocumentsList visible elsewhere
              // refetches.
              setDocumentsRefresh((n) => n + 1);
              onSave();
            }}
          />
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
              Uploaded Documents
            </h3>
            <DocumentsList
              studentId={studentPkId}
              refreshNonce={documentsRefresh}
              onChanged={onSave}
            />
          </div>
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>First Name</label>
                <input
                  type="text"
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleChange}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={labelClassName}>Last Name</label>
                <input
                  type="text"
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleChange}
                  className={inputClassName}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Student ID</label>
                <input
                  type="text"
                  value={student.student_id || "—"}
                  disabled
                  className={`${inputClassName} bg-gray-100 text-gray-500 cursor-not-allowed`}
                />
              </div>
              <div>
                <label className={labelClassName}>APAAR ID</label>
                <input
                  type="text"
                  value={student.apaar_id || "—"}
                  disabled
                  className={`${inputClassName} bg-gray-100 text-gray-500 cursor-not-allowed`}
                />
              </div>
            </div>

            <div>
              <label className={labelClassName}>Program</label>
              <input
                type="text"
                value={student.program_name || "—"}
                disabled
                className={`${inputClassName} bg-gray-100 text-gray-500 cursor-not-allowed`}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Grade</label>
                <select
                  name="group_id"
                  value={formData.group_id}
                  onChange={handleChange}
                  className={inputClassName}
                >
                  <option value="">Select...</option>
                  {grades.map((grade) => (
                    <option key={grade.id} value={grade.group_id}>
                      Grade {grade.number}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClassName}>Date of Birth</label>
                <input
                  type="date"
                  name="date_of_birth"
                  value={formData.date_of_birth}
                  onChange={handleChange}
                  className={inputClassName}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Phone</label>
                <input
                  type="text"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={labelClassName}>Gender</label>
                <select
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  className={inputClassName}
                >
                  <option value="">Select...</option>
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Category</label>
                <select
                  name="baseCategory"
                  value={formData.baseCategory}
                  onChange={handleChange}
                  className={inputClassName}
                >
                  <option value="">Select...</option>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClassName}>Stream</label>
                <select
                  name="stream"
                  value={formData.stream}
                  onChange={handleChange}
                  className={inputClassName}
                >
                  <option value="">Select...</option>
                  {nvsStreams.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Batch selection - shown when stream or grade changes */}
            {needsBatchUpdate && batches.length > 0 && (
              <div className="bg-hover-bg border border-accent rounded-md p-4">
                <label className={`${labelClassName} text-accent-hover`}>
                  New Batch (required for {streamChanged && gradeChanged ? "stream and grade change" : streamChanged ? "stream change" : "grade change"})
                </label>
                {availableBatches.length === 0 ? (
                  <p className="mt-1 text-sm text-red-600">
                    No batch found for Grade {currentGradeNumber} + {formData.stream}.
                    Please contact admin.
                  </p>
                ) : (
                  <select
                    name="batch_group_id"
                    value={formData.batch_group_id}
                    onChange={handleChange}
                    className={`${inputClassName} mt-1`}
                  >
                    <option value="">Select batch...</option>
                    {availableBatches.map((batch) => (
                      <option key={batch.id} value={batch.group_id}>
                        {batch.name}
                      </option>
                    ))}
                  </select>
                )}
                {availableBatches.length === 1 && (
                  <p className="mt-1 text-xs text-accent">
                    Auto-selected: {availableBatches[0].name}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="isPWD"
                  checked={formData.isPWD}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
                />
                <span className={labelClassName}>
                  Person with Disability (PWD)
                </span>
              </label>
            </div>

            {/* Academic */}
            <h3 className={sectionHeadingClassName}>Academic</h3>
            <div className="grid grid-cols-2 gap-4">
              {textField("board_stream", "Board Stream")}
              {textField("school_medium", "School Medium")}
            </div>

            {/* Contact & Address */}
            <h3 className={sectionHeadingClassName}>Contact & Address</h3>
            <div className="grid grid-cols-2 gap-4">
              {textField("whatsapp_phone", "WhatsApp Number", "tel")}
              {textField("pincode", "Pincode", "numeric")}
            </div>
            {textField("address", "Address")}
            <div className="grid grid-cols-2 gap-4">
              {textField("city", "City")}
              {textField("district", "District")}
            </div>
            {textField("state", "State")}

            {/* Father */}
            <h3 className={sectionHeadingClassName}>Father</h3>
            <div className="grid grid-cols-2 gap-4">
              {textField("father_name", "Name")}
              {textField("father_phone", "Phone", "tel")}
              {textField("father_profession", "Profession")}
              {textField("father_education_level", "Education Level")}
            </div>

            {/* Mother */}
            <h3 className={sectionHeadingClassName}>Mother</h3>
            <div className="grid grid-cols-2 gap-4">
              {textField("mother_name", "Name")}
              {textField("mother_phone", "Phone", "tel")}
              {textField("mother_profession", "Profession")}
              {textField("mother_education_level", "Education Level")}
            </div>

            {/* Guardian */}
            <h3 className={sectionHeadingClassName}>Guardian</h3>
            <div className="grid grid-cols-2 gap-4">
              {textField("guardian_name", "Name")}
              {textField("guardian_relation", "Relation")}
              {textField("guardian_phone", "Phone", "tel")}
              {textField("guardian_education_level", "Education Level")}
            </div>
            {textField("guardian_profession", "Profession")}

            {/* Socio-economic */}
            <h3 className={sectionHeadingClassName}>Socio-economic</h3>
            <div className="grid grid-cols-2 gap-4">
              {textField("annual_family_income", "Annual Family Income")}
              {textField("monthly_family_income", "Monthly Family Income")}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || (needsBatchUpdate && availableBatches.length === 0)}
              >
                {loading ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>

      {/* Last Updated */}
      {student.updated_at && (
        <p className="mt-4 text-xs text-gray-400 text-right">
          Last updated: {new Date(student.updated_at).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
        </>
      )}
    </Modal>
  );
}
