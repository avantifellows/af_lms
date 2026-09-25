"use client";

import { useState } from "react";

import { Badge, Button, Modal, baseInputClasses } from "@/components/ui";
import {
  INTERVENTION_FLAG_NOTE_MAX_LENGTH,
  type InterventionFlag,
  type InterventionFlagUpdate,
} from "@/lib/intervention-flag-types";

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Refetches flags after a write (or a conflict). Awaited: the dialog stays in
   * its saving state until the refreshed flag is showing.
   */
  onChanged: () => Promise<void> | void;
  schoolCode: string;
  studentPkId: string;
  studentName: string;
  /** Every flag for this student at the school, newest first. */
  flags: InterventionFlag[];
  /** False for read-only viewers: history only, no note field or actions. */
  canEdit?: boolean;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function describeUpdate(update: InterventionFlagUpdate): string {
  if (update.status_from == null && update.status_to === "open")
    return "Flagged";
  if (update.status_to === "resolved") return "Resolved";
  return "Note";
}

function UpdateList({ updates }: { updates: InterventionFlagUpdate[] }) {
  return (
    <ol className="space-y-3">
      {updates.map((update) => (
        <li
          key={update.id}
          className="rounded-md border border-border bg-bg-card-alt p-3"
        >
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
            <span className="font-semibold text-text-primary">
              {describeUpdate(update)}
            </span>
            <span>·</span>
            <span>{update.author_name || update.author_email}</span>
            <span>·</span>
            <span>{formatTimestamp(update.inserted_at)}</span>
          </div>
          {update.body && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
              {update.body}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function NoteField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-text-primary">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        maxLength={INTERVENTION_FLAG_NOTE_MAX_LENGTH}
        disabled={disabled}
        className={`${baseInputClasses} w-full`}
      />
    </label>
  );
}

function StatusMessage({
  error,
  saved,
}: {
  error: string | null;
  saved: string | null;
}) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!saved) return null;
  return (
    <p role="status" className="text-sm text-green-700">
      {saved}
    </p>
  );
}

function FlagActions({
  hasOpenFlag,
  submitting,
  hasNote,
  onRaise,
  onAddNote,
  onResolve,
}: {
  hasOpenFlag: boolean;
  submitting: boolean;
  hasNote: boolean;
  onRaise: () => void;
  onAddNote: () => void;
  onResolve: () => void;
}) {
  const label = (idle: string) => (submitting ? "Saving…" : idle);
  if (!hasOpenFlag) {
    return (
      <Button type="button" onClick={onRaise} disabled={submitting || !hasNote}>
        {label("Flag for intervention")}
      </Button>
    );
  }
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={onResolve}
        disabled={submitting}
      >
        Mark resolved
      </Button>
      <Button
        type="button"
        onClick={onAddNote}
        disabled={submitting || !hasNote}
      >
        {label("Add note")}
      </Button>
    </>
  );
}

export default function InterventionFlagModal({
  open,
  onClose,
  onChanged,
  schoolCode,
  studentPkId,
  studentName,
  flags,
  canEdit = true,
}: Props) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const openFlag = flags.find((flag) => flag.status === "open") ?? null;
  const pastFlags = flags.filter((flag) => flag.status !== "open");
  const trimmed = note.trim();
  const base = `/api/schools/${encodeURIComponent(schoolCode)}/intervention-flags`;

  const close = () => {
    setNote("");
    setError(null);
    setSaved(null);
    onClose();
  };

  const submit = async (
    url: string,
    payload: Record<string, unknown>,
    savedMessage: string,
  ) => {
    setSubmitting(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (res.status === 409 && !openFlag) {
          // Someone else flagged this student while this form was open. Load
          // their flag and keep the typed text so it can be added as a note.
          await onChanged();
          setError(
            "Someone else has already flagged this student. Their flag is shown above; you can add your text to it as a note.",
          );
        } else {
          setError(data?.error ?? "Something went wrong. Please try again.");
        }
        return;
      }
      await onChanged();
      setNote("");
      setSaved(savedMessage);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const raise = () =>
    submit(
      base,
      { studentPkId: Number(studentPkId), note: trimmed },
      "Flag saved.",
    );
  const addNote = () =>
    openFlag &&
    submit(`${base}/${openFlag.id}/updates`, { note: trimmed }, "Note added.");
  const resolve = () =>
    openFlag &&
    submit(
      `${base}/${openFlag.id}/updates`,
      { note: trimmed, resolve: true },
      "Flag resolved.",
    );

  return (
    <Modal open={open} onClose={close} className="p-0">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">
            {studentName}
          </h2>
          {openFlag && <Badge variant="warning">Needs intervention</Badge>}
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          For welfare needs such as medical, mental health, grief or extra
          attention. Notes are visible to staff who can see this student.
        </p>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
        {openFlag && <UpdateList updates={openFlag.updates} />}

        {canEdit ? (
          <NoteField
            label={
              openFlag
                ? "Add a note"
                : "What is going on, and what support might help?"
            }
            value={note}
            onChange={setNote}
            disabled={submitting}
          />
        ) : (
          <p className="text-sm text-text-muted">
            You have read-only access, so you can view flags but not add to or
            resolve them.
          </p>
        )}
        <StatusMessage error={error} saved={saved} />

        {pastFlags.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-text-secondary">
              Past flags ({pastFlags.length})
            </summary>
            <div className="mt-3 space-y-4">
              {pastFlags.map((flag) => (
                <UpdateList key={flag.id} updates={flag.updates} />
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-3 border-t border-border px-5 py-4">
        <Button
          type="button"
          variant="secondary"
          onClick={close}
          disabled={submitting}
        >
          Close
        </Button>
        {canEdit && (
          <FlagActions
            hasOpenFlag={openFlag != null}
            submitting={submitting}
            hasNote={trimmed.length > 0}
            onRaise={raise}
            onAddNote={addNote}
            onResolve={resolve}
          />
        )}
      </div>
    </Modal>
  );
}
