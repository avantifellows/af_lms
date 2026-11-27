"use client";

// The Session Notes section of the AI Test Insights Student page (#551,
// physical centres only). Slice #574: the Teacher's private draft. The
// section shows the page's one read of the sessions route (#576: History
// shares it), which it reads again on Retry or "Reload notes"; the form shows
// only once the draft is known. Once the form holds its draft, a later read
// (for History) never replaces it, even one that fails: only "Reload notes"
// starts the form again from the next read. A Teacher with
// `notesAccess = write` gets the form with their own draft, or a blank one
// dated today in India; `no_linked_user` gets part 1's message instead; read
// access gets no section at all. A failed read stays inside this section.
//
// The draft saves by itself about a second after typing stops, through the
// draft autosave Holistic notes share (`useDraftAutosave`): one save at a
// time, the newest value next. A field over the 2,000-character limit is
// marked and nothing is sent until it fits; the form never cuts text. When
// another tab saved first (409 `stale`), autosave stops and the typed text
// stays until "Reload notes". Leaving with an unsaved or failed draft asks the
// browser to confirm. Labels, the limit and the rule come from the shared
// Session Notes rules.
//
// Submit (#575) turns the draft into an Insight Session linked to the AI
// Summary the card shows (`openRequest`), when that request is `completed`;
// a line under the form says which one, or that none is open, and another
// says who reads submitted notes. Submit is off while a required field is
// blank, the date is empty or after today in India, a field is over the
// limit, or a save or submit is running. It first saves any pending change,
// then submits at the draft's revision. After a submit the form is blank
// again (dated today) and the page is told (`onSubmitted`), so the Student
// card's counts move. A stale submit shows the same other-tab message as a
// stale save.
import { useEffect, useId, useRef, useState } from "react";

import { Button, Card } from "@/components/ui";
import { RetryAlert } from "@/components/ui/RetryAlert";
import { baseInputClasses } from "@/components/ui/styles";
import { useDraftAutosave, useDraftAutosaveRefs } from "@/hooks/use-draft-autosave";
import type { SessionsRead } from "@/hooks/use-ai-test-insights-sessions";
import {
  openInsightRequestKey,
  SESSION_NOTES_LABELS,
  SESSION_NOTES_MAX_LENGTH,
  SESSION_NOTES_STALE_CODE,
  SESSION_NOTES_TEXT_FIELDS,
  SESSION_NOTES_VISIBILITY_TEXT,
  sessionNotesLength,
  sessionNotesLinkText,
  validateSessionNotes,
  type AiTestInsightsSessionsResponse,
  type SessionNotesDraft,
  type SessionNotesDraftRequest,
  type SessionNotesField,
  type SessionNotesFields,
  type SessionNotesSubmitRequest,
  type SessionNotesTextField,
} from "@/lib/ai-test-insights-session-notes-rules";
import { NO_LINKED_USER_MESSAGE, type InsightRequestView } from "@/lib/ai-test-insights-shared";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

/** How long after the last change the draft saves. */
const AUTOSAVE_DELAY_MS = 1000;
const STALE_MESSAGE = "These notes were changed in another tab.";
const SUBMIT_FAILED_MESSAGE = "These notes could not be submitted. Please try again.";
const formatCount = (count: number) => count.toLocaleString("en-IN");

/** The form's fields as typed; an empty date input is "". */
type FormValues = Record<SessionNotesField, string>;

function initialValues(draft: SessionNotesDraft | null): FormValues {
  return {
    sessionDate: draft ? (draft.sessionDate ?? "") : getTodayIST(),
    areasOfConcern: draft?.areasOfConcern ?? "",
    immediateActions: draft?.immediateActions ?? "",
    otherNotes: draft?.otherNotes ?? "",
  };
}

/** The fields as the routes take them: text as typed, no date as null. */
const asNotes = (values: FormValues): SessionNotesFields => ({ ...values, sessionDate: values.sessionDate || null });

/** One field checked alone under the draft rule: its message, or null when it is fine. */
function fieldError(field: SessionNotesField, values: FormValues): string | null {
  const alone: SessionNotesFields = { sessionDate: null, areasOfConcern: null, immediateActions: null, otherNotes: null };
  const checked = validateSessionNotes({ ...alone, [field]: asNotes(values)[field] }, "draft");
  return checked.ok ? null : checked.error;
}

class StaleNotesError extends Error {}

