"use client";

import Link from "next/link";
import { useId, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";

import { Button, Card } from "@/components/ui";
import type { OpenActionItem } from "@/lib/blended-learning-mentee-detail";

import { ActionItemMeta, OwnerPill } from "../ActionItemMeta";
import {
  buildEntryPayload,
  initialEntryValues,
  missingFields,
  photosPending,
  postEntry,
  toggled,
  type EntryFormValues,
  type FieldErrors,
  type Kind,
  type ReviewDraft,
} from "./logEntryPayload";
import type { PickedPhoto } from "./PhotoPicker";
import { RecordingCard, type PendingDraft } from "./RecordingCard";
import { SavedConfirmation } from "./SavedConfirmation";
import { savedEntry, type Saved, type SavedEntry } from "./savedSummary";
import { SessionDetailsCard, type ChangeValues } from "./SessionDetailsCard";
import { WriteUpCard } from "./WriteUpCard";

// Log a Conversation or an Attempt for one Mentee, as three cards: Session
// details, Recording and Write-up, with a sticky save bar. One column on
// mobile with the last-conversation and Open Action Items panels on top; they
// sit beside the form from 1024 px. Only a Conversation adds Action Items or
// ticks earlier ones done, attaches photos and raises Mentor Flags. Instead of
// typing the write-up, a Conversation's Call Recording can be uploaded to
// start a Conversation Draft. The draft's progress then shows in the Recording
// card, with the write-up held until it is ready; the page refreshes and the
// form opens prefilled from it, and saving turns the draft into this
// Conversation. After saving, a confirmation shows what was saved and what
// the Student list now says.

export type { ReviewDraft };

// Owner pill, text and agreed date, as on the detail page.
function OpenItemText({ item }: { item: OpenActionItem }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2.5">
      <OwnerPill owner={item.owner} />
      <span className="min-w-0 break-words">
        {item.text}
        <ActionItemMeta agreedOn={item.agreedOn} />
      </span>
    </span>
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
                  <OpenItemText item={item} />
                </label>
              ) : (
                <div className="py-1">
                  <OpenItemText item={item} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
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
    <div className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:order-2">
      {lastConversationPanel}
      {openActionItems.length > 0 && (
        <OpenActionItemsPanel items={openActionItems} canTick={canTick} ticked={ticked} onToggle={onToggle} />
      )}
    </div>
  );
}

function title(kind: Kind, draft: ReviewDraft | null, name: string): string {
  if (draft) return `Review the draft for ${name}`;
  return kind === "conversation" ? "Log a conversation" : "Log an attempt";
}

function LogHeading({ heading, subtitle }: { heading: string; subtitle: string }) {
  return (
    <div>
      <h1 className="break-words text-2xl font-bold text-text-primary sm:text-3xl">{heading}</h1>
      {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
    </div>
  );
}

// Saving the entry: the error to show and whether a save is in flight. A
// failure's field errors replace the form's; a success goes to `onSaved`.
function useEntrySave(
  studentId: number,
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>,
  onSaved: (saved: Saved) => void
) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(entry: SavedEntry, body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    const outcome = await postEntry(studentId, body);
    setSaving(false);
    if (outcome.ok) {
      onSaved({ entry, mentee: outcome.mentee });
      return;
    }
    if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
    setError(outcome.error);
  }

  return { error, setError, saving, save };
}

function submitLabel(saving: boolean, kind: Kind, drafting: boolean): string {
  if (drafting) return "Drafting…";
  if (saving) return "Saving…";
  return kind === "conversation" ? "Save conversation" : "Log attempt";
}

// What the save bar says on its left: the save's error, or what is missing.
function SaveBarMessage({ error, hint, hintId }: { error: string | null; hint: string | null; hintId: string }) {
  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!hint) return null;
  return (
    <p id={hintId} className="text-sm text-text-secondary">
      {hint}
    </p>
  );
}

