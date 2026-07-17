"use client";

import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { X } from "lucide-react";

import { Button, FormSection, Input, Modal, Select } from "@/components/ui";
import {
  ANNUAL_FAMILY_INCOME_OPTIONS,
  BOARD_STREAM_OPTIONS,
  CATEGORY_OPTIONS,
  CBSE_BOARD,
  G10_ROLL_MAX_LENGTH,
  G10_ROLL_MIN_LENGTH,
  G10_BOARD_OPTIONS,
  STUDENT_ADDITION_GENDER_OPTIONS,
  STREAM_OPTIONS,
  STUDENT_DOB_MAX,
  STUDENT_DOB_MIN,
  formatStudentAdditionExistingMatch,
  validateStudentAdditionInput,
  type StudentAdditionInput,
} from "@/lib/student-addition-fields";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";

interface AddStudentModalProps {
  open: boolean;
  schoolUdise: string;
  schoolCode: string;
  onClose: () => void;
  onCreated: (studentId: string | null, penNumber: string | null) => void;
}

const initialForm: Record<keyof StudentAdditionInput, string> = {
  grade: "",
  student_name: "",
  date_of_birth: "",
  gender: "",
  category: "",
  physically_handicapped: "",
  apaar_id: "",
  pen_number: "",
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

function rollCharactersOnly(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}

// fallow-ignore-next-line complexity
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
  const [serviceFieldErrors, setServiceFieldErrors] = useState<Record<string, string>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const validation = useMemo(
    () => validateStudentAdditionInput(form, {
      academicYear: deriveLmsEnrollmentPeriod().academic_year,
    }),
    [form],
  );
  const canSubmit = validation.ok && !submitting;

  useEffect(() => {
    if (!open) {
      setForm(initialForm);
      setTouched({});
      setError(null);
      setServiceFieldErrors({});
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (error) scrollContainerRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
  }, [error]);

  const setField = (name: keyof StudentAdditionInput, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "phone") next.phone = digitsOnly(value).replace(/^0+/, "").slice(0, 10);
      if (name === "pen_number") next.pen_number = digitsOnly(value).slice(0, 11);
      if (name === "father_name") next.father_name = lettersAndSpacesOnly(value);
      if (name === "g10_roll_no") {
        next.g10_roll_no = prev.g10_board === CBSE_BOARD
          ? digitsOnly(value).replace(/^0+/, "").slice(0, 8)
          : rollCharactersOnly(value).slice(0, G10_ROLL_MAX_LENGTH);
      }
      return next;
    });
    setTouched((prev) => ({
      ...prev,
      [name]: true,
      ...(name === "g10_board" && value === CBSE_BOARD && form.g10_roll_no ? { g10_roll_no: true } : {}),
    }));
    setError(null);
    setServiceFieldErrors({});
  };

  const touchField = (name: keyof StudentAdditionInput) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const normalizedName = validation.row.student_name;
    if (name === "student_name" && normalizedName && !form.student_name.includes(".")) {
      setForm((prev) => ({ ...prev, student_name: normalizedName }));
    }
  };

  const fieldError = (name: keyof StudentAdditionInput) =>
    serviceFieldErrors[name] ?? (touched[name] ? validation.fieldErrors[name] : undefined);

  const identityError =
    touched.pen_number || touched.g10_roll_no ? validation.rowErrors[0] : undefined;

  const errorClassName = "border-danger focus:border-danger focus:ring-danger/20";
  const renderLabel = (label: string, required = false) => (
    <>
      {label}
      {required && (
        <span aria-hidden="true" className="text-danger">
          {" *"}
        </span>
      )}
    </>
  );
  const renderConditionalLabel = (label: string) => (
    <>
      {label}
      <span aria-hidden="true" className="text-accent">
        {" #"}
      </span>
    </>
  );

  const inputField = (
    name: keyof StudentAdditionInput,
    label: string,
    type = "text",
    inputMode?: "text" | "numeric" | "tel",
    required = false,
    inputProps: InputHTMLAttributes<HTMLInputElement> = {},
    conditional = false,
  ) => {
    const errorText = fieldError(name);
    const errorId = `${name}-error`;
    return (
      <div>
        <label htmlFor={name} className={labelClassName}>
          {conditional ? renderConditionalLabel(label) : renderLabel(label, required)}
        </label>
        <Input
          id={name}
          name={name}
          aria-label={label}
          type={type}
          inputMode={inputMode}
          value={form[name]}
          onChange={(event) => setField(name, event.target.value)}
          onBlur={() => touchField(name)}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={errorText ? errorId : undefined}
          className={errorText ? errorClassName : ""}
          {...inputProps}
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
    required = false,
  ) => {
    const errorText = fieldError(name);
    const errorId = `${name}-error`;
    return (
      <div>
        <label htmlFor={name} className={labelClassName}>{renderLabel(label, required)}</label>
        <Select
          id={name}
          name={name}
          aria-label={label}
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

  const g10BoardField = () => {
    const errorText = fieldError("g10_board");
    const errorId = "g10_board-error";
    return (
      <div>
        <label htmlFor="g10_board" className={labelClassName}>{renderLabel("G10 board", true)}</label>
        <Select
          id="g10_board"
          name="g10_board"
          aria-label="G10 board"
          value={form.g10_board}
          onChange={(event) => setField("g10_board", event.target.value)}
          onBlur={() => touchField("g10_board")}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={errorText ? errorId : undefined}
          className={`w-full ${errorText ? errorClassName : ""}`}
        >
          <option value="">Select...</option>
          {G10_BOARD_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
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

  const g10RollField = () => {
    const isCbseBoard = form.g10_board === CBSE_BOARD;
    const errorText = fieldError("g10_roll_no");
    const errorId = "g10_roll_no-error";
    const helpId = "g10_roll_no-help";
    return (
      <div>
        <label htmlFor="g10_roll_no" className={labelClassName}>
          {renderConditionalLabel("Grade 10 Roll no")}
        </label>
        <Input
          id="g10_roll_no"
          name="g10_roll_no"
          aria-label="Grade 10 Roll no"
          type="text"
          inputMode={isCbseBoard ? "numeric" : "text"}
          minLength={isCbseBoard ? 8 : G10_ROLL_MIN_LENGTH}
          maxLength={isCbseBoard ? 8 : G10_ROLL_MAX_LENGTH}
          disabled={!form.g10_board}
          value={form.g10_roll_no}
          onChange={(event) => setField("g10_roll_no", event.target.value)}
          onBlur={() => touchField("g10_roll_no")}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={errorText ? `${helpId} ${errorId}` : helpId}
          className={errorText ? errorClassName : ""}
        />
        <p id={helpId} className="mt-1 text-xs text-text-muted">
          {isCbseBoard
            ? "CBSE: enter exactly 8 digits."
            : `Enter ${G10_ROLL_MIN_LENGTH} to ${G10_ROLL_MAX_LENGTH} characters.`}
        </p>
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
    if (form.pen_number.trim() && !form.g10_roll_no.trim()) {
      return "PEN-only: no Student ID will be generated.";
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
      const result = body.results?.[0];
      if (result?.status === "already_exists") {
        setError(formatStudentAdditionExistingMatch(result.existing_match, schoolCode));
        return;
      }
      if (result?.status === "rejected") {
        const fieldErrors = result.field_errors ?? {};
        setServiceFieldErrors(fieldErrors);
        setError([...(result.row_errors ?? []), ...Object.values(fieldErrors)][0] || "Student was rejected");
        return;
      }
      if (!response.ok) {
        const rejected = body.results?.[0];
        const fieldErrors = body.field_errors ?? rejected?.field_errors ?? {};
        setServiceFieldErrors(fieldErrors);
        throw new Error(
          Object.values(fieldErrors)[0] as string ||
          body.row_errors?.[0] ||
          rejected?.row_errors?.[0] ||
          body.error ||
          "Failed to add student",
        );
      }

      if (result?.status === "created") {
        onCreated(
          result.generated_student_id ?? result.normalized?.student_id ?? null,
          form.pen_number.trim() || null,
        );
        onClose();
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
        </div>
        <Button type="button" variant="icon" onClick={onClose} aria-label="Close add student">
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollContainerRef} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
              {error}
            </div>
          )}

          <FormSection>
            <h3 className="text-sm font-semibold text-text-primary">Student Details</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {inputField("student_name", "Student Name", "text", "text", true)}
              {inputField("date_of_birth", "Date of Birth", "date", undefined, true, {
                min: STUDENT_DOB_MIN,
                max: STUDENT_DOB_MAX,
              })}
              {selectField("grade", "Grade", ["11", "12"], "Select...", true)}
              {selectField("gender", "Gender", STUDENT_ADDITION_GENDER_OPTIONS, "Select...", true)}
              {selectField("category", "Category", CATEGORY_OPTIONS, "Select...", true)}
              {selectField("physically_handicapped", "CWSN", ["Yes", "No"], "Select...", true)}
              {inputField("pen_number", "PEN", "text", "numeric", false, { maxLength: 11 }, true)}
            </div>
          </FormSection>

          <FormSection>
            <h3 className="text-sm font-semibold text-text-primary">Grade 10 Info</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {g10BoardField()}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)]">
                {g10RollField()}
                <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-text-primary">
                  {identityMessage}
                </div>
              </div>
            </div>
            {identityError && (
              <p className="text-xs text-danger">
                {identityError}
              </p>
            )}
          </FormSection>

          <FormSection>
            <h3 className="text-sm font-semibold text-text-primary">Stream</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {selectField("board_stream", "Board Stream", BOARD_STREAM_OPTIONS, "Select...", true)}
              {selectField("stream", "Primary Exam preparing for", STREAM_OPTIONS, "Select...", true)}
            </div>
          </FormSection>

          <FormSection>
            <h3 className="text-sm font-semibold text-text-primary">Family Details</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {inputField("father_name", "Father Name")}
              {inputField("phone", "Parents Phone Number", "text", "tel", true)}
              {selectField("annual_family_income", "Yearly / Annual Family Income", ANNUAL_FAMILY_INCOME_OPTIONS)}
            </div>
          </FormSection>

          <p className="text-xs text-text-muted">
            <span className="text-danger">*</span> Mandatory fields.{" "}
            <span className="text-accent">#</span> Either PEN or Grade 10 Roll no is compulsory.
          </p>
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
