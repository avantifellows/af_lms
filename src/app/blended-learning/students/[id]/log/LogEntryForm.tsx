"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";

import { Button, Card, FormLabel, Input, Select } from "@/components/ui";
import { baseInputClasses } from "@/components/ui/styles";
import type { ActionItemOwner, OpenActionItem } from "@/lib/blended-learning-mentee-detail";
import type { MenteeRow } from "@/lib/blended-learning-mentees";

import { LastContact, WhyNowTags } from "../../../MenteeList";
import { ACTION_ITEM_OWNER, ActionItemMeta } from "../ActionItemMeta";
import { DraftStatus } from "../DraftStatus";
import { FLAG_SWITCH } from "../flagRecipients";
import {
  buildEntryPayload,
  durationMinutes,
  FLAG_RECIPIENTS,
  initialEntryValues,
  photosPending,
  postEntry,
  raisedFlags,
  toggled,
  withoutFieldErrors,
  type DraftActionItem,
  type DraftFlags,
  type EntryFormValues,
  type FieldErrors,
  type Kind,
  type ReviewDraft,
} from "./logEntryPayload";
import { NotesEditor } from "./NotesEditor";
import { PhotoPicker, type PickedPhoto } from "./PhotoPicker";
import { RecordingUpload } from "./RecordingUpload";

// Log a Conversation or an Attempt for one Mentee. One column on mobile with
// the last-conversation and Open Action Items panels on top; they sit beside
// the form from 1024 px. Only a Conversation adds Action Items or ticks
// earlier ones done, attaches photos and raises Mentor Flags. Instead of
// typing the write-up, a Conversation's Call Recording can be uploaded to
// start a Conversation Draft. The draft's progress then shows in place of the
// upload, with the write-up fields held until it is ready; the page refreshes
// and the form opens prefilled from it, and saving turns the draft into this
// Conversation. After saving, a confirmation shows what the Mentee list now
// says.

export type { ReviewDraft };

type Saved = { kind: Kind; mentee: MenteeRow | null };
// An open Conversation Draft that is not ready yet: being drafted, or failed.
type PendingDraft = { id: number; state: "transcribing" | "failed"; retryOffered: boolean };
// Updates some of the form's values from their current ones.
type ChangeValues = (change: (values: EntryFormValues) => Partial<EntryFormValues>) => void;

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
const TEXTAREA_CLASSES = `w-full ${baseInputClasses}`;
// The log page checks a draft being drafted this often.
const PENDING_DRAFT_POLL_MS = 5_000;

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

