"use client";

import { useState } from "react";
import { type Grade, type Student } from "./StudentTable";
import { Modal, Button, FormSection } from "@/components/ui";
import { UploadDocumentForm } from "@/components/documents/UploadDocumentForm";
import { DocumentsList } from "@/components/documents/DocumentsList";
import {
  ANNUAL_FAMILY_INCOME_OPTIONS,
  BOARD_STREAM_OPTIONS,
  CATEGORY_OPTIONS,
  G10_BOARD_OPTIONS,
  GENDER_OPTIONS,
} from "@/lib/student-addition-fields";

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

const STREAM_OPTIONS = [
  { value: "engineering", label: "Engineering" },
  { value: "medical", label: "Medical" },
  { value: "ca", label: "CA" },
  { value: "clat", label: "CLAT" },
] as const;

function formatDateForInput(dateString: string | null): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch {
    return "";
  }
}

function legacyPwdCategory(category: string | null) {
  if (!category?.startsWith("PWD-")) return { category: category || "", pwd: false };
  const value = category.replace("PWD-", "");
  return { category: value === "General" ? "Gen" : value, pwd: true };
}

const inputClassName =
  "mt-1 block w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:bg-bg-card-alt disabled:text-text-muted transition-colors";
const labelClassName = "block text-sm font-medium text-text-secondary";
const sectionHeadingClassName = "mb-4 text-sm font-semibold text-text-primary";
const errorClassName = "mt-1 text-xs text-danger";