/** Saves the draft at `expectedRevision`; returns the revision the route answered. */
async function putDraft(url: string, values: FormValues, expectedRevision: number): Promise<number> {
  const request: SessionNotesDraftRequest = { ...asNotes(values), expectedRevision };
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await response.json().catch(() => null)) as { revision?: unknown; code?: unknown } | null;
  if (response.status === 409 && body?.code === SESSION_NOTES_STALE_CODE) throw new StaleNotesError(STALE_MESSAGE);
  if (!response.ok || typeof body?.revision !== "number") throw new Error("Session Notes could not be saved");
  return body.revision;
}

/** Submits the draft at `expectedRevision`, linked to `openRequestKey` (null for none). */
async function postSubmit(
  url: string,
  values: FormValues,
  expectedRevision: number,
  openRequestKey: string | null,
): Promise<"submitted" | "stale" | "failed"> {
  const request: SessionNotesSubmitRequest = { ...asNotes(values), expectedRevision, openRequestKey };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.ok) return "submitted";
    const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
    if (response.status === 409 && body?.code === SESSION_NOTES_STALE_CODE) return "stale";
  } catch {
    // A network failure reads as any other failure.
  }
  return "failed";
}

/** Asks the browser to confirm leaving the page while `unsaved`. */
function useLeaveGuard(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const confirmLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", confirmLeaving);
    return () => window.removeEventListener("beforeunload", confirmLeaving);
  }, [unsaved]);
}

type SaveStatus = "idle" | "saving" | "saved" | "failed";

/**
 * The form's values and their autosave: one draft save at a time, at the
 * revision the last save answered with. A field the draft rule refuses stops
 * sending until it fits; a stale answer stops autosave for good.
 */
function useSessionNotesDraft(draft: SessionNotesDraft | null, draftUrl: string) {
  const [initial] = useState(() => initialValues(draft));
  const [values, setValues] = useState(initial);
  const [savedValues, setSavedValues] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [stale, setStale] = useState(false);
  const staleRef = useRef(false);
  const revisionRef = useRef(draft?.revision ?? 0);
  const refs = useDraftAutosaveRefs(initial);

  const sendable = validateSessionNotes(asNotes(values), "draft").ok && !stale;
  const retry = useDraftAutosave({
    value: values,
    refs,
    enabled: sendable,
    canFlush: sendable,
    failed: status === "failed",
    delayMs: AUTOSAVE_DELAY_MS,
    save: async (next) => {
      revisionRef.current = await putDraft(draftUrl, next, revisionRef.current);
    },
    isStopped: () => staleRef.current,
    onSaving: () => setStatus("saving"),
    onSaved: setSavedValues,
    onFailed: (caught) => {
      if (caught instanceof StaleNotesError) markStale();
      setStatus("failed");
    },
    onDrained: () => setStatus("saved"),
  });

  /** Another tab saved first: autosave stops for good. */
  function markStale() {
    staleRef.current = true;
    setStale(true);
  }

  const changed = JSON.stringify(values) !== JSON.stringify(savedValues);
  useLeaveGuard(changed || status === "failed" || status === "saving");
  const update = (field: SessionNotesField) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));
  return { values, update, status, stale, changed, retry, markStale, revision: () => revisionRef.current };
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

/** "Saving…", "Saved" once nothing is left to send, or nothing. */
function saveStatusText(status: SaveStatus, changed: boolean): string {
  if (status === "saving") return "Saving…";
  return status === "saved" && !changed ? "Saved" : "";
}

/** The date's message: the draft rule's, else the final rule's (empty, or after today). */
function dateError(values: FormValues, today: string): string | null {
  const draftError = fieldError("sessionDate", values);
  if (draftError) return draftError;
  const checked = validateSessionNotes(asNotes(values), "final", today);
  return !checked.ok && checked.field === "sessionDate" ? checked.error : null;
}

