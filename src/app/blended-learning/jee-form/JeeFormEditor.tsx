"use client";

import { FileText, Flag } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui";
import { baseInputClasses } from "@/components/ui/styles";
import {
  JEE_APPLICATION_NUMBER_MAX_LENGTH,
  JEE_FORM_DETAILS_MAX_LENGTH,
  JEE_FORM_EXAM,
  JEE_FORM_REASONS,
  JEE_FORM_SESSIONS,
  JEE_FORM_STATUS_LABEL,
  confirmationError,
  validateJeeForm,
  type JeeFormFieldErrors,
  type JeeFormReason,
  type JeeFormStatus,
  type JeeFormUpdate,
  type JeeFormView,
} from "@/lib/blended-learning-jee-form-input";

import { FieldError, GrowingTextarea, LABEL_CLASSES, Optional, SegmentedChoice } from "../students/[id]/log/formParts";
import { JeePasswordField } from "./JeePassword";

// The JEE form's Filled / Not filled form, opened in a JEE Form tab row.
// Filled takes the application number, the session(s) applied for (Session
// 1, Session 2 or both, as on the Exams tab; pre-filled from the exam
// record), the exam-portal password (required until one is saved, then
// optional to replace) and, optionally, the
// confirmation page PDF, and ticks the "JEE Form Filling (Reminder)" Action
// Item; Not filled takes one or more reasons (details required for Other) and
// flags the program team. The password is write-only: it is posted, never
// prefilled, and dropped with the draft.

const STATUS_OPTIONS = (Object.keys(JEE_FORM_STATUS_LABEL) as JeeFormStatus[]).map((value) => ({
  value,
  label: JEE_FORM_STATUS_LABEL[value],
}));

type Draft = {
  status: JeeFormStatus | null;
  applicationNumber: string;
  password: string;
  // A saved password is being replaced (its field is open).
  replacePassword: boolean;
  // Sorted session numbers (Filled only).
  sessions: number[];
  confirmation: File | null;
  reasons: JeeFormReason[];
  details: string;
};

function draftFrom(current: JeeFormUpdate | null, sessionsApplied: number[]): Draft {
  return {
    status: current?.status ?? null,
    applicationNumber: current?.applicationNumber ?? "",
    password: "",
    replacePassword: false,
    sessions: sessionsApplied.filter((session) => JEE_FORM_SESSIONS.includes(session)),
    confirmation: null,
    reasons: current?.reasons ?? [],
    details: current?.details ?? "",
  };
}

function confirmationHref(studentId: number): string {
  return `/api/blended-learning/students/${studentId}/jee-form/confirmation`;
}

