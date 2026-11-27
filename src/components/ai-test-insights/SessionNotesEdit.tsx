"use client";

// The author's edit of a submitted Insight Session (#578, physical centres
// only), opened in place by Edit on their own History entry: the same four
// fields as the Session Notes form, filled with the entry's notes, with "Save
// changes" and Cancel. Nothing saves by itself. "Save changes" is off while
// the final rule fails (a required field blank, the date empty or after today
// in India, a field over the limit) or a save is running, and the fields and
// Cancel are locked while it runs, so nothing typed is lost; it sends the fields
// at the entry's revision to the session's edit route. After a save the page
// reads the timeline again (`onSaved`). Cancel puts the entry back and sends
// nothing. A 409 `stale` (another tab saved first) shows the other-tab message
// with "Reload notes" (which closes the edit and reads the timeline again) and
// keeps the typed text until then; any other failure
// says so and lets the author save again. It never touches the caller's draft
// or the Session Notes form.
import { useState } from "react";

import SessionNotesInputs, {
  asSessionNotes,
  sendSessionNotes,
  type SessionNotesFormValues,
} from "@/components/ai-test-insights/SessionNotesInputs";
import { Button } from "@/components/ui";
import { RetryAlert } from "@/components/ui/RetryAlert";
import {
  SESSION_NOTES_EDIT_FAILED_MESSAGE,
  SESSION_NOTES_STALE_MESSAGE,
  validateSessionNotes,
  type SessionNotesEditRequest,
  type SessionNotesField,
} from "@/lib/ai-test-insights-session-notes-rules";
import type { TimelineEntry } from "@/lib/ai-test-insights-timeline";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

type SessionEntry = Extract<TimelineEntry, { kind: "session" }>;
type SaveState = "idle" | "saving" | "stale" | "failed";

export default function SessionNotesEdit({
  entry,
  editUrl,
  onSaved,
  onCancel,
  onReload,
}: {
  /** The author's own session, as the timeline gave it. */
  entry: SessionEntry;
  /** The session's edit route, with the page's `centre`. */
  editUrl: string;
  /** The edit was saved: the page reads the timeline again. */
  onSaved: () => void;
  /** Closes the edit; nothing is sent. */
  onCancel: () => void;
  /** "Reload notes" after a stale save: the page reads the timeline again. */
  onReload: () => void;
}) {
  const [values, setValues] = useState<SessionNotesFormValues>(() => ({
    sessionDate: entry.sessionDate,
    areasOfConcern: entry.areasOfConcern,
    immediateActions: entry.immediateActions,
    otherNotes: entry.otherNotes ?? "",
  }));
  const [state, setState] = useState<SaveState>("idle");
  // The revision the edit was opened from: a reload of the timeline meanwhile
  // must not move it, or a change another tab made would be saved over.
  const [revision] = useState(entry.revision);
  const today = getTodayIST();
  const canSave =
    validateSessionNotes(asSessionNotes(values), "final", today).ok && state !== "saving" && state !== "stale";

  async function save() {
    setState("saving");
    const request: SessionNotesEditRequest = { ...asSessionNotes(values), expectedRevision: revision };
    const outcome = await sendSessionNotes(editUrl, "PATCH", request);
    if (outcome === "ok") {
      onSaved();
      return;
    }
    setState(outcome);
  }

  return (
    <div className="space-y-4">
      <SessionNotesInputs
        values={values}
        onChange={(field: SessionNotesField, value: string) => setValues((current) => ({ ...current, [field]: value }))}
        today={today}
        disabled={state === "saving"}
      />
      {state === "stale" && (
        <RetryAlert onRetry={onReload} retryLabel="Reload notes">
          {SESSION_NOTES_STALE_MESSAGE}
        </RetryAlert>
      )}
      {state === "failed" && (
        <p role="alert" className="text-sm text-danger">
          {SESSION_NOTES_EDIT_FAILED_MESSAGE}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={!canSave}>
          Save changes
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={state === "saving"}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
