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
  /** Called after any successful write so the parent refetches flags. */
  onChanged: () => void;
  schoolCode: string;
  studentPkId: string;
  studentName: string;
  /** Every flag for this student at the school, newest first. */
  flags: InterventionFlag[];
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
  if (update.status_from == null && update.status_to === "open") return "Flagged";
  if (update.status_to === "resolved") return "Resolved";
  return "Note";
}

function UpdateList({ updates }: { updates: InterventionFlagUpdate[] }) {
  return (
    <ol className="space-y-3">
      {updates.map((update) => (
        <li key={update.id} className="rounded-md border border-border bg-bg-card-alt p-3">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
            <span className="font-semibold text-text-primary">{describeUpdate(update)}</span>
            <span>·</span>
            <span>{update.author_name || update.author_email}</span>
            <span>·</span>
            <span>{formatTimestamp(update.inserted_at)}</span>
          </div>
          {update.body && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{update.body}</p>
          )}
        </li>
      ))}
    </ol>
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
}: Props) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openFlag = flags.find((flag) => flag.status === "open") ?? null;
  const pastFlags = flags.filter((flag) => flag.status !== "open");
  const trimmed = note.trim();
  const base = `/api/schools/${encodeURIComponent(schoolCode)}/intervention-flags`;

  const close = () => {
    setNote("");
    setError(null);
    onClose();
  };

  const submit = async (url: string, payload: Record<string, unknown>) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setNote("");
      onChanged();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const raise = () => submit(base, { studentPkId: Number(studentPkId), note: trimmed });
  const addNote = () =>
    openFlag && submit(`${base}/${openFlag.id}/updates`, { note: trimmed });
  const resolve = () =>
    openFlag && submit(`${base}/${openFlag.id}/updates`, { note: trimmed, resolve: true });

  return (
    <Modal open={open} onClose={close} className="p-0">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">{studentName}</h2>
          {openFlag && <Badge variant="warning">Needs intervention</Badge>}
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          For welfare needs such as medical, mental health, grief or extra attention. Notes are
          visible to staff who can see this student.
        </p>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
        {openFlag && <UpdateList updates={openFlag.updates} />}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-text-primary">
            {openFlag ? "Add a note" : "What is going on, and what support might help?"}
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={INTERVENTION_FLAG_NOTE_MAX_LENGTH}
            disabled={submitting}
            className={`${baseInputClasses} w-full`}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

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
        <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
          Close
        </Button>
        {openFlag ? (
          <>
            <Button type="button" variant="secondary" onClick={resolve} disabled={submitting}>
              Mark resolved
            </Button>
            <Button type="button" onClick={addNote} disabled={submitting || !trimmed}>
              Add note
            </Button>
          </>
        ) : (
          <Button type="button" onClick={raise} disabled={submitting || !trimmed}>
            Flag for intervention
          </Button>
        )}
      </div>
    </Modal>
  );
}
