"use client";

import { useId } from "react";

import { FormLabel, Input } from "@/components/ui";

import { FieldError, FormCard, Optional, SegmentedChoice, TEXTAREA_CLASSES } from "./formParts";
import type { EntryFormValues, FieldErrors, Kind } from "./logEntryPayload";

// The first card: whether it was a Conversation or an Attempt, then the
// date and, for a Conversation, its duration, how it happened and who was
// spoken with, two to a row from 768 px (one column on a phone).

// Updates some of the form's values from their current ones.
export type ChangeValues = (change: (values: EntryFormValues) => Partial<EntryFormValues>) => void;

const KINDS: { value: Kind; label: string }[] = [
  { value: "conversation", label: "Conversation" },
  { value: "attempt", label: "Attempt" },
];
const MODES = [
  { value: "call", label: "Call" },
  { value: "in_person", label: "In person" },
] as const;
const SPOKE_WITH = [
  { value: "student", label: "Student" },
  { value: "parent_or_sibling", label: "Parent or sibling" },
  { value: "both", label: "Both" },
] as const;

function DurationField({ value, error, onChange }: { value: string; error?: string; onChange: (value: string) => void }) {
  const id = `${useId()}-duration`;
  return (
    <div>
      <FormLabel htmlFor={id}>
        Duration<span className="sr-only"> (minutes)</span>
      </FormLabel>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={240}
          placeholder="20"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          className="pr-12"
        />
        <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">
          min
        </span>
      </div>
      <FieldError message={error} />
    </div>
  );
}

function ConversationDetails({
  values,
  change,
  fieldErrors,
}: {
  values: EntryFormValues;
  change: ChangeValues;
  fieldErrors: FieldErrors;
}) {
  return (
    <>
      <DurationField
        value={values.duration}
        error={fieldErrors.durationMinutes}
        onChange={(duration) => change(() => ({ duration }))}
      />
      <SegmentedChoice
        legend="How"
        name="mode"
        options={MODES}
        value={values.mode}
        onChange={(mode) => change(() => ({ mode }))}
        error={fieldErrors.mode}
      />
      <SegmentedChoice
        legend="Spoke with"
        name="spokeWith"
        options={SPOKE_WITH}
        value={values.spokeWith}
        onChange={(spokeWith) => change(() => ({ spokeWith }))}
        error={fieldErrors.spokeWith}
      />
    </>
  );
}

function AttemptNote({ note, onChange }: { note: string; onChange: (note: string) => void }) {
  const id = `${useId()}-note`;
  return (
    <div className="md:col-span-2">
      <FormLabel htmlFor={id}>
        Note <Optional />
      </FormLabel>
      <textarea
        id={id}
        rows={2}
        value={note}
        placeholder="e.g. Phone switched off, tried twice"
        onChange={(event) => onChange(event.target.value)}
        className={TEXTAREA_CLASSES}
      />
    </div>
  );
}

export function SessionDetailsCard({
  reviewing,
  today,
  values,
  change,
  fieldErrors,
  onKindChange,
}: {
  // A draft is saved as a Conversation only, so it offers no Attempt.
  reviewing: boolean;
  today: string;
  values: EntryFormValues;
  change: ChangeValues;
  fieldErrors: FieldErrors;
  onKindChange: (kind: Kind) => void;
}) {
  const dateId = `${useId()}-date`;
  const conversation = values.kind === "conversation";
  return (
    <FormCard title={conversation ? "Session details" : "Attempt details"}>
      {!reviewing && (
        <SegmentedChoice
          legend="What happened"
          name="kind"
          options={KINDS}
          value={values.kind}
          onChange={onKindChange}
          error={fieldErrors.kind}
        />
      )}
      <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
        <div>
          <FormLabel htmlFor={dateId}>Date</FormLabel>
          <Input
            id={dateId}
            type="date"
            value={values.occurredOn}
            max={today}
            onChange={(event) => change(() => ({ occurredOn: event.target.value }))}
            aria-invalid={Boolean(fieldErrors.occurredOn)}
          />
          <FieldError message={fieldErrors.occurredOn} />
        </div>
        {conversation ? (
          <ConversationDetails values={values} change={change} fieldErrors={fieldErrors} />
        ) : (
          <AttemptNote note={values.note} onChange={(note) => change(() => ({ note }))} />
        )}
      </div>
    </FormCard>
  );
}
