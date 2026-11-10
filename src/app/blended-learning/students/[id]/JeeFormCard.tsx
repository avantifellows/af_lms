"use client";

import { CheckCircle2, FileText, Flag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { Badge, Button, Card } from "@/components/ui";
import { baseInputClasses } from "@/components/ui/styles";
import { formatCalendarDate } from "@/lib/blended-learning-format";
import {
  JEE_APPLICATION_NUMBER_MAX_LENGTH,
  JEE_FORM_DETAILS_MAX_LENGTH,
  JEE_FORM_EXAM,
  JEE_FORM_REASONS,
  JEE_FORM_STATUS_LABEL,
  confirmationError,
  jeeFormReasonLabel,
  validateJeeForm,
  type JeeFormFieldErrors,
  type JeeFormReason,
  type JeeFormStatus,
  type JeeFormUpdate,
  type JeeFormView,
  type JeeReminderItem,
} from "@/lib/blended-learning-jee-form-input";

import { FieldError, GrowingTextarea, LABEL_CLASSES, Optional, SegmentedChoice } from "./log/formParts";

// The JEE form card on a Mentee's page: has the Student filled the JEE Main
// 2027 form? "Not recorded yet" until someone records it. Filled takes the
// application number and, optionally, the confirmation page PDF, and ticks
// the "JEE Form Filling (Reminder)" Action Item; Not filled takes one or more
// reasons (details required for Other) and flags the program team. The
// status can be changed later; earlier updates stay listed under it.
// The Mentor and Blended Learning Admins record it; read-only viewers see it.
// There is no password row yet: a write-only one is planned (see SavedFilled).

const STATUS_OPTIONS = (Object.keys(JEE_FORM_STATUS_LABEL) as JeeFormStatus[]).map((value) => ({
  value,
  label: JEE_FORM_STATUS_LABEL[value],
}));

type Draft = {
  status: JeeFormStatus | null;
  applicationNumber: string;
  confirmation: File | null;
  reasons: JeeFormReason[];
  details: string;
};

function draftFrom(current: JeeFormUpdate | null): Draft {
  return {
    status: current?.status ?? null,
    applicationNumber: current?.applicationNumber ?? "",
    confirmation: null,
    reasons: current?.reasons ?? [],
    details: current?.details ?? "",
  };
}

function StatusBadge({ current }: { current: JeeFormUpdate | null }) {
  if (!current) return <Badge>Not recorded yet</Badge>;
  return current.status === "filled" ? (
    <Badge className="bg-success-bg font-bold text-success">Filled</Badge>
  ) : (
    <Badge className="bg-warning-bg font-bold text-warning-text">Not filled</Badge>
  );
}

// One label/value row of a saved status.
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-bold uppercase tracking-wide text-text-muted sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-text-primary">{children}</dd>
    </div>
  );
}

function ReminderItems({ items }: { items: JeeReminderItem[] }) {
  if (items.length === 0) return null;
  return (
    <Row label="Reminder">
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-2">
            <span className={item.status === "done" ? "text-text-muted line-through" : ""}>{item.text}</span>
            {item.status === "done" ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-success">
                <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                Done
              </span>
            ) : (
              <span className="text-xs font-bold text-accent">Open</span>
            )}
          </li>
        ))}
      </ul>
    </Row>
  );
}

function SavedFilled({ studentId, update, reminderItems }: { studentId: number; update: JeeFormUpdate; reminderItems: JeeReminderItem[] }) {
  return (
    <dl className="space-y-3">
      <Row label="Application number">
        <span className="font-mono">{update.applicationNumber}</span>
      </Row>
      {/* A write-only application password row goes here once it is stored encrypted. */}
      <Row label="Confirmation page">
        {update.hasConfirmation ? (
          <a
            href={`/api/blended-learning/students/${studentId}/jee-form/confirmation`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 font-bold text-accent underline-offset-2 hover:text-accent-hover hover:underline sm:min-h-0"
          >
            <FileText aria-hidden="true" className="h-4 w-4" />
            View PDF
          </a>
        ) : (
          <span className="text-text-secondary">Not uploaded</span>
        )}
      </Row>
      <ReminderItems items={reminderItems} />
    </dl>
  );
}

function SavedNotFilled({ update }: { update: JeeFormUpdate }) {
  return (
    <div className="space-y-3">
      <dl className="space-y-3">
        <Row label="Reasons">
          <ul aria-label="Reasons" className="flex flex-wrap gap-1.5">
            {update.reasons.map((reason) => (
              <li key={reason} className="rounded-md bg-bg-card-alt px-2 py-0.5 text-sm text-text-primary">
                {jeeFormReasonLabel(reason)}
              </li>
            ))}
          </ul>
        </Row>
        {update.details && (
          <Row label="Details">
            <p className="whitespace-pre-line">{update.details}</p>
          </Row>
        )}
      </dl>
      {update.flagRaised && (
        <p className="flex items-center gap-2 rounded-lg border-l-4 border-warning-border bg-warning-bg px-3 py-2 text-sm font-bold text-warning-text">
          <Flag aria-hidden="true" className="h-4 w-4 shrink-0" />
          Flagged to the program team
        </p>
      )}
    </div>
  );
}

function updateSummary(update: JeeFormUpdate): string {
  if (update.status === "filled") return `Filled · ${update.applicationNumber}`;
  return `Not filled · ${update.reasons.map(jeeFormReasonLabel).join("; ")}`;
}

function EarlierUpdates({ updates }: { updates: JeeFormUpdate[] }) {
  if (updates.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-bold text-text-secondary hover:text-text-primary">
        Earlier updates ({updates.length})
      </summary>
      <ol className="mt-1 space-y-1.5 border-l-2 border-border pl-3">
        {updates.map((update) => (
          <li key={update.id} className="break-words text-text-secondary">
            <span className="font-mono">{formatCalendarDate(update.recordedOn)}</span>
            {" · "}
            {updateSummary(update)}
          </li>
        ))}
      </ol>
    </details>
  );
}

function FilledFields({
  draft,
  change,
  fieldErrors,
  reminderOpen,
}: {
  draft: Draft;
  change: (next: Partial<Draft>) => void;
  fieldErrors: JeeFormFieldErrors;
  reminderOpen: boolean;
}) {
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
      <div>
        <label htmlFor={fileId} className={LABEL_CLASSES}>
          Confirmation page <Optional />
        </label>
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
      {reminderOpen && (
        <p className="text-sm text-text-secondary">Saving ticks the student&apos;s “JEE Form Filling (Reminder)” action item.</p>
      )}
    </div>
  );
}

