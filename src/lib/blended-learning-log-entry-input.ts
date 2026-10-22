import { isCalendarDate, oneOf } from "./blended-learning-format";
import { sanitiseNotesHtml } from "./blended-learning-notes-sanitiser";
import { MAX_CONVERSATION_PHOTOS, photoKeyContentType } from "./blended-learning-photos";
import {
  requiredDateError,
  requiredSessionErrors,
  type FieldErrors,
  type SessionDetails,
} from "./blended-learning-session-details";

// Field-level validation of a log entry request (pure apart from the S3 key
// prefix): a Conversation or an Attempt. Errors are keyed by field, or per
// item for lists (e.g. `actionItems.1.text`), and reported in field order.

type ActionItemOwner = "student" | "mentor" | "parent";
export type ActionItemInput = { owner: ActionItemOwner; text: string; dueOn: string | null };
type FlagRecipient = "emotional_wellbeing" | "physics" | "chemistry" | "maths";
export type FlagInput = { recipient: FlagRecipient; comment: string | null };
// An uploaded photo, already under this Student's photo prefix.
export type PhotoInput = { s3Key: string; contentType: string };

export type ConversationInput = {
  kind: "conversation";
  occurredOn: string;
  mode: NonNullable<SessionDetails["mode"]>;
  spokeWith: NonNullable<SessionDetails["spokeWith"]>;
  durationMinutes: number;
  summary: string;
  notesHtml: string | null;
  actionItems: ActionItemInput[];
  photos: PhotoInput[];
  flags: FlagInput[];
  // Earlier open Action Items this Conversation marks done.
  completeActionItemIds: number[];
  // The ready Conversation Draft this Conversation was reviewed from.
  draftId: number | null;
};
type AttemptInput = { kind: "attempt"; occurredOn: string; note: string | null };
export type EntryInput = ConversationInput | AttemptInput;

export type ValidatedEntry = { ok: true; input: EntryInput } | { ok: false; fieldErrors: FieldErrors };

const ACTION_ITEM_OWNERS = ["student", "mentor", "parent"] as const;
const FLAG_RECIPIENTS = ["emotional_wellbeing", "physics", "chemistry", "maths"] as const;

// What only a Conversation carries, with the error an Attempt gets for it.
const CONVERSATION_ONLY: [field: string, message: string][] = [
  ["actionItems", "An Attempt can't have Action Items."],
  ["photoKeys", "An Attempt can't have photos."],
  ["flags", "An Attempt can't have Mentor Flags."],
  ["completeActionItemIds", "Only a Conversation can tick Action Items done."],
];

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isNullish(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
}

function outcome(errors: FieldErrors, input: EntryInput): ValidatedEntry {
  return Object.keys(errors).length > 0 ? { ok: false, fieldErrors: errors } : { ok: true, input };
}

// `today` is the IST calendar date; an entry can be dated today or earlier.
export function validateEntry(raw: unknown, today: string, studentId: number): ValidatedEntry {
  const body = asRecord(raw);
  if (body.kind === "attempt") return validateAttempt(body, today);
  if (body.kind === "conversation") return validateConversation(body, today, studentId);
  return { ok: false, fieldErrors: { kind: "Choose a Conversation or an Attempt." } };
}

function validateAttempt(body: Record<string, unknown>, today: string): ValidatedEntry {
  const errors: FieldErrors = {};
  const date = requiredDateError(body.occurredOn, today);
  if (date) errors.occurredOn = date;
  for (const [field, message] of CONVERSATION_ONLY) {
    if (body[field] !== undefined) errors[field] = message;
  }
  if (!isNullish(body.draftId)) errors.draftId = "A Conversation Draft can only be saved as a Conversation.";
  return outcome(errors, { kind: "attempt", occurredOn: body.occurredOn as string, note: optionalText(body.note) });
}

function validateConversation(body: Record<string, unknown>, today: string, studentId: number): ValidatedEntry {
  const errors = requiredSessionErrors(body, today);
  const summary = optionalText(body.summary);
  if (!summary) errors.summary = "Add a summary.";
  const notesHtml = validateNotes(body.notesHtml, errors);
  return outcome(errors, {
    kind: "conversation",
    occurredOn: body.occurredOn as string,
    mode: body.mode as ConversationInput["mode"],
    spokeWith: body.spokeWith as ConversationInput["spokeWith"],
    durationMinutes: body.durationMinutes as number,
    summary: summary as string,
    notesHtml,
    actionItems: validateActionItems(body.actionItems, errors),
    photos: validatePhotoKeys(body.photoKeys, studentId, errors),
    flags: validateFlags(body.flags, errors),
    completeActionItemIds: validateCompleteActionItemIds(body.completeActionItemIds, errors),
    draftId: validateDraftId(body.draftId, errors),
  });
}

