"use client";

// The four Session Notes inputs (#551, physical centres only), shared by the
// Session Notes form (#574) and the author's edit of a submitted session in
// History (#578): Date of conversation, Areas of concern, Immediate actions
// and Other notes (optional), each text field with an `n / 2,000` count. A
// field the draft rule refuses is marked with its message; the date also shows
// the final rule's (empty, or after today in India). The inputs never cut
// text. Labels, the limit and the rules come from the shared Session Notes
// rules. Also the one write call both make (`sendSessionNotes`).
import { useId } from "react";

import { baseInputClasses } from "@/components/ui/styles";
import {
  SESSION_NOTES_LABELS,
  SESSION_NOTES_MAX_LENGTH,
  SESSION_NOTES_STALE_CODE,
  SESSION_NOTES_TEXT_FIELDS,
  sessionNotesLength,
  validateSessionNotes,
  type SessionNotesField,
  type SessionNotesFields,
  type SessionNotesTextField,
} from "@/lib/ai-test-insights-session-notes-rules";

const formatCount = (count: number) => count.toLocaleString("en-IN");

/** The fields as typed; an empty date input is "". */
export type SessionNotesFormValues = Record<SessionNotesField, string>;

/** The fields as the routes take them: text as typed, no date as null. */
export const asSessionNotes = (values: SessionNotesFormValues): SessionNotesFields => ({
  ...values,
  sessionDate: values.sessionDate || null,
});

/**
 * Sends a submit (`POST`) or an author's edit (`PATCH`): `ok` on any 2xx,
 * `stale` on a 409 `stale` (another tab saved first), `failed` otherwise,
 * a network failure included.
 */
export async function sendSessionNotes(
  url: string,
  method: "POST" | "PATCH",
  request: unknown,
): Promise<"ok" | "stale" | "failed"> {
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.ok) return "ok";
    const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
    if (response.status === 409 && body?.code === SESSION_NOTES_STALE_CODE) return "stale";
  } catch {
    // A network failure reads as any other failure.
  }
  return "failed";
}

/** One field checked alone under the draft rule: its message, or null when it is fine. */
function fieldError(field: SessionNotesField, values: SessionNotesFormValues): string | null {
  const alone: SessionNotesFields = { sessionDate: null, areasOfConcern: null, immediateActions: null, otherNotes: null };
  const checked = validateSessionNotes({ ...alone, [field]: asSessionNotes(values)[field] }, "draft");
  return checked.ok ? null : checked.error;
}

/** The date's message: the draft rule's, else the final rule's (empty, or after today). */
function dateError(values: SessionNotesFormValues, today: string): string | null {
  const draftError = fieldError("sessionDate", values);
  if (draftError) return draftError;
  const checked = validateSessionNotes(asSessionNotes(values), "final", today);
  return !checked.ok && checked.field === "sessionDate" ? checked.error : null;
}

function TextField({
  field,
  value,
  onChange,
  error,
}: {
  field: SessionNotesTextField;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">
        {SESSION_NOTES_LABELS[field]}
      </label>
      <textarea
        id={id}
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
        className={`mt-1 w-full ${baseInputClasses} ${error ? "border-danger" : ""}`}
      />
      <div className="mt-1 flex justify-between gap-3 text-xs">
        <span id={`${id}-error`} className="text-danger">
          {error}
        </span>
        <span id={`${id}-count`} className={error ? "font-bold text-danger" : "text-text-muted"}>
          {formatCount(sessionNotesLength(value))} / {formatCount(SESSION_NOTES_MAX_LENGTH)}
        </span>
      </div>
    </div>
  );
}

function DateField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error: string | null }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">
        {SESSION_NOTES_LABELS.sessionDate}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        className={`mt-1 min-h-[44px] ${baseInputClasses}`}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** The four inputs, in the form's order. `today` is today in India, `YYYY-MM-DD`. */
export default function SessionNotesInputs({
  values,
  onChange,
  today,
}: {
  values: SessionNotesFormValues;
  onChange: (field: SessionNotesField, value: string) => void;
  today: string;
}) {
  return (
    <>
      <DateField
        value={values.sessionDate}
        onChange={(value) => onChange("sessionDate", value)}
        error={dateError(values, today)}
      />
      {SESSION_NOTES_TEXT_FIELDS.map((field) => (
        <TextField
          key={field}
          field={field}
          value={values[field]}
          onChange={(value) => onChange(field, value)}
          error={fieldError(field, values)}
        />
      ))}
    </>
  );
}