export function ConfirmationLink({ studentId, label }: { studentId: number; label: string }) {
  return (
    <a
      href={confirmationHref(studentId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1.5 font-bold text-accent underline-offset-2 hover:text-accent-hover hover:underline sm:min-h-0"
    >
      <FileText aria-hidden="true" className="h-4 w-4" />
      {label}
    </a>
  );
}

type FieldsProps = {
  draft: Draft;
  change: (next: Partial<Draft>) => void;
  fieldErrors: JeeFormFieldErrors;
};

// "Sessions applied", worded and laid out as on the Exams tab; at least one.
function SessionChoices({ draft, change, fieldErrors }: FieldsProps) {
  function toggle(session: number) {
    const sessions = draft.sessions.includes(session)
      ? draft.sessions.filter((value) => value !== session)
      : [...draft.sessions, session].sort((a, b) => a - b);
    change({ sessions });
  }
  return (
    <fieldset className="min-w-0" aria-invalid={Boolean(fieldErrors.sessions)}>
      <legend className={LABEL_CLASSES}>Sessions applied</legend>
      <div className="flex flex-wrap gap-x-6">
        {JEE_FORM_SESSIONS.map((session) => (
          <label key={session} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text-primary">
            <input
              type="checkbox"
              name="sessions"
              value={session}
              checked={draft.sessions.includes(session)}
              onChange={() => toggle(session)}
              className="h-5 w-5 shrink-0 accent-accent"
            />
            Session {session}
          </label>
        ))}
      </div>
      <FieldError message={fieldErrors.sessions} />
    </fieldset>
  );
}

function FilledFields({
  draft,
  change,
  fieldErrors,
  openReminder,
  confirmationOf,
  studentId,
  passwordSaved,
}: FieldsProps & { openReminder: string | null; confirmationOf: number | null; studentId: number; passwordSaved: boolean }) {
  const numberId = useId();
  const fileId = useId();
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={numberId} className={LABEL_CLASSES}>
          Application number
        </label>
        <input
          id={numberId}
          value={draft.applicationNumber}
          onChange={(event) => change({ applicationNumber: event.target.value })}
          maxLength={JEE_APPLICATION_NUMBER_MAX_LENGTH}
          autoComplete="off"
          inputMode="numeric"
          required
          aria-invalid={Boolean(fieldErrors.applicationNumber)}
          className={`block w-full max-w-sm bg-bg-input font-mono ${baseInputClasses}`}
        />
        <FieldError message={fieldErrors.applicationNumber} />
      </div>
      <SessionChoices draft={draft} change={change} fieldErrors={fieldErrors} />
      <JeePasswordField
        studentId={studentId}
        passwordSaved={passwordSaved}
        value={draft.password}
        replacing={draft.replacePassword}
        error={fieldErrors.password}
        onChange={(password) => change({ password })}
        onReplace={(replacePassword) => change({ replacePassword, password: "" })}
      />
      <div>
        <label htmlFor={fileId} className={LABEL_CLASSES}>
          Confirmation page <Optional />
        </label>
        {/* The Student whose saved confirmation page can be opened, if any. */}
        {confirmationOf !== null && (
          <p className="mb-1 text-sm text-text-secondary">
            Saved: <ConfirmationLink studentId={confirmationOf} label="View PDF" />
          </p>
        )}
        <input
          id={fileId}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => change({ confirmation: event.target.files?.[0] ?? null })}
          className="block w-full max-w-sm text-sm text-text-secondary file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-2 file:border-border file:bg-bg-card file:px-3 file:text-sm file:font-bold file:text-text-primary hover:file:bg-hover-bg"
        />
        <p className="mt-1 text-xs text-text-muted">PDF, up to 5 MB.</p>
        <FieldError message={fieldErrors.confirmation} />
      </div>
      {openReminder !== null && (
        <p className="text-sm text-text-secondary">Saving ticks the student&apos;s “{openReminder}” action item.</p>
      )}
    </div>
  );
}

function ReasonChoices({ draft, change, fieldErrors }: FieldsProps) {
  function toggle(reason: JeeFormReason) {
    const reasons = draft.reasons.includes(reason)
      ? draft.reasons.filter((value) => value !== reason)
      : [...draft.reasons, reason];
    change({ reasons });
  }
  return (
    <fieldset className="min-w-0">
      <legend className={LABEL_CLASSES}>Why hasn&apos;t it been filled?</legend>
      <p className="-mt-0.5 mb-2 text-xs text-text-muted">Choose all that apply.</p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {JEE_FORM_REASONS.map((reason) => (
          <label key={reason.value} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text-primary">
            <input
              type="checkbox"
              name="reasons"
              value={reason.value}
              checked={draft.reasons.includes(reason.value)}
              onChange={() => toggle(reason.value)}
              className="h-5 w-5 shrink-0 accent-accent"
            />
            {reason.label}
          </label>
        ))}
      </div>
      <FieldError message={fieldErrors.reasons} />
    </fieldset>
  );
}

function NotFilledFields({ draft, change, fieldErrors }: FieldsProps) {
  const detailsId = useId();
  const otherChosen = draft.reasons.includes("other");
  return (
    <div className="space-y-4">
      <ReasonChoices draft={draft} change={change} fieldErrors={fieldErrors} />
      <div>
        <label htmlFor={detailsId} className={LABEL_CLASSES}>
          Details {!otherChosen && <Optional />}
        </label>
        <GrowingTextarea
          id={detailsId}
          value={draft.details}
          onChange={(event) => change({ details: event.target.value })}
          maxLength={JEE_FORM_DETAILS_MAX_LENGTH}
          required={otherChosen}
          aria-invalid={Boolean(fieldErrors.details)}
          placeholder={otherChosen ? "What is the other reason?" : "Anything the program team should know"}
          className="bg-bg-input"
        />
        <FieldError message={fieldErrors.details} />
      </div>
      <p className="flex items-center gap-2 text-sm text-text-secondary">
        <Flag aria-hidden="true" className="h-4 w-4 shrink-0 text-warning-text" />
        Saving flags this to the program team.
      </p>
    </div>
  );
}