// Notes are optional HTML, sanitised for storage.
function validateNotes(raw: unknown, errors: FieldErrors): string | null {
  if (!isNullish(raw) && typeof raw !== "string") {
    errors.notesHtml = "Notes must be text.";
    return null;
  }
  const notes = sanitiseNotesHtml(raw as string | null | undefined);
  if (notes.ok) return notes.html;
  errors.notesHtml = notes.error;
  return null;
}

// The ready Conversation Draft being saved, if any.
function validateDraftId(raw: unknown, errors: FieldErrors): number | null {
  if (isNullish(raw)) return null;
  if (!Number.isSafeInteger(raw) || (raw as number) <= 0) {
    errors.draftId = "This Conversation Draft isn't valid. Reload and try again.";
  }
  return raw as number;
}

// Ids of earlier Action Items to tick done, de-duplicated.
function validateCompleteActionItemIds(raw: unknown, errors: FieldErrors): number[] {
  if (isNullish(raw)) return [];
  if (!Array.isArray(raw) || !raw.every((id) => Number.isSafeInteger(id) && id > 0)) {
    errors.completeActionItemIds = "Choose Action Items from the list.";
    return [];
  }
  return [...new Set(raw as number[])];
}

// A list field: absent is empty, anything but an array is `notListMessage`.
function listOf(raw: unknown, field: string, notListMessage: string, errors: FieldErrors): unknown[] {
  if (isNullish(raw)) return [];
  if (Array.isArray(raw)) return raw;
  errors[field] = notListMessage;
  return [];
}

function validateDueOn(raw: unknown, key: string, errors: FieldErrors): string | null {
  if (isNullish(raw) || raw === "") return null;
  if (!isCalendarDate(raw)) errors[key] = "Enter a valid due date.";
  return raw as string;
}

// New Action Items: owner and text are required, the due date is optional.
function validateActionItems(raw: unknown, errors: FieldErrors): ActionItemInput[] {
  return listOf(raw, "actionItems", "Action Items must be a list.", errors).map((value, index) => {
    const item = asRecord(value);
    const text = optionalText(item.text);
    if (!oneOf(ACTION_ITEM_OWNERS, item.owner)) errors[`actionItems.${index}.owner`] = "Choose who owns this Action Item.";
    if (!text) errors[`actionItems.${index}.text`] = "Add the Action Item.";
    const dueOn = validateDueOn(item.dueOn, `actionItems.${index}.dueOn`, errors);
    return { owner: item.owner as ActionItemOwner, text: text ?? "", dueOn };
  });
}

// Photo keys from the upload route: at most five, each under this Student's
// photo prefix and attached once.
function validatePhotoKeys(raw: unknown, studentId: number, errors: FieldErrors): PhotoInput[] {
  const keys = listOf(raw, "photoKeys", "Photos must be a list.", errors);
  if (keys.length > MAX_CONVERSATION_PHOTOS) {
    errors.photoKeys = "A Conversation can have at most five photos.";
    return [];
  }
  const seen = new Set<unknown>();
  return keys.map((key, index) => {
    const contentType = photoKeyContentType(studentId, key);
    if (!contentType) errors[`photoKeys.${index}`] = "This photo isn't this Mentee's. Remove it and add it again.";
    else if (seen.has(key)) errors[`photoKeys.${index}`] = "Each photo can be attached once.";
    else seen.add(key);
    return { s3Key: key as string, contentType: contentType ?? "" };
  });
}

// The error for a flag's recipient, or null; `seen` tracks recipients so far.
function flagRecipientError(recipient: unknown, seen: Set<string>): string | null {
  if (!oneOf(FLAG_RECIPIENTS, recipient)) return "Choose who the flag is for.";
  if (seen.has(recipient)) return "Each Flag Recipient can be raised once.";
  seen.add(recipient);
  return null;
}

// Mentor Flags: at most one per Flag Recipient, each with an optional comment.
function validateFlags(raw: unknown, errors: FieldErrors): FlagInput[] {
  const seen = new Set<string>();
  return listOf(raw, "flags", "Mentor Flags must be a list.", errors).map((value, index) => {
    const flag = asRecord(value);
    const recipientError = flagRecipientError(flag.recipient, seen);
    if (recipientError) errors[`flags.${index}.recipient`] = recipientError;
    if (!isNullish(flag.comment) && typeof flag.comment !== "string") {
      errors[`flags.${index}.comment`] = "The comment must be text.";
    }
    return { recipient: flag.recipient as FlagRecipient, comment: optionalText(flag.comment) };
  });
}
