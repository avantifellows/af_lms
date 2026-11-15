"use client";

import { CheckCircle2, Flag } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui";
import { formatCalendarDate } from "@/lib/blended-learning-format";
import {
  jeeFormReasonLabel,
  type JeeFormUpdate,
  type JeeFormView,
  type JeeReminderItem,
} from "@/lib/blended-learning-jee-form-input";

import { ConfirmationLink, JeeFormEditor } from "./JeeFormEditor";
import { RecordedOn, updateSummary } from "./jeeFormDisplay";

// An open row of the JEE Form tab. A recorder (the Mentor, or a Blended
// Learning Admin who isn't read-only) gets the Filled / Not filled form
// straight away, prefilled from what is saved; after saving, what was saved
// shows with "Change status". A read-only viewer sees what is saved. The
// earlier updates are listed under either.

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

function SavedFilled({ studentId, update }: { studentId: number; update: JeeFormUpdate }) {
  return (
    <>
      <Row label="Application number">
        <span className="font-mono">{update.applicationNumber}</span>
      </Row>
      {/* A write-only application password row goes here once it is stored encrypted. */}
      <Row label="Confirmation page">
        {update.hasConfirmation ? (
          <ConfirmationLink studentId={studentId} label="View PDF" />
        ) : (
          <span className="text-text-secondary">Not uploaded</span>
        )}
      </Row>
    </>
  );
}

function SavedNotFilled({ update }: { update: JeeFormUpdate }) {
  return (
    <>
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
    </>
  );
}

function SavedStatus({ studentId, form }: { studentId: number; form: JeeFormView }) {
  const { current } = form;
  if (!current) return <p className="text-sm text-text-secondary">Not recorded yet.</p>;
  return (
    <div className="space-y-3">
      <dl className="space-y-3">
        {current.status === "filled" ? (
          <SavedFilled studentId={studentId} update={current} />
        ) : (
          <SavedNotFilled update={current} />
        )}
        <ReminderItems items={form.reminderItems} />
      </dl>
      {current.flagRaised && (
        <p className="flex items-center gap-2 rounded-lg border-l-4 border-warning-border bg-warning-bg px-3 py-2 text-sm font-bold text-warning-text">
          <Flag aria-hidden="true" className="h-4 w-4 shrink-0" />
          Flagged to the program team
        </p>
      )}
      <RecordedOn current={current} />
    </div>
  );
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

function SavedView({
  studentId,
  form,
  saved,
  onChange,
}: {
  studentId: number;
  form: JeeFormView;
  saved: boolean;
  onChange: (() => void) | null;
}) {
  return (
    <div className="space-y-3">
      {saved && (
        <p role="status" className="flex items-center gap-1.5 text-sm font-bold text-success">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
          Saved
        </p>
      )}
      <SavedStatus studentId={studentId} form={form} />
      {onChange && (
        <Button type="button" variant="secondary" size="md" onClick={onChange}>
          Change status
        </Button>
      )}
    </div>
  );
}

export function JeeFormPanel({
  studentId,
  form,
  canRecord,
  onSaved,
  onClose,
}: {
  studentId: number;
  form: JeeFormView;
  canRecord: boolean;
  onSaved: (form: JeeFormView) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(canRecord);
  const [saved, setSaved] = useState(false);

  function handleSaved(next: JeeFormView) {
    onSaved(next);
    setEditing(false);
    setSaved(true);
  }

  return (
    <div className="space-y-4">
      {editing ? (
        <JeeFormEditor
          studentId={studentId}
          current={form.current}
          reminderOpen={form.reminderItems.some((item) => item.status === "open")}
          onCancel={onClose}
          onSaved={handleSaved}
        />
      ) : (
        <SavedView
          studentId={studentId}
          form={form}
          saved={saved}
          onChange={canRecord ? () => setEditing(true) : null}
        />
      )}
      <EarlierUpdates updates={form.earlier} />
    </div>
  );
}