function OpenActionItemsPanel({
  items,
  canTick,
  ticked,
  onToggle,
}: {
  items: OpenActionItem[];
  canTick: boolean;
  ticked: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <section aria-label="Open Action Items">
      <Card elevation="sm" className="space-y-2 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Open Action Items</h3>
        <p className="text-xs text-text-secondary">
          {canTick ? "Tick the ones done in this Conversation." : "Only a Conversation can tick these done."}
        </p>
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id} className="break-words text-sm text-text-primary">
              {canTick ? (
                <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                  <input
                    type="checkbox"
                    checked={ticked.has(item.id)}
                    onChange={() => onToggle(item.id)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
                  />
                  <span className="min-w-0">
                    {item.text}
                    <ActionItemMeta owner={item.owner} dueOn={item.dueOn} agreedOn={item.agreedOn} />
                  </span>
                </label>
              ) : (
                <div className="py-1">
                  {item.text}
                  <ActionItemMeta owner={item.owner} dueOn={item.dueOn} agreedOn={item.agreedOn} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function ActionItemsEditor({
  items,
  errors,
  onChange,
  onAdd,
  onRemove,
}: {
  items: DraftActionItem[];
  errors: FieldErrors;
  onChange: (key: number, change: Partial<DraftActionItem>) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
}) {
  const ids = useId();
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
        Action Items (optional)
      </legend>
      {items.map((item, index) => {
        const name = `Action Item ${index + 1}`;
        const prefix = `${ids}-${item.key}`;
        const error = (field: string) => errors[`actionItems.${index}.${field}`];
        return (
          <div key={item.key} role="group" aria-label={name} className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-text-primary">{name}</span>
              <Button type="button" variant="ghost" onClick={() => onRemove(item.key)}>
                Remove
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <div>
                <FormLabel htmlFor={`${prefix}-owner`}>Owner</FormLabel>
                <Select
                  id={`${prefix}-owner`}
                  value={item.owner}
                  onChange={(event) => onChange(item.key, { owner: event.target.value as DraftActionItem["owner"] })}
                  aria-invalid={Boolean(error("owner"))}
                >
                  <option value="">Choose…</option>
                  {(Object.keys(ACTION_ITEM_OWNER) as ActionItemOwner[]).map((owner) => (
                    <option key={owner} value={owner}>
                      {ACTION_ITEM_OWNER[owner]}
                    </option>
                  ))}
                </Select>
                <FieldError message={error("owner")} />
              </div>
              <div>
                <FormLabel htmlFor={`${prefix}-text`}>What</FormLabel>
                <textarea
                  id={`${prefix}-text`}
                  rows={2}
                  value={item.text}
                  onChange={(event) => onChange(item.key, { text: event.target.value })}
                  aria-invalid={Boolean(error("text"))}
                  className={`${TEXTAREA_CLASSES} resize-y`}
                />
                <FieldError message={error("text")} />
              </div>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="secondary" onClick={onAdd} className="w-full sm:w-auto">
        Add Action Item
      </Button>
      <FieldError message={errors.actionItems} />
    </fieldset>
  );
}

// As in the mockup: below a rule, the switches two to a row (one on mobile),
// then a comment field for each switched-on flag.
function MentorFlagsEditor({
  flags,
  errors,
  onChange,
}: {
  flags: DraftFlags;
  errors: FieldErrors;
  onChange: (flags: DraftFlags) => void;
}) {
  const ids = useId();
  // Errors are keyed by position among the switched-on flags, as submitted.
  const raised = raisedFlags(flags);
  const flagErrors = Object.entries(errors).filter(([field]) => field === "flags" || field.startsWith("flags."));
  return (
    <fieldset className="space-y-4 border-t border-border pt-5">
      <legend className="sr-only">Mentor Flags (optional)</legend>
      <div className="grid gap-x-7 gap-y-1 sm:grid-cols-2">
        {FLAG_RECIPIENTS.map((recipient) => {
          const on = flags[recipient] !== undefined;
          const { label, hint } = FLAG_SWITCH[recipient];
          return (
            <label key={recipient} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                role="switch"
                checked={on}
                onChange={() => {
                  const next = { ...flags };
                  if (on) delete next[recipient];
                  else next[recipient] = "";
                  onChange(next);
                }}
                className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-border transition-colors before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-bg-card before:shadow-sm before:transition-transform checked:bg-accent checked:before:translate-x-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
              <span className="text-sm font-bold text-text-primary">
                {label}
                {hint && <span className="font-normal text-text-muted">{` ${hint}`}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {raised.map((recipient, index) => {
        const { commentFor, placeholder, help } = FLAG_SWITCH[recipient];
        const commentId = `${ids}-${recipient}-comment`;
        const commentError = errors[`flags.${index}.comment`];
        return (
          <div key={recipient}>
            <FormLabel htmlFor={commentId}>{`Comment for ${commentFor} (optional)`}</FormLabel>
            <Input
              id={commentId}
              value={flags[recipient]}
              placeholder={placeholder}
              onChange={(event) => onChange({ ...flags, [recipient]: event.target.value })}
              aria-invalid={Boolean(commentError)}
            />
            <p className="mt-1 text-xs text-text-secondary">{help}</p>
            <FieldError message={commentError} />
          </div>
        );
      })}
      {flagErrors
        .filter(([field]) => !field.endsWith(".comment"))
        .map(([field, message]) => (
          <FieldError key={field} message={message} />
        ))}
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

function SavedListSummary({ mentee, name, forOwnList }: { mentee: MenteeRow; name: string; forOwnList: boolean }) {
  const group = mentee.reasons.length > 0 ? "Talk to First" : "Everyone else";
  return (
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
  return (
    <section aria-label="Saved">
      <Card elevation="sm" className="space-y-4 p-4 sm:p-6">
        <h2 className="text-lg font-bold text-text-primary">
          {saved.kind === "conversation" ? "Conversation saved" : "Attempt saved"}
        </h2>
        {saved.mentee && <SavedListSummary mentee={saved.mentee} name={name} forOwnList={forOwnList} />}
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

// Where a Conversation's Call Recording can be uploaded: not while reviewing
// a draft. A draft being drafted, or one that failed, shows its progress and
// controls here instead; once it is ready the page refreshes to open it.
function RecordingSlot({
  studentId,
  firstName,
  reviewing,
  hasOpenDraft,
  pendingDraft,
  canManageDraft,
  values,
}: {
  studentId: number;
  firstName: string;
  reviewing: boolean;
  hasOpenDraft: boolean;
  pendingDraft: PendingDraft | null;
  canManageDraft: boolean;
  values: EntryFormValues;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  if (reviewing) return null;
  if (pendingDraft) {
    return (
      <DraftStatus
        key={pendingDraft.id}
        draftId={pendingDraft.id}
        initialState={pendingDraft.state}
        initialRetryOffered={pendingDraft.retryOffered}
        canManage={canManageDraft}
        pollMs={PENDING_DRAFT_POLL_MS}
        onReady={refresh}
        drafting="Writing the summary, action items and notes from the recording. They fill in below when ready, usually within a couple of minutes. You can leave this page and come back."
      />
    );
  }
  if (hasOpenDraft) {
    return (
      <p className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary">
        {`${firstName} already has a Conversation Draft, so no recording can be uploaded now.`}
      </p>
    );
  }
  return (
    <RecordingUpload
      studentId={studentId}
      sessionDetails={{
        occurredOn: values.occurredOn || null,
        mode: values.mode,
        spokeWith: values.spokeWith,
        durationMinutes: durationMinutes(values.duration),
      }}
    />
  );
}

// Held in place of the write-up while the draft is being drafted.
function DraftingPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-3">
      {["Summary", "Action Items", "Notes"].map((label) => (
        <div key={label}>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">{label}</span>
          <div className="h-16 animate-pulse rounded-lg bg-hover-bg" />
        </div>
      ))}
    </div>
  );
}

// The fields only a Conversation has.
function ConversationFields({
  studentId,
  firstName,
  reviewing,
  hasOpenDraft,
  pendingDraft,
  canManageDraft,
  values,
  change,
  photos,
  setPhotos,
  fieldErrors,
  setFieldErrors,
}: {
  studentId: number;
  firstName: string;
  reviewing: boolean;
  hasOpenDraft: boolean;
  pendingDraft: PendingDraft | null;
  canManageDraft: boolean;
  values: EntryFormValues;
  change: ChangeValues;
  photos: PickedPhoto[];
  setPhotos: Dispatch<SetStateAction<PickedPhoto[]>>;
  fieldErrors: FieldErrors;
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
}) {
  const ids = useId();
  const durationId = `${ids}-duration`;
  const summaryId = `${ids}-summary`;
  const notesLabelId = `${ids}-notes-label`;
  // Per-item errors are keyed by position, which a removal or switch shifts.
  const clearErrors = (prefix: string) => setFieldErrors((errors) => withoutFieldErrors(errors, prefix));

  return (
    <>
      <ChoiceGroup
        legend="Mode"
        name="mode"
        options={MODES}
        value={values.mode}
        onChange={(mode) => change(() => ({ mode }))}
        error={fieldErrors.mode}
      />
      <ChoiceGroup
        legend="Spoke with"
        name="spokeWith"
        options={SPOKE_WITH}
        value={values.spokeWith}
        onChange={(spokeWith) => change(() => ({ spokeWith }))}
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
          value={values.duration}
          onChange={(event) => change(() => ({ duration: event.target.value }))}
          aria-invalid={Boolean(fieldErrors.durationMinutes)}
          className="sm:max-w-[10rem]"
        />
        <FieldError message={fieldErrors.durationMinutes} />
      </div>
      <RecordingSlot
        studentId={studentId}
        firstName={firstName}
        reviewing={reviewing}
        hasOpenDraft={hasOpenDraft}
        pendingDraft={pendingDraft}
        canManageDraft={canManageDraft}
        values={values}
      />
      {pendingDraft?.state === "transcribing" ? (
        <DraftingPlaceholder />
      ) : (
        <WriteUpFields
          summaryId={summaryId}
          notesLabelId={notesLabelId}
          values={values}
          change={change}
          fieldErrors={fieldErrors}
          clearErrors={clearErrors}
        />
      )}
      <PhotoPicker
        studentId={studentId}
        photos={photos}
        setPhotos={(next) => {
          setPhotos(next);
          clearErrors("photoKeys");
        }}
        errors={fieldErrors}
      />
      <MentorFlagsEditor
        flags={values.flags}
        errors={fieldErrors}
        onChange={(flags) => {
          change(() => ({ flags }));
          clearErrors("flags");
        }}
      />
    </>
  );
}

// The write-up: Summary, Action Items, then Notes.
function WriteUpFields({
  summaryId,
  notesLabelId,
  values,
  change,
  fieldErrors,
  clearErrors,
}: {
  summaryId: string;
  notesLabelId: string;
  values: EntryFormValues;
  change: ChangeValues;
  fieldErrors: FieldErrors;
  clearErrors: (prefix: string) => void;
}) {
  return (
    <>
      <div>
        <FormLabel htmlFor={summaryId}>Summary</FormLabel>
        <textarea
          id={summaryId}
          rows={3}
          value={values.summary}
          onChange={(event) => change(() => ({ summary: event.target.value }))}
          aria-invalid={Boolean(fieldErrors.summary)}
          className={TEXTAREA_CLASSES}
        />
        <FieldError message={fieldErrors.summary} />
      </div>
      <ActionItemsEditor
        items={values.actionItems}
        errors={fieldErrors}
        onChange={(key, itemChange) =>
          change(({ actionItems }) => ({
            actionItems: actionItems.map((item) => (item.key === key ? { ...item, ...itemChange } : item)),
          }))
        }
        onAdd={() =>
          change(({ actionItems, nextItemKey }) => ({
            actionItems: [...actionItems, { key: nextItemKey, owner: "", text: "" }],
            nextItemKey: nextItemKey + 1,
          }))
        }
        onRemove={(key) => {
          change(({ actionItems }) => ({ actionItems: actionItems.filter((item) => item.key !== key) }));
          clearErrors("actionItems");
        }}
      />
      <div>
        <span id={notesLabelId} className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
          Notes (optional)
        </span>
        {/* Switching to Attempt unmounts the editor; it comes back with
            the notes it last showed, so what is saved is what is seen. */}
        <NotesEditor
          labelId={notesLabelId}
          initialHtml={values.notesHtml}
          onChange={(notesHtml) => change(() => ({ notesHtml }))}
        />
        <FieldError message={fieldErrors.notesHtml} />
      </div>
    </>
  );
}

function AttemptFields({ note, onChange }: { note: string; onChange: (note: string) => void }) {
  const noteId = `${useId()}-note`;
  return (
    <div>
      <FormLabel htmlFor={noteId}>Note (optional)</FormLabel>
      <textarea
        id={noteId}
        rows={3}
        value={note}
        onChange={(event) => onChange(event.target.value)}
        className={TEXTAREA_CLASSES}
      />
    </div>
  );
}

function SidePanels({
  lastConversationPanel,
  openActionItems,
  canTick,
  ticked,
  onToggle,
}: {
  lastConversationPanel: ReactNode;
  openActionItems: OpenActionItem[];
  canTick: boolean;
  ticked: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <div className="min-w-0 space-y-4 lg:order-2">
      {lastConversationPanel}
      {openActionItems.length > 0 && (
        <OpenActionItemsPanel items={openActionItems} canTick={canTick} ticked={ticked} onToggle={onToggle} />
      )}
    </div>
  );
}

// Saving the entry: the error to show, whether a save is in flight, and what
// was saved. A failure's field errors replace the form's.
function useEntrySave(studentId: number, setFieldErrors: Dispatch<SetStateAction<FieldErrors>>) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);

  async function save(kind: Kind, body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    const outcome = await postEntry(studentId, body);
    setSaving(false);
    if (outcome.ok) {
      setSaved({ kind, mentee: outcome.mentee });
      return;
    }
    if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
    setError(outcome.error);
  }

  return { error, setError, saving, saved, save };
}

function FormAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );
}

function submitLabel(saving: boolean, kind: Kind, drafting: boolean): string {
  if (drafting) return "Drafting…";
  if (saving) return "Saving…";
  return kind === "conversation" ? "Save Conversation" : "Save Attempt";
}

function SubmitButton({ saving, kind, drafting }: { saving: boolean; kind: Kind; drafting: boolean }) {
  return (
    <Button type="submit" disabled={saving || drafting} className="w-full sm:w-auto">
      {submitLabel(saving, kind, drafting)}
    </Button>
  );
}

// A Conversation waits for its draft to be drafted; an Attempt can still be
// saved.
function waitsForDraft(kind: Kind, pendingDraft: PendingDraft | null): boolean {
  return kind === "conversation" && pendingDraft?.state === "transcribing";
}

export function LogEntryForm({
  studentId,
  name,
  firstName,
  today,
  forOwnList,
  lastConversationPanel,
  openActionItems,
  hasOpenDraft,
  draft = null,
  pendingDraft = null,
  canManageDraft = false,
}: {
  studentId: number;
  name: string;
  firstName: string;
  today: string;
  // A Mentor logs on their own list; an admin logs on the mapped Mentor's.
  forOwnList: boolean;
  lastConversationPanel: ReactNode;
  // Open Action Items from earlier Conversations; a Conversation can tick them.
  openActionItems: OpenActionItem[];
  // A Mentee has at most one open Conversation Draft, so no second upload.
  hasOpenDraft: boolean;
  // A ready Conversation Draft to review and save as this Conversation.
  draft?: ReviewDraft | null;
  // An open draft that isn't ready yet; its progress shows in the form.
  pendingDraft?: PendingDraft | null;
  canManageDraft?: boolean;
}) {
  const dateId = `${useId()}-date`;
  const [values, setValues] = useState(() => initialEntryValues(draft, today));
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const { error, setError, saving, saved, save } = useEntrySave(studentId, setFieldErrors);
  const change: ChangeValues = (update) => setValues((current) => ({ ...current, ...update(current) }));
  const { kind } = values;
  const drafting = waitsForDraft(kind, pendingDraft);

  if (saved) {
    return (
      <Confirmation saved={saved} studentId={studentId} name={name} firstName={firstName} forOwnList={forOwnList} />
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (photosPending(kind, photos)) {
      setError("Wait for the photos to finish uploading, or remove the ones that failed.");
      return;
    }
    void save(kind, buildEntryPayload(values, photos, draft?.id ?? null));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <SidePanels
        lastConversationPanel={lastConversationPanel}
        openActionItems={openActionItems}
        canTick={kind === "conversation"}
        ticked={values.ticked}
        onToggle={(id) => change(({ ticked }) => ({ ticked: toggled(ticked, id) }))}
      />
      <div className="min-w-0 space-y-4 lg:order-1">
        <form
          aria-label="Log a Conversation or Attempt"
          noValidate
          onSubmit={submit}
          className="min-w-0 space-y-5 rounded-lg border border-border bg-bg-card p-4 shadow-sm sm:p-6"
        >
          {/* A draft is saved as a Conversation only. */}
          {!draft && (
            <ChoiceGroup
              legend="What happened"
              name="kind"
              options={KINDS}
              value={kind}
              onChange={(next) => {
                change(() => ({ kind: next }));
                setFieldErrors({});
                setError(null);
              }}
              error={fieldErrors.kind}
            />
          )}

          <div>
            <FormLabel htmlFor={dateId}>Date</FormLabel>
            <Input
              id={dateId}
              type="date"
              value={values.occurredOn}
              max={today}
              onChange={(event) => change(() => ({ occurredOn: event.target.value }))}
              aria-invalid={Boolean(fieldErrors.occurredOn)}
              className="sm:max-w-xs"
            />
            <FieldError message={fieldErrors.occurredOn} />
          </div>

          {kind === "conversation" ? (
            <ConversationFields
              studentId={studentId}
              firstName={firstName}
              reviewing={draft !== null}
              hasOpenDraft={hasOpenDraft}
              pendingDraft={pendingDraft}
              canManageDraft={canManageDraft}
              values={values}
              change={change}
              photos={photos}
              setPhotos={setPhotos}
              fieldErrors={fieldErrors}
              setFieldErrors={setFieldErrors}
            />
          ) : (
            <AttemptFields note={values.note} onChange={(note) => change(() => ({ note }))} />
          )}

          <FormAlert error={error} />

          <SubmitButton saving={saving} kind={kind} drafting={drafting} />
        </form>
      </div>
    </div>
  );
}
