"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { Button, FormSection, Input, Modal, Select } from "@/components/ui";
import {
  ANNUAL_FAMILY_INCOME_OPTIONS,
  BOARD_STREAM_OPTIONS,
  CATEGORY_OPTIONS,
  CBSE_BOARD,
  G10_BOARD_OPTIONS,
  GENDER_OPTIONS,
  STREAM_OPTIONS,
  formatStudentAdditionExistingMatch,
  validateStudentAdditionInput,
  type StudentAdditionInput,
} from "@/lib/student-addition-fields";

interface AddStudentModalProps {
  open: boolean;
  schoolUdise: string;
  schoolCode: string;
  onClose: () => void;
  onCreated: () => void;
}

const initialForm: Record<keyof StudentAdditionInput, string> = {
  grade: "",
  student_name: "",
  date_of_birth: "",
  gender: "",
  category: "",
  physically_handicapped: "",
  apaar_id: "",
  g10_board: "",
  g10_roll_no: "",
  board_stream: "",
  stream: "",
  father_name: "",
  phone: "",
  annual_family_income: "",
};

const labelClassName = "block text-sm font-medium text-text-secondary";

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

function lettersAndSpacesOnly(value: string) {
  return value.replace(/[^A-Za-z ]+/g, "");
}

export default function AddStudentModal({
  open,
  schoolUdise,
  schoolCode,
  onClose,
  onCreated,
}: AddStudentModalProps) {
  const [form, setForm] = useState(initialForm);
  const [touched, setTouched] = useState<Partial<Record<keyof StudentAdditionInput, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => validateStudentAdditionInput(form), [form]);
  const canSubmit = validation.ok && !submitting;

  const setField = (name: keyof StudentAdditionInput, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "phone" || name === "apaar_id") next[name] = digitsOnly(value);
      if (name === "father_name") next.father_name = lettersAndSpacesOnly(value);
      if (name === "g10_roll_no" && prev.g10_board === CBSE_BOARD) next.g10_roll_no = digitsOnly(value);
      if (name === "g10_board" && value === CBSE_BOARD) next.g10_roll_no = digitsOnly(prev.g10_roll_no);
      return next;
    });
    setTouched((prev) => ({ ...prev, [name]: true }));
    setError(null);
  };

  const touchField = (name: keyof StudentAdditionInput) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const fieldError = (name: keyof StudentAdditionInput) =>
    touched[name] ? validation.fieldErrors[name] : undefined;

  const identityError =
    touched.apaar_id || touched.g10_roll_no ? validation.rowErrors[0] : undefined;

  const errorClassName = "border-danger focus:border-danger focus:ring-danger/20";

  const inputField = (
    name: keyof StudentAdditionInput,
    label: string,
    type = "text",
    inputMode?: "text" | "numeric" | "tel",
  ) => {
    const errorText = fieldError(name);
    const errorId = `${name}-error`;
    return (
      <div>
        <label htmlFor={name} className={labelClassName}>{label}</label>
        <Input
          id={name}
          name={name}
          type={type}
          inputMode={inputMode}
          value={form[name]}
          onChange={(event) => setField(name, event.target.value)}
          onBlur={() => touchField(name)}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={errorText ? errorId : undefined}
          className={errorText ? errorClassName : ""}
        />
        {errorText && (
          <p id={errorId} className="mt-1 text-xs text-danger">
            {errorText}
          </p>
        )}
      </div>
    );
  };

  const selectField = (
    name: keyof StudentAdditionInput,
    label: string,
    options: readonly string[],
    placeholder = "Select...",
  ) => {
    const errorText = fieldError(name);
    const errorId = `${name}-error`;
    return (
      <div>
        <label htmlFor={name} className={labelClassName}>{label}</label>
        <Select
          id={name}
          name={name}
          value={form[name]}
          onChange={(event) => setField(name, event.target.value)}
          onBlur={() => touchField(name)}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={errorText ? errorId : undefined}
          className={`w-full ${errorText ? errorClassName : ""}`}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        {errorText && (
          <p id={errorId} className="mt-1 text-xs text-danger">
            {errorText}
          </p>
        )}
      </div>
    );
  };

  const identityMessage = (() => {
    if (validation.generatedStudentId) {
      return `Student ID will be ${validation.generatedStudentId}`;
    }
    if (form.apaar_id.trim() && !form.g10_roll_no.trim()) {
      return "APAAR-only: no Student ID will be generated.";
    }
    return "Student ID is generated as G12 passing year + Grade 10 Roll no.";
  })();

  // fallow-ignore-next-line complexity
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validation.ok) {
      setError([...Object.values(validation.fieldErrors), ...validation.rowErrors][0] ?? "Check the form fields");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/school/${encodeURIComponent(schoolUdise)}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.details || body.error || "Failed to add student");

      const result = body.results?.[0];
      if (result?.status === "created") {
        onCreated();
        onClose();
      } else if (result?.status === "already_exists") {
        setError(formatStudentAdditionExistingMatch(result.existing_match, schoolCode));
      } else if (result?.status === "rejected") {
        setError([...(result.row_errors ?? []), ...Object.values(result.field_errors ?? {})][0] || "Student was rejected");
      } else {
        setError("Student was not created");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add student");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // fallow-ignore-next-line code-duplication
    <Modal open={open} onClose={onClose} className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden p-0">
      <div className="flex items-start justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">Add Student</h2>
          <p className="mt-1 text-sm text-text-muted">JNV NVS lateral entry</p>
        </div>
        <Button type="button" variant="icon" onClick={onClose} aria-label="Close add student">
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
              {error}
            </div>
          )}

          <FormSection>
            <h3 className="text-sm font-semibold text-text-primary">Student Details</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {selectField("grade", "Grade", ["11", "12"])}
              {inputField("student_name", "Student Name")}
              {inputField("date_of_birth", "Date of Birth", "date")}
              {selectField("gender", "Gender", GENDER_OPTIONS)}
              {selectField("category", "Category", CATEGORY_OPTIONS)}
              {selectField("physically_handicapped", "Physical Handicapped", ["Yes", "No"])}
              {inputField("phone", "Parents Phone Number", "text", "tel")}
              {inputField("father_name", "Father Name")}
              {selectField("annual_family_income", "Yearly / Annual Family Income", ANNUAL_FAMILY_INCOME_OPTIONS, "Optional")}
            </div>
          </FormSection>

          <FormSection>
            <h3 className="text-sm font-semibold text-text-primary">Identity</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {inputField("apaar_id", "APAAR ID", "text", "numeric")}
              {selectField("g10_board", "G10 board", G10_BOARD_OPTIONS)}
              {inputField("g10_roll_no", "Grade 10 Roll no")}
              {selectField("board_stream", "Board Stream", BOARD_STREAM_OPTIONS)}
              {selectField("stream", "Primary Exam preparing for", STREAM_OPTIONS)}
            </div>
            <p className="rounded-md bg-bg-card-alt px-3 py-2 text-sm text-text-secondary">
              {identityMessage}
            </p>
            {identityError && (
              <p className="text-xs text-danger">
                {identityError}
              </p>
            )}
          </FormSection>
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? "Adding..." : "Add Student"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
