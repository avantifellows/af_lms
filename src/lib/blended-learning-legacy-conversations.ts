import { isCalendarDate, oneOf } from "./blended-learning-format";
import type { ActionItemOwner } from "./blended-learning-mentee-detail";

// The latest conversation in a Student's legacy Google Profile Doc, as an
// external step summarised it: the links importer's --legacy-conversations
// file, and the snapshot stored on blended_learning_student_links
// (legacy_conversation_summary, legacy_action_items). Pure, no server imports.
// Limits match the db-service CHECKs; an item's limits match a logged one's.
// A Mentor ticks an item done on the Profile Doc card (done_at, done_by_email);
// a re-import keeps that for an item with the same text and owner.

export type LegacyActionItem = {
  text: string;
  owner: ActionItemOwner;
  // An ISO timestamp, or null while open.
  done_at: string | null;
  done_by_email: string | null;
};

export type LegacyConversationEntry = {
  occurredOn: string;
  summary: string;
  // Null when the entry agreed none.
  actionItems: LegacyActionItem[] | null;
};

const LEGACY_SUMMARY_MAX_LENGTH = 2000;
const LEGACY_ACTION_ITEMS_MAX = 10;
const LEGACY_ACTION_ITEM_TEXT_MAX_LENGTH = 500;
const EMAIL_MAX_LENGTH = 255;

const OWNERS = ["student", "mentor", "parent"] as const satisfies readonly ActionItemOwner[];

export type LegacyConversationInvalidReason =
  | "not_an_object"
  | "bad_occurred_on"
  | "blank_summary"
  | "summary_too_long"
  | "action_items_not_a_list"
  | "too_many_action_items"
  | "bad_action_item";

type Invalid = { invalid: LegacyConversationInvalidReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

// done_at and done_by_email, both optional: absent or null is open; a
// done_by_email needs a done_at.
function doneState(value: Record<string, unknown>): Pick<LegacyActionItem, "done_at" | "done_by_email"> | null {
  const doneAt = value.done_at ?? null;
  const doneBy = value.done_by_email ?? null;
  if (doneAt !== null && !isTimestamp(doneAt)) return null;
  if (doneBy !== null && (typeof doneBy !== "string" || !doneBy.trim() || doneBy.length > EMAIL_MAX_LENGTH)) return null;
  if (doneAt === null && doneBy !== null) return null;
  return { done_at: doneAt, done_by_email: doneBy === null ? null : doneBy.trim() };
}

// One action item, trimmed, or null when its owner is not one of the three,
// its text is blank or too long, or its done state is malformed.
function actionItem(value: unknown): LegacyActionItem | null {
  if (!isRecord(value) || !oneOf(OWNERS, value.owner) || typeof value.text !== "string") return null;
  const text = value.text.trim();
  if (!text || text.length > LEGACY_ACTION_ITEM_TEXT_MAX_LENGTH) return null;
  const done = doneState(value);
  return done && { text, owner: value.owner, ...done };
}

function actionItems(value: unknown): LegacyActionItem[] | null | Invalid {
  if (!Array.isArray(value)) return { invalid: "action_items_not_a_list" };
  if (value.length > LEGACY_ACTION_ITEMS_MAX) return { invalid: "too_many_action_items" };
  const items = value.map(actionItem);
  if (items.some((item) => item === null)) return { invalid: "bad_action_item" };
  return items.length > 0 ? (items as LegacyActionItem[]) : null;
}

function summary(value: unknown): string | Invalid {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { invalid: "blank_summary" };
  return text.length > LEGACY_SUMMARY_MAX_LENGTH ? { invalid: "summary_too_long" } : text;
}

// One file entry, strictly: anything off makes the whole entry invalid.
export function parseLegacyConversationEntry(value: unknown): LegacyConversationEntry | Invalid {
  if (!isRecord(value)) return { invalid: "not_an_object" };
  if (!isCalendarDate(value.occurredOn)) return { invalid: "bad_occurred_on" };
  const text = summary(value.summary);
  if (typeof text !== "string") return text;
  const items = actionItems(value.actionItems);
  if (items !== null && "invalid" in items) return items;
  return { occurredOn: value.occurredOn, summary: text, actionItems: items };
}

export interface LegacyConversations {
  // Valid entries by Drive file id.
  entries: Map<string, LegacyConversationEntry>;
  // Invalid entries by Drive file id, with why.
  invalid: Map<string, LegacyConversationInvalidReason>;
}

// The --legacy-conversations file: { "<Drive file id>": { occurredOn,
// summary, actionItems: [{ text, owner }] } }. A file that is not such an
// object throws; a bad entry is set aside with its reason.
export function parseLegacyConversations(raw: unknown): LegacyConversations {
  if (!isRecord(raw)) throw new Error("The legacy conversations file must be a JSON object keyed by Drive file id.");
  const result: LegacyConversations = { entries: new Map(), invalid: new Map() };
  for (const [docId, value] of Object.entries(raw)) {
    const entry = parseLegacyConversationEntry(value);
    if ("invalid" in entry) result.invalid.set(docId, entry.invalid);
    else result.entries.set(docId, entry);
  }
  return result;
}

// Stored legacy_action_items (jsonb, already checked by the importer and the
// DB), read defensively: anything that is not a valid item is left out. Each
// keeps its index in the stored array, which a tick updates by.
export function storedLegacyActionItems(value: unknown): (LegacyActionItem & { index: number })[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((element, index) => {
    const item = actionItem(element);
    return item ? [{ ...item, index }] : [];
  });
}

// A re-imported entry's items, each taking the done state of a stored done
// item with the same text and owner (each stored item used once), so a
// re-run never reopens what a Mentor ticked.
export function withDoneCarriedOver(items: LegacyActionItem[], stored: unknown): LegacyActionItem[] {
  const done = storedLegacyActionItems(stored).filter((item) => item.done_at !== null);
  return items.map((item) => {
    const match = done.findIndex((old) => old.text === item.text && old.owner === item.owner);
    if (match < 0) return item;
    const [old] = done.splice(match, 1);
    return { ...item, done_at: old.done_at, done_by_email: old.done_by_email };
  });
}
