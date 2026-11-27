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
// stays until "Reload notes". Leaving with an unsaved or failed draft is
// guarded by the leave guard Holistic notes share (`useNotesNavigationGuard`):
// an in-app link (the page's "Back to AI Test Insights") first saves what is
// pending and goes on once it is saved; when it cannot be saved (the save
// fails again, another tab changed the notes, a field is over the limit, or a
// submit is running) it asks to confirm. A reload or a closed tab gets the
// browser's own prompt. Labels, the limit and the rule come from the shared
// Session Notes rules.
//
// Submit (#575) turns the draft into an Insight Session linked to the AI
// Summary the card shows (`openRequest`), when that request is `completed`;
// a line under the form says which one, or that none is open, and another
// says who reads submitted notes. Submit is off while a required field is
// blank, the date is empty or after today in India, a field is over the
// limit, or a save or submit is running. It first saves any pending change,
// then submits at the draft's revision; the fields are locked meanwhile, as
// the submit sends what they held when pressed. After a submit the form is blank
// again (dated today) and the page is told (`onSubmitted`), so the Student
// card's counts move. A stale submit shows the same other-tab message as a
// stale save.
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import SessionNotesInputs, {
  asSessionNotes,
  sendSessionNotes,
  type SessionNotesFormValues,
} from "@/components/ai-test-insights/SessionNotesInputs";
import { Button, Card } from "@/components/ui";
import { RetryAlert } from "@/components/ui/RetryAlert";
import { useDraftAutosave, useDraftAutosaveRefs } from "@/hooks/use-draft-autosave";
import { useNotesNavigationGuard } from "@/hooks/use-notes-navigation-guard";
import type { SessionsRead } from "@/hooks/use-ai-test-insights-sessions";
import {
  openInsightRequestKey,
  SESSION_NOTES_STALE_CODE,
  SESSION_NOTES_STALE_MESSAGE,
  SESSION_NOTES_VISIBILITY_TEXT,
  sessionNotesLinkText,
  validateSessionNotes,
  type AiTestInsightsSessionsResponse,
  type SessionNotesDraft,
  type SessionNotesDraftRequest,
  type SessionNotesField,
  type SessionNotesSubmitRequest,
} from "@/lib/ai-test-insights-session-notes-rules";
import { NO_LINKED_USER_MESSAGE, type InsightRequestView } from "@/lib/ai-test-insights-shared";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

/** How long after the last change the draft saves. */
const AUTOSAVE_DELAY_MS = 1000;
const SUBMIT_FAILED_MESSAGE = "These notes could not be submitted. Please try again.";
const LEAVE_UNSAVED_QUESTION = "Your Session Notes are not saved. Leave this page anyway?";

function initialValues(draft: SessionNotesDraft | null): SessionNotesFormValues {
  return {
    sessionDate: draft ? (draft.sessionDate ?? "") : getTodayIST(),
    areasOfConcern: draft?.areasOfConcern ?? "",
    immediateActions: draft?.immediateActions ?? "",
    otherNotes: draft?.otherNotes ?? "",
  };
}

class StaleNotesError extends Error {}

/** The draft the form last saw: its id (null before the first save) and revision. */
type DraftVersion = { draftId: number | null; revision: number };

/** Saves the draft as `seen`; returns the draft id and revision the route answered. */
async function putDraft(url: string, values: SessionNotesFormValues, seen: DraftVersion): Promise<DraftVersion> {
  const request: SessionNotesDraftRequest = { ...asSessionNotes(values), draftId: seen.draftId, expectedRevision: seen.revision };
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await response.json().catch(() => null)) as { draftId?: unknown; revision?: unknown; code?: unknown } | null;
  if (response.status === 409 && body?.code === SESSION_NOTES_STALE_CODE) {
    throw new StaleNotesError(SESSION_NOTES_STALE_MESSAGE);
  }
  const draftId = body?.draftId ?? null;
  if (!response.ok || typeof body?.revision !== "number" || (draftId !== null && typeof draftId !== "number")) {
    throw new Error("Session Notes could not be saved");
  }
  return { draftId, revision: body.revision };
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
  const versionRef = useRef<DraftVersion>({ draftId: draft?.draftId ?? null, revision: draft?.revision ?? 0 });
  const refs = useDraftAutosaveRefs(initial);

  const sendable = validateSessionNotes(asSessionNotes(values), "draft").ok && !stale;
  const retry = useDraftAutosave({
    value: values,
    refs,
    enabled: sendable,
    canFlush: sendable,
    failed: status === "failed",
    delayMs: AUTOSAVE_DELAY_MS,
    save: async (next) => {
      versionRef.current = await putDraft(draftUrl, next, versionRef.current);
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
  const update = (field: SessionNotesField, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));
  return { values, update, status, stale, sendable, changed, retry, markStale, version: () => versionRef.current };
}

/** "Saving…", "Saved" once nothing is left to send, or nothing. */
function saveStatusText(status: SaveStatus, changed: boolean): string {
  if (status === "saving") return "Saving…";
  return status === "saved" && !changed ? "Saved" : "";
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
  const { values, update, status, stale, sendable, changed, retry, markStale, version } = useSessionNotesDraft(
    draft,
    draftUrl,
  );
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  // Leaving saves what is pending first, and asks only when it cannot be saved.
  const beforeNavigation = useCallback(
    async () => (!submitting && sendable && (await retry())) || window.confirm(LEAVE_UNSAVED_QUESTION),
    [submitting, sendable, retry],
  );
  useNotesNavigationGuard({
    beforeNavigation,
    guardNeeded: changed || status === "failed" || status === "saving" || submitting,
    router,
  });
  const [submitFailed, setSubmitFailed] = useState(false);
  const today = getTodayIST();
  const canSubmit =
    validateSessionNotes(asSessionNotes(values), "final", today).ok && !stale && !submitting && status !== "saving";

  async function submit() {
    setSubmitting(true);
    setSubmitFailed(false);
    // Any pending change is saved first, so the submit sends the draft's revision.
    if (!(await retry())) {
      setSubmitting(false);
      return;
    }
    const { draftId, revision } = version();
    const request: SessionNotesSubmitRequest = {
      ...asSessionNotes(values),
      // A saved draft always has an id; 0 is refused like a missing draft.
      draftId: draftId ?? 0,
      expectedRevision: revision,
      openRequestKey: openInsightRequestKey(openRequest),
    };
    const outcome = await sendSessionNotes(sessionsUrl, "POST", request);
    if (outcome === "ok") {
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
        {SESSION_NOTES_STALE_MESSAGE}
      </RetryAlert>
    );
  } else if (status === "failed") {
    saveState = <RetryAlert onRetry={() => void retry()}>These notes could not be saved.</RetryAlert>;
  }

  return (
    <div className="space-y-4">
      <SessionNotesInputs values={values} onChange={update} today={today} disabled={submitting} />
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