// Sticky at the bottom: Cancel back to the Mentee, and Save, disabled until
// the required fields are filled in, which it lists.
function SaveBar({
  studentId,
  error,
  saving,
  kind,
  drafting,
  missing,
}: {
  studentId: number;
  error: string | null;
  saving: boolean;
  kind: Kind;
  drafting: boolean;
  missing: string[];
}) {
  const hintId = useId();
  const hint = missing.length > 0 && !drafting ? `To save, fill in: ${missing.join(", ")}.` : null;
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-border bg-bg pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="mr-auto min-w-0 basis-full sm:basis-0 sm:grow">
        <SaveBarMessage error={error} hint={hint} hintId={hintId} />
      </div>
      <Link
        href={`/blended-learning/students/${studentId}`}
        className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-bold text-text-secondary hover:bg-hover-bg hover:text-text-primary"
      >
        Cancel
      </Link>
      <Button
        type="submit"
        disabled={saving || drafting || missing.length > 0}
        aria-describedby={hint && !error ? hintId : undefined}
      >
        {submitLabel(saving, kind, drafting)}
      </Button>
    </div>
  );
}

// A Conversation waits for its draft to be drafted; an Attempt can still be
// saved.
function waitsForDraft(kind: Kind, pendingDraft: PendingDraft | null): boolean {
  return kind === "conversation" && pendingDraft?.state === "transcribing";
}

type LogEntryFormProps = {
  studentId: number;
  name: string;
  firstName: string;
  // Under the title: the Mentee's name, grade and program.
  subtitle?: string;
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
};

function EntryForm({
  props,
  values,
  change,
  setValues,
  onSaved,
}: {
  props: LogEntryFormProps;
  values: EntryFormValues;
  change: ChangeValues;
  setValues: Dispatch<SetStateAction<EntryFormValues>>;
  onSaved: (saved: Saved) => void;
}) {
  const { studentId, draft = null, pendingDraft = null } = props;
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const { error, setError, saving, save } = useEntrySave(studentId, setFieldErrors, onSaved);
  const { kind } = values;
  const drafting = waitsForDraft(kind, pendingDraft);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (photosPending(kind, photos)) {
      setError("Wait for the photos to finish uploading, or remove the ones that failed.");
      return;
    }
    void save(savedEntry(values, photos), buildEntryPayload(values, photos, draft?.id ?? null));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
      <SidePanels
        lastConversationPanel={props.lastConversationPanel}
        openActionItems={props.openActionItems}
        canTick={kind === "conversation"}
        ticked={values.ticked}
        onToggle={(id) => change(({ ticked }) => ({ ticked: toggled(ticked, id) }))}
      />
      <form
        aria-label="Log a Conversation or Attempt"
        noValidate
        onSubmit={submit}
        className="min-w-0 space-y-4 lg:order-1"
      >
        <SessionDetailsCard
          reviewing={draft !== null}
          today={props.today}
          values={values}
          change={change}
          fieldErrors={fieldErrors}
          onKindChange={(next) => {
            setValues((current) => ({ ...current, kind: next }));
            setFieldErrors({});
            setError(null);
          }}
        />
        {kind === "conversation" && (
          <>
            <RecordingCard
              studentId={studentId}
              firstName={props.firstName}
              reviewing={draft !== null}
              hasOpenDraft={props.hasOpenDraft}
              pendingDraft={pendingDraft}
              canManageDraft={props.canManageDraft ?? false}
              values={values}
            />
            <WriteUpCard
              studentId={studentId}
              reviewing={draft !== null}
              drafting={pendingDraft?.state === "transcribing"}
              values={values}
              change={change}
              photos={photos}
              setPhotos={setPhotos}
              fieldErrors={fieldErrors}
              setFieldErrors={setFieldErrors}
            />
          </>
        )}
        <SaveBar
          studentId={studentId}
          error={error}
          saving={saving}
          kind={kind}
          drafting={drafting}
          missing={missingFields(values)}
        />
      </form>
    </div>
  );
}

export function LogEntryForm(props: LogEntryFormProps) {
  const { name, draft = null } = props;
  const [values, setValues] = useState(() => initialEntryValues(draft, props.today));
  const [saved, setSaved] = useState<Saved | null>(null);
  const change: ChangeValues = (update) => setValues((current) => ({ ...current, ...update(current) }));

  return (
    <div className="space-y-5">
      <LogHeading heading={title(values.kind, draft, name)} subtitle={props.subtitle ?? ""} />
      {saved ? (
        <SavedConfirmation
          saved={saved}
          studentId={props.studentId}
          name={name}
          firstName={props.firstName}
          forOwnList={props.forOwnList}
        />
      ) : (
        <EntryForm props={props} values={values} change={change} setValues={setValues} onSaved={setSaved} />
      )}
    </div>
  );
}
