"use client";

import Link from "next/link";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { Button, Card, FormLabel, Input } from "@/components/ui";
import { baseInputClasses } from "@/components/ui/styles";
import type { MenteeRow } from "@/lib/blended-learning-mentees";

import { LastContact, WhyNowTags } from "../../../MenteeList";
import { NotesEditor } from "./NotesEditor";

// Log a Conversation or an Attempt for one Mentee. One column on mobile with
// the last-conversation panel on top; the panel sits beside the form from
// 1024 px. After saving, a confirmation shows what the Mentee list now says.

type Kind = "conversation" | "attempt";
type FieldErrors = Partial<Record<"kind" | "occurredOn" | "mode" | "spokeWith" | "durationMinutes" | "summary" | "notesHtml", string>>;
type Saved = { kind: Kind; mentee: MenteeRow | null };

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
  { value: "both", label: "Student and parent" },
] as const;

function ChoiceGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  error,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border-2 border-border bg-bg-card px-3 text-sm font-bold text-text-primary transition-colors hover:bg-hover-bg has-[:checked]:border-accent"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="h-4 w-4 accent-accent"
            />
            {option.label}
          </label>
        ))}
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}

function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm text-danger">
      {message}
    </p>
  );
}

function Confirmation({
  saved,
  studentId,
  name,
  firstName,
  forOwnList,
}: {
  saved: Saved;
  studentId: number;
  name: string;
  firstName: string;
  forOwnList: boolean;
}) {
  const { mentee } = saved;
  const group = mentee && mentee.reasons.length > 0 ? "Talk to First" : "Everyone else";
  return (
    <section aria-label="Saved">
      <Card elevation="sm" className="space-y-4 p-4 sm:p-6">
        <h2 className="text-lg font-bold text-text-primary">
          {saved.kind === "conversation" ? "Conversation saved" : "Attempt saved"}
        </h2>
        {mentee && (
          <>
            <p className="text-sm text-text-secondary">
              {`${forOwnList ? "Your" : "The"} Mentee list now shows ${name} in ${group}.`}
            </p>
            <dl className="space-y-2 rounded-lg border border-border px-4 py-3 text-sm">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <dt className="font-bold text-text-muted">Last Contact</dt>
                <dd className="text-text-primary">
                  <LastContact mentee={mentee} />
                </dd>
              </div>
              {mentee.reasons.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <dt className="font-bold text-text-muted">Why now</dt>
                  <dd>
                    <WhyNowTags mentee={mentee} />
                  </dd>
                </div>
              )}
            </dl>
          </>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/blended-learning/students/${studentId}`}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-text-on-accent shadow-sm hover:bg-accent-hover"
          >
            {`View ${firstName}'s history`}
          </Link>
          <Link
            href="/blended-learning"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-bg-card px-4 text-sm font-bold text-text-primary shadow-sm hover:bg-hover-bg"
          >
            Back to Mentees
          </Link>
        </div>
      </Card>
    </section>
  );
}

export function LogEntryForm({
  studentId,
  name,
  firstName,
  today,
  forOwnList,
  lastConversationPanel,
}: {
  studentId: number;
  name: string;
  firstName: string;
  today: string;
  // A Mentor logs on their own list; an admin logs on the mapped Mentor's.
  forOwnList: boolean;
  lastConversationPanel: ReactNode;
}) {
  const ids = useId();
  const [kind, setKind] = useState<Kind>("conversation");
  const [occurredOn, setOccurredOn] = useState(today);
  const [mode, setMode] = useState<(typeof MODES)[number]["value"] | null>(null);
  const [spokeWith, setSpokeWith] = useState<(typeof SPOKE_WITH)[number]["value"] | null>(null);
  const [duration, setDuration] = useState("");
  const [summary, setSummary] = useState("");
  const [notesHtml, setNotesHtml] = useState("");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);

  if (saved) {
    return (
      <Confirmation saved={saved} studentId={studentId} name={name} firstName={firstName} forOwnList={forOwnList} />
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body =
      kind === "attempt"
        ? { kind, occurredOn, note }
        : {
            kind,
            occurredOn,
            mode,
            spokeWith,
            durationMinutes: duration.trim() === "" ? null : Number(duration),
            summary,
            notesHtml,
          };
    try {
      const res = await fetch(`/api/blended-learning/students/${studentId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved({ kind, mentee: json.mentee ?? null });
        return;
      }
      setFieldErrors(json.fieldErrors ?? {});
      if (!json.fieldErrors) setError(json.error ?? "Couldn't save. Try again.");
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const dateId = `${ids}-date`;
  const durationId = `${ids}-duration`;
  const summaryId = `${ids}-summary`;
  const notesLabelId = `${ids}-notes-label`;
  const noteId = `${ids}-note`;
  const textareaClasses = `w-full ${baseInputClasses}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="min-w-0 lg:order-2">{lastConversationPanel}</div>
      <form
        aria-label="Log a Conversation or Attempt"
        noValidate
        onSubmit={submit}
        className="min-w-0 space-y-5 rounded-lg border border-border bg-bg-card p-4 shadow-sm sm:p-6 lg:order-1"
      >
        <ChoiceGroup
          legend="What happened"
          name="kind"
          options={KINDS}
          value={kind}
          onChange={(value) => {
            setKind(value);
            setFieldErrors({});
            setError(null);
          }}
          error={fieldErrors.kind}
        />

        <div>
          <FormLabel htmlFor={dateId}>Date</FormLabel>
          <Input
            id={dateId}
            type="date"
            value={occurredOn}
            max={today}
            onChange={(event) => setOccurredOn(event.target.value)}
            aria-invalid={Boolean(fieldErrors.occurredOn)}
            className="sm:max-w-xs"
          />
          <FieldError message={fieldErrors.occurredOn} />
        </div>

        {kind === "conversation" ? (
          <>
            <ChoiceGroup legend="Mode" name="mode" options={MODES} value={mode} onChange={setMode} error={fieldErrors.mode} />
            <ChoiceGroup
              legend="Spoke with"
              name="spokeWith"
              options={SPOKE_WITH}
              value={spokeWith}
              onChange={setSpokeWith}
              error={fieldErrors.spokeWith}
            />
            <div>
              <FormLabel htmlFor={durationId}>Duration (minutes)</FormLabel>
              <Input
                id={durationId}
                type="number"
                inputMode="numeric"
                min={1}
                max={240}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                aria-invalid={Boolean(fieldErrors.durationMinutes)}
                className="sm:max-w-[10rem]"
              />
              <FieldError message={fieldErrors.durationMinutes} />
            </div>
            <div>
              <FormLabel htmlFor={summaryId}>Summary</FormLabel>
              <textarea
                id={summaryId}
                rows={3}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                aria-invalid={Boolean(fieldErrors.summary)}
                className={textareaClasses}
              />
              <FieldError message={fieldErrors.summary} />
            </div>
            <div>
              <span id={notesLabelId} className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                Notes (optional)
              </span>
              <NotesEditor labelId={notesLabelId} onChange={setNotesHtml} />
              <FieldError message={fieldErrors.notesHtml} />
            </div>
          </>
        ) : (
          <div>
            <FormLabel htmlFor={noteId}>Note (optional)</FormLabel>
            <textarea
              id={noteId}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={textareaClasses}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" disabled={saving} className="w-full sm:w-auto">
          {saving ? "Saving…" : kind === "conversation" ? "Save Conversation" : "Save Attempt"}
        </Button>
      </form>
    </div>
  );
}