function NotFilledFields({
  draft,
  change,
  fieldErrors,
}: {
  draft: Draft;
  change: (next: Partial<Draft>) => void;
  fieldErrors: JeeFormFieldErrors;
}) {
  const detailsId = useId();
  const otherChosen = draft.reasons.includes("other");
  function toggle(reason: JeeFormReason) {
    const reasons = draft.reasons.includes(reason)
      ? draft.reasons.filter((value) => value !== reason)
      : [...draft.reasons, reason];
    change({ reasons });
  }
  return (
    <div className="space-y-4">
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

function clientErrors(draft: Draft): JeeFormFieldErrors | null {
  const validated = validateJeeForm(draft);
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
    if (draft.confirmation) body.set("confirmation", draft.confirmation);
  } else {
    for (const reason of draft.reasons) body.append("reasons", reason);
    body.set("details", draft.details);
  }
  return body;
}

function EditForm({
  studentId,
  initial,
  reminderOpen,
  onCancel,
  onSaved,
}: {
  studentId: number;
  initial: Draft;
  reminderOpen: boolean;
  onCancel: (() => void) | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<JeeFormFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = useId();

  function change(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
    setFieldErrors((current) => {
      const kept = { ...current };
      for (const key of Object.keys(next)) delete kept[key as keyof JeeFormFieldErrors];
      return kept;
    });
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const errors = clientErrors(draft);
    if (errors) {
      setFieldErrors(errors);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/blended-learning/students/${studentId}/jee-form`, {
        method: "POST",
        body: formBody(draft),
      });
      if (response.ok) {
        onSaved();
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; fieldErrors?: JeeFormFieldErrors };
      if (data.fieldErrors) setFieldErrors(data.fieldErrors);
      else setError(data.error ?? "Couldn't save. Try again.");
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

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
        <FilledFields draft={draft} change={change} fieldErrors={fieldErrors} reminderOpen={reminderOpen} />
      )}
      {draft.status === "not_filled" && <NotFilledFields draft={draft} change={change} fieldErrors={fieldErrors} />}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {(draft.status !== null || onCancel) && (
        <div className="flex flex-wrap gap-3">
          {draft.status !== null && (
            <Button type="submit" size="md" disabled={saving} className="px-5">
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
          {onCancel && (
            <Button type="button" variant="secondary" size="md" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

// What is recorded, with the way to change it for a recorder.
function SavedStatus({
  studentId,
  form,
  onChange,
}: {
  studentId: number;
  form: JeeFormView;
  onChange: (() => void) | null;
}) {
  const { current } = form;
  if (!current) return <p className="text-sm text-text-secondary">Not recorded yet.</p>;
  return (
    <>
      {current.status === "filled" ? (
        <SavedFilled studentId={studentId} update={current} reminderItems={form.reminderItems} />
      ) : (
        <SavedNotFilled update={current} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-text-muted">
          Recorded <span className="font-mono">{formatCalendarDate(current.recordedOn)}</span>
        </p>
        {onChange && (
          <Button type="button" variant="secondary" size="md" onClick={onChange}>
            Change status
          </Button>
        )}
      </div>
    </>
  );
}

export function JeeFormCard({
  studentId,
  form,
  canRecord,
}: {
  studentId: number;
  form: JeeFormView | null;
  canRecord: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const [changing, setChanging] = useState(false);
  const current = form?.current ?? null;
  // Before anything is recorded, a recorder sees the choice straight away.
  const editing = canRecord && form !== null && (changing || current === null);

  function saved() {
    setChanging(false);
    router.refresh();
  }

  return (
    <section aria-labelledby={titleId}>
      <Card elevation="sm" className="space-y-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={titleId} className="text-lg font-bold text-text-primary">
            {JEE_FORM_EXAM.label} form
          </h2>
          {form && <StatusBadge current={current} />}
        </header>
        {form === null ? (
          <p className="text-sm text-text-secondary">The JEE form can&apos;t be shown right now.</p>
        ) : editing ? (
          <EditForm
            // A fresh form each time it opens, from what is saved.
            key={current?.id ?? "new"}
            studentId={studentId}
            initial={draftFrom(current)}
            reminderOpen={form.reminderItems.some((item) => item.status === "open")}
            onCancel={current ? () => setChanging(false) : null}
            onSaved={saved}
          />
        ) : (
          <SavedStatus
            studentId={studentId}
            form={form}
            onChange={canRecord ? () => setChanging(true) : null}
          />
        )}
        {form && !editing && <EarlierUpdates updates={form.earlier} />}
      </Card>
    </section>
  );
}