export default function EditStudentModal({
  student,
  isOpen,
  onClose,
  onSave,
  grades,
}: EditStudentModalProps) {
  const legacyCategory = legacyPwdCategory(student.category);
  const [formData, setFormData] = useState({
    first_name: student.first_name || "",
    phone: student.phone || "",
    gender: student.gender || "",
    date_of_birth: formatDateForInput(student.date_of_birth),
    category: legacyCategory.category,
    physically_handicapped: Boolean(student.physically_handicapped ?? legacyCategory.pwd),
    stream: student.stream || "",
    board_stream: student.board_stream || "",
    father_name: student.father_name || "",
    annual_family_income: student.annual_family_income || "",
    g10_board: student.g10_board || "",
    grade: student.grade ? String(student.grade) : "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"details" | "documents">("details");
  const [documentsRefresh, setDocumentsRefresh] = useState(0);

  const studentName = [student.first_name, student.last_name].filter(Boolean).join(" ").trim();
  const studentPkId = (() => {
    const raw = student.student_pk_id;
    if (!raw || !/^\d+$/.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setLoading(true);

    if (!student.student_pk_id) {
      setError("Cannot update student: missing student record ID");
      setLoading(false);
      return;
    }

    if (formData.phone && !/^\d{10}$/.test(formData.phone.replace(/\s/g, ""))) {
      setError("Parents Phone Number must be exactly 10 digits");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/student/${student.student_pk_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: formData.first_name,
          phone: formData.phone,
          gender: formData.gender,
          date_of_birth: formData.date_of_birth,
          category: formData.category,
          physically_handicapped: formData.physically_handicapped,
          stream: formData.stream,
          board_stream: formData.board_stream,
          father_name: formData.father_name,
          annual_family_income: formData.annual_family_income,
          g10_board: formData.g10_board,
          grade: formData.grade ? Number(formData.grade) : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setFieldErrors(data.field_errors ?? {});
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
      setFormData((prev) => ({
        ...prev,
        [name]: (e.target as HTMLInputElement).checked,
      }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

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
      {fieldErrors[name] && <p className={errorClassName}>{fieldErrors[name]}</p>}
    </div>
  );

  const selectField = (
    name: keyof typeof formData,
    label: string,
    options: readonly string[] | ReadonlyArray<{ value: string; label: string }>,
  ) => {
    const current = String(formData[name] ?? "");
    const values = options.map((option) =>
      typeof option === "string" ? option : option.value,
    );
    const opts =
      current && !values.includes(current)
        ? [{ value: current, label: current }, ...options]
        : options;

    return (
      <div>
        <label className={labelClassName}>{label}</label>
        <select
          name={name}
          value={current}
          onChange={handleChange}
          className={inputClassName}
        >
          <option value="">Select...</option>
          {opts.map((option) => {
            const value = typeof option === "string" ? option : option.value;
            const labelText = typeof option === "string" ? option : option.label;
            return (
              <option key={value} value={value}>
                {labelText}
              </option>
            );
          })}
        </select>
        {fieldErrors[name] && <p className={errorClassName}>{fieldErrors[name]}</p>}
      </div>
    );
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden p-0"
    >
      <div className="flex items-start justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">Edit Student</h2>
          {studentName && <p className="mt-0.5 text-sm text-text-muted">{studentName}</p>}
        </div>
        <Button variant="icon" onClick={onClose} aria-label="Close edit modal">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Button>
      </div>

      <div role="tablist" aria-label="Edit student sections" className="flex border-b border-border px-6">
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
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <UploadDocumentForm
            studentId={studentPkId}
            studentName={studentName || "this student"}
            onUploaded={() => {
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
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {error && (
              <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
                {error}
              </div>
            )}

            <FormSection>
              <h3 className={sectionHeadingClassName}>Student Details</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {textField("first_name", "Student Name")}
                <div>
                  <label className={labelClassName}>Date of Birth</label>
                  <input
                    type="date"
                    name="date_of_birth"
                    value={formData.date_of_birth}
                    onChange={handleChange}
                    className={inputClassName}
                  />
                  {fieldErrors.date_of_birth && (
                    <p className={errorClassName}>{fieldErrors.date_of_birth}</p>
                  )}
                </div>
                {selectField("gender", "Gender", GENDER_OPTIONS)}
                {selectField("category", "Category", CATEGORY_OPTIONS)}
                <label className="mt-6 flex w-fit cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    name="physically_handicapped"
                    checked={formData.physically_handicapped}
                    onChange={handleChange}
                    className="h-4 w-4 rounded border-2 border-border text-accent focus:ring-accent/20"
                  />
                  <span className={labelClassName}>Physical Handicapped / Vikalang</span>
                </label>
                {textField("phone", "Parents Phone Number", "tel")}
                {textField("father_name", "Father Name")}
                {selectField(
                  "annual_family_income",
                  "Yearly / Annual Family Income",
                  ANNUAL_FAMILY_INCOME_OPTIONS,
                )}
              </div>
            </FormSection>

            <FormSection>
              <h3 className={sectionHeadingClassName}>Academic</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {selectField(
                  "grade",
                  "Grade",
                  grades
                    .filter((grade) => grade.number === 11 || grade.number === 12)
                    .map((grade) => ({
                      value: String(grade.number),
                      label: `Grade ${grade.number}`,
                    })),
                )}
                {selectField("stream", "Primary Exam preparing for", STREAM_OPTIONS)}
                {selectField("board_stream", "Board Stream", BOARD_STREAM_OPTIONS)}
                {selectField("g10_board", "G10 board", G10_BOARD_OPTIONS)}
              </div>
            </FormSection>

            <FormSection>
              <h3 className={sectionHeadingClassName}>Locked Identity</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div>
                  <label className={labelClassName}>Student ID</label>
                  <input type="text" value={student.student_id || "—"} disabled className={inputClassName} />
                </div>
                <div>
                  <label className={labelClassName}>APAAR ID</label>
                  <input type="text" value={student.apaar_id || "—"} disabled className={inputClassName} />
                </div>
                <div>
                  <label className={labelClassName}>Grade 10 Roll no</label>
                  <input type="text" value={student.g10_roll_no || "—"} disabled className={inputClassName} />
                </div>
                <div>
                  <label className={labelClassName}>Program</label>
                  <input type="text" value={student.program_name || "—"} disabled className={inputClassName} />
                </div>
              </div>
            </FormSection>

            {student.updated_at && (
              <p className="text-right text-xs text-text-muted">
                Last updated: {new Date(student.updated_at).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