function SessionNotesForm({
  draft,
  draftUrl,
  sessionsUrl,
  openRequest,
  onReload,
  onSubmitted,
}: {
  draft: SessionNotesDraft | null;
  draftUrl: string;
  /** The history route, which a submit posts to. */
  sessionsUrl: string;
  /** The request the AI Summary card shows. */
  openRequest: InsightRequestView | null;
  /** Reads the history route again, which shows a fresh form. */
  onReload: () => void;
  /** The draft became an Insight Session. */
  onSubmitted: () => void;
}) {
  const { values, update, status, stale, changed, retry, markStale, revision } = useSessionNotesDraft(draft, draftUrl);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const today = getTodayIST();
  const canSubmit =
    validateSessionNotes(asNotes(values), "final", today).ok && !stale && !submitting && status !== "saving";

  async function submit() {
    setSubmitting(true);
    setSubmitFailed(false);
    // Any pending change is saved first, so the submit sends the draft's revision.
    if (!(await retry())) {
      setSubmitting(false);
      return;
    }
    const outcome = await postSubmit(sessionsUrl, values, revision(), openInsightRequestKey(openRequest));
    if (outcome === "submitted") {
      onSubmitted();
      return;
    }
    if (outcome === "stale") markStale();
    else setSubmitFailed(true);
    setSubmitting(false);
  }

  let saveState = (
    <p role="status" className="min-h-5 text-sm text-text-secondary">
      {saveStatusText(status, changed)}
    </p>
  );
  if (stale) {
    saveState = (
      <RetryAlert onRetry={onReload} retryLabel="Reload notes">
        {STALE_MESSAGE}
      </RetryAlert>
    );
  } else if (status === "failed") {
    saveState = <RetryAlert onRetry={() => void retry()}>These notes could not be saved.</RetryAlert>;
  }

  return (
    <div className="space-y-4">
      <DateField value={values.sessionDate} onChange={update("sessionDate")} error={dateError(values, today)} />
      {SESSION_NOTES_TEXT_FIELDS.map((field) => (
        <TextField
          key={field}
          field={field}
          value={values[field]}
          onChange={update(field)}
          error={fieldError(field, values)}
        />
      ))}
      {saveState}
      <div className="space-y-1 text-sm text-text-secondary">
        <p>{sessionNotesLinkText(openRequest)}</p>
        <p>{SESSION_NOTES_VISIBILITY_TEXT}</p>
      </div>
      {submitFailed && (
        <p role="alert" className="text-sm text-danger">
          {SUBMIT_FAILED_MESSAGE}
        </p>
      )}
      <Button onClick={() => void submit()} disabled={!canSubmit}>
        Submit
      </Button>
    </div>
  );
}

export default function AiTestInsightsSessionNotes({
  sessions,
  sessionsUrl,
  draftUrl,
  openRequest,
  onSubmitted,
}: {
  /** The page's read of the sessions route. */
  sessions: SessionsRead;
  /** The Student's sessions route, with the page's `centre`; a submit posts to it. */
  sessionsUrl: string;
  /** The Student's draft save route, with the page's `centre`. */
  draftUrl: string;
  /** The request the AI Summary card shows; a submit links it when it is `completed`. */
  openRequest: InsightRequestView | null;
  /** A submit made an Insight Session (the page refreshes the Student card's counts and reads History again). */
  onSubmitted?: () => void;
}) {
  const { state, reload } = sessions;
  // The read the form started from; null until a read answers, and again after "Reload notes".
  const [formFrom, setFormFrom] = useState<AiTestInsightsSessionsResponse | null>(null);
  if (formFrom === null && state.status === "loaded") setFormFrom(state.sessions);
  const shown = formFrom ?? (state.status === "loaded" ? state.sessions : null);
  // Submits so far: each one shows a fresh blank form; a reload shows the draft the route reads.
  const [submits, setSubmits] = useState(0);
  if (shown?.notesAccess === "read") return null;

  return (
    <section aria-label="Session Notes">
      <Card elevation="sm" className="p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-text-primary">Session Notes</h2>
        {!shown && state.status === "loading" && <p className="text-sm text-text-secondary">Loading Session Notes…</p>}
        {!shown && state.status === "failed" && (
          <RetryAlert onRetry={reload}>Session Notes could not be loaded.</RetryAlert>
        )}
        {shown?.notesAccess === "no_linked_user" && <p className="text-sm text-text-primary">{NO_LINKED_USER_MESSAGE}</p>}
        {shown?.notesAccess === "write" && (
          <SessionNotesForm
            key={submits}
            draft={submits > 0 ? null : shown.draft}
            draftUrl={draftUrl}
            sessionsUrl={sessionsUrl}
            openRequest={openRequest}
            onReload={() => {
              setSubmits(0);
              setFormFrom(null);
              reload();
            }}
            onSubmitted={() => {
              setSubmits((count) => count + 1);
              onSubmitted?.();
            }}
          />
        )}
      </Card>
    </section>
  );
}