function clientErrors(draft: Draft, passwordSaved: boolean): JeeFormFieldErrors | null {
  const validated = validateJeeForm(draft, { requirePassword: !passwordSaved });
  const errors: JeeFormFieldErrors = validated.ok ? {} : { ...validated.fieldErrors };
  if (draft.status === "filled" && draft.confirmation) {
    const error = confirmationError(draft.confirmation);
    if (error) errors.confirmation = error;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

function formBody(draft: Draft): FormData {
  const body = new FormData();
  body.set("status", draft.status ?? "");
  if (draft.status === "filled") {
    body.set("applicationNumber", draft.applicationNumber);
    // Blank keeps the saved password, so it isn't sent.
    if (draft.password.trim()) body.set("password", draft.password);
    for (const session of draft.sessions) body.append("sessions", String(session));
    if (draft.confirmation) body.set("confirmation", draft.confirmation);
  } else {
    for (const reason of draft.reasons) body.append("reasons", reason);
    body.set("details", draft.details);
  }
  return body;
}

type SaveOutcome = { ok: true; form: JeeFormView } | { ok: false; error?: string; fieldErrors?: JeeFormFieldErrors };

async function postJeeForm(studentId: number, draft: Draft): Promise<SaveOutcome> {
  try {
    const response = await fetch(`/api/blended-learning/students/${studentId}/jee-form`, {
      method: "POST",
      body: formBody(draft),
    });
    const data = (await response.json().catch(() => ({}))) as {
      form?: JeeFormView;
      error?: string;
      fieldErrors?: JeeFormFieldErrors;
    };
    if (response.ok && data.form) return { ok: true, form: data.form };
    if (data.fieldErrors) return { ok: false, fieldErrors: data.fieldErrors };
    return { ok: false, error: data.error ?? "Couldn't save. Try again." };
  } catch {
    return { ok: false, error: "Couldn't save. Check your connection and try again." };
  }
}

function FormActions({ show, saving, onCancel }: { show: boolean; saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {show && (
        <Button type="submit" size="md" disabled={saving} className="px-5">
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
      <Button type="button" variant="secondary" size="md" disabled={saving} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

// The form, prefilled from what is saved. `onSaved` gets the Student's form
// as the server now reads it.
export function JeeFormEditor({
  studentId,
  current,
  passwordSaved,
  sessionsApplied,
  openReminder,
  onCancel,
  onSaved,
}: {
  studentId: number;
  current: JeeFormUpdate | null;
  passwordSaved: boolean;
  // The exam record's saved sessions, to pre-fill.
  sessionsApplied: number[];
  // The open reminder's text (as the program team named it), or null.
  openReminder: string | null;
  onCancel: () => void;
  onSaved: (form: JeeFormView) => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(current, sessionsApplied));
  const [fieldErrors, setFieldErrors] = useState<JeeFormFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = useId();

  function change(next: Partial<Draft>) {
    setDraft((value) => ({ ...value, ...next }));
    setFieldErrors((value) => {
      const kept = { ...value };
      for (const key of Object.keys(next)) delete kept[key as keyof JeeFormFieldErrors];
      return kept;
    });
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const errors = clientErrors(draft, passwordSaved);
    if (errors) {
      setFieldErrors(errors);
      return;
    }
    setSaving(true);
    setError(null);
    const outcome = await postJeeForm(studentId, draft);
    setSaving(false);
    if (outcome.ok) onSaved(outcome.form);
    else if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
    else setError(outcome.error ?? null);
  }

  const confirmationOf = current?.status === "filled" && current.hasConfirmation ? studentId : null;
  return (
    <form onSubmit={save} noValidate className="space-y-5" aria-label={`${JEE_FORM_EXAM.label} form status`}>
      <SegmentedChoice
        legend="Has the student filled the form?"
        name={name}
        options={STATUS_OPTIONS}
        value={draft.status}
        onChange={(status) => change({ status })}
        error={fieldErrors.status}
      />
      {draft.status === "filled" && (
        <FilledFields
          draft={draft}
          change={change}
          fieldErrors={fieldErrors}
          openReminder={openReminder}
          confirmationOf={confirmationOf}
          studentId={studentId}
          passwordSaved={passwordSaved}
        />
      )}
      {draft.status === "not_filled" && <NotFilledFields draft={draft} change={change} fieldErrors={fieldErrors} />}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <FormActions show={draft.status !== null} saving={saving} onCancel={onCancel} />
    </form>
  );
}
