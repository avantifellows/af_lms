import type { ActionItemOwner, FlagRecipient } from "@/lib/blended-learning-mentee-detail";
import type { MenteeRow } from "@/lib/blended-learning-mentees";

import { FLAG_RECIPIENT } from "../flagRecipients";
import type { PickedPhoto } from "./PhotoPicker";

// The log form's values and what it sends (pure): its starting values, the
// entries request body built from them, and the request itself.

export type Kind = "conversation" | "attempt";
type Mode = "call" | "in_person";
type SpokeWith = "student" | "parent_or_sibling" | "both";
// Keyed by field, e.g. `summary` or `actionItems.0.text`.
export type FieldErrors = Record<string, string>;
export type DraftActionItem = { key: number; owner: ActionItemOwner | ""; text: string; dueOn: string };
// A switched-on Flag Recipient maps to its comment; off is absent.
export type DraftFlags = Partial<Record<FlagRecipient, string>>;
export const FLAG_RECIPIENTS = Object.keys(FLAG_RECIPIENT) as FlagRecipient[];

// A ready Conversation Draft, as the form opens it. Session details are those
// the Mentor entered before uploading; `notesHtml` is the drafted notes with
// their text escaped.
export type ReviewDraft = {
  id: number;
  occurredOn: string | null;
  mode: Mode | null;
  spokeWith: SpokeWith | null;
  durationMinutes: number | null;
  summary: string;
  actionItems: { owner: ActionItemOwner; text: string; dueOn: string | null }[];
  notesHtml: string;
  itemsToVerify: string[];
};

// Everything the form holds except photos, which the PhotoPicker updates.
export type EntryFormValues = {
  kind: Kind;
  occurredOn: string;
  mode: Mode | null;
  spokeWith: SpokeWith | null;
  // As typed; blank is no duration.
  duration: string;
  summary: string;
  notesHtml: string;
  note: string;
  actionItems: DraftActionItem[];
  // The key the next added Action Item gets.
  nextItemKey: number;
  // Earlier open Action Items ticked done.
  ticked: Set<number>;
  flags: DraftFlags;
};

// A new form, prefilled from the draft under review if there is one.
export function initialEntryValues(draft: ReviewDraft | null, today: string): EntryFormValues {
  const actionItems = (draft?.actionItems ?? []).map((item, index) => ({
    key: index + 1,
    owner: item.owner,
    text: item.text,
    dueOn: item.dueOn ?? "",
  }));
  return {
    kind: "conversation",
    occurredOn: draft?.occurredOn ?? today,
    mode: draft?.mode ?? null,
    spokeWith: draft?.spokeWith ?? null,
    duration: draft?.durationMinutes ? String(draft.durationMinutes) : "",
    summary: draft?.summary ?? "",
    notesHtml: draft?.notesHtml ?? "",
    note: "",
    actionItems,
    nextItemKey: actionItems.length + 1,
    ticked: new Set(),
    flags: {},
  };
}

export function durationMinutes(duration: string): number | null {
  return duration.trim() === "" ? null : Number(duration);
}

// A copy of the set with `value` added, or removed if it was there.
export function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// The errors without those keyed under `prefix`; per-item errors are keyed by
// position, which removing or switching an item shifts.
export function withoutFieldErrors(errors: FieldErrors, prefix: string): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([field]) => !field.startsWith(prefix)));
}

// The switched-on Flag Recipients, in display order.
export function raisedFlags(flags: DraftFlags): FlagRecipient[] {
  return FLAG_RECIPIENTS.filter((recipient) => flags[recipient] !== undefined);
}

// A Conversation can't be saved while a photo is uploading or has failed.
export function photosPending(kind: Kind, photos: PickedPhoto[]): boolean {
  return kind === "conversation" && photos.some((photo) => photo.status !== "done");
}

// The entries request body. Only a Conversation carries Action Items, photos,
// Mentor Flags, ticks and the reviewed draft.
export function buildEntryPayload(
  values: EntryFormValues,
  photos: PickedPhoto[],
  draftId: number | null
): Record<string, unknown> {
  const { kind, occurredOn } = values;
  if (kind === "attempt") return { kind, occurredOn, note: values.note };
  return {
    kind,
    occurredOn,
    mode: values.mode,
    spokeWith: values.spokeWith,
    durationMinutes: durationMinutes(values.duration),
    summary: values.summary,
    notesHtml: values.notesHtml,
    actionItems: values.actionItems.map((item) => ({ owner: item.owner, text: item.text, dueOn: item.dueOn || null })),
    photoKeys: photos.map((photo) => photo.s3Key),
    flags: raisedFlags(values.flags).map((recipient) => ({ recipient, comment: values.flags[recipient] || null })),
    completeActionItemIds: [...values.ticked],
    ...(draftId !== null ? { draftId } : {}),
  };
}

// The save's outcome. A failure's `fieldErrors` replace the form's, or are
// null when the request never reached the server (the form keeps its own).
export type EntrySaveOutcome =
  | { ok: true; mentee: MenteeRow | null }
  | { ok: false; fieldErrors: FieldErrors | null; error: string | null };

export async function postEntry(studentId: number, body: Record<string, unknown>): Promise<EntrySaveOutcome> {
  try {
    const res = await fetch(`/api/blended-learning/students/${studentId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, mentee: json.mentee ?? null };
    if (json.fieldErrors) return { ok: false, fieldErrors: json.fieldErrors, error: null };
    return { ok: false, fieldErrors: {}, error: json.error ?? "Couldn't save. Try again." };
  } catch {
    return { ok: false, fieldErrors: null, error: "Couldn't save. Check your connection and try again." };
  }
}
