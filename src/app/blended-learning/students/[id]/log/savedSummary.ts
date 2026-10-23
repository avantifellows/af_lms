import { formatCalendarDate } from "@/lib/blended-learning-format";
import type { FlagRecipient } from "@/lib/blended-learning-mentee-detail";
import type { MenteeRow } from "@/lib/blended-learning-mentees";
import { menteeGroup, type MenteeGroup } from "@/lib/blended-learning-talk-to-first";

import { FLAG_SWITCH } from "../flagRecipients";
import {
  durationMinutes,
  raisedFlags,
  sentActionItems,
  type EntryFormValues,
  type Kind,
  type Mode,
  type SpokeWith,
} from "./logEntryPayload";
import type { PickedPhoto } from "./PhotoPicker";

// What the saved confirmation says (pure): what the form sent, as label and
// value rows, plus the Mentee's list row from the save's answer. Only what
// the form knows is shown: nothing about emails or what happens next.

export type SavedEntry = {
  kind: Kind;
  occurredOn: string;
  mode: Mode | null;
  spokeWith: SpokeWith | null;
  durationMinutes: number | null;
  actionItemsAdded: number;
  actionItemsClosed: number;
  photos: number;
  // Each raised flag, in display order, and whether it had a comment.
  flags: { recipient: FlagRecipient; commented: boolean }[];
};

export type Saved = { entry: SavedEntry; mentee: MenteeRow | null };
export type SavedRow = { label: string; value: string };

const MODE_LABEL: Record<Mode, string> = { call: "Call", in_person: "In person" };
const SPOKE_WITH_LABEL: Record<SpokeWith, string> = {
  student: "Student",
  parent_or_sibling: "Parent or sibling",
  both: "Student and parent",
};

// The entry as sent: Action Items with text, uploaded photos, raised flags.
export function savedEntry(values: EntryFormValues, photos: PickedPhoto[]): SavedEntry {
  return {
    kind: values.kind,
    occurredOn: values.occurredOn,
    mode: values.mode,
    spokeWith: values.spokeWith,
    durationMinutes: durationMinutes(values.duration),
    actionItemsAdded: sentActionItems(values.actionItems).length,
    actionItemsClosed: values.ticked.size,
    photos: photos.filter((photo) => photo.status === "done").length,
    flags: raisedFlags(values.flags).map((recipient) => ({
      recipient,
      commented: Boolean(values.flags[recipient]?.trim()),
    })),
  };
}

function sessionLine(entry: SavedEntry): string {
  return [
    formatCalendarDate(entry.occurredOn),
    entry.mode && MODE_LABEL[entry.mode],
    entry.spokeWith && SPOKE_WITH_LABEL[entry.spokeWith],
  ]
    .filter(Boolean)
    .join(" · ");
}

function countRows(entry: SavedEntry): SavedRow[] {
  const rows: SavedRow[] = [{ label: "Action items added", value: String(entry.actionItemsAdded) }];
  if (entry.actionItemsClosed > 0) rows.push({ label: "Action items closed", value: String(entry.actionItemsClosed) });
  if (entry.photos > 0) rows.push({ label: "Photos attached", value: String(entry.photos) });
  return rows;
}

// The rows describing what was saved. An Attempt has only its date.
export function savedRows(entry: SavedEntry): SavedRow[] {
  if (entry.kind === "attempt") return [{ label: "Attempt", value: formatCalendarDate(entry.occurredOn) }];
  const rows: SavedRow[] = [{ label: "Conversation", value: sessionLine(entry) }];
  if (entry.durationMinutes !== null) rows.push({ label: "Duration", value: `${entry.durationMinutes} min` });
  rows.push(...countRows(entry));
  for (const flag of entry.flags) {
    rows.push({
      label: `Flagged to ${FLAG_SWITCH[flag.recipient].commentFor}`,
      value: flag.commented ? "With your comment" : "No comment",
    });
  }
  return rows;
}

// Where the save left the Mentee in the Mentor's Student list, against the
// group they were in when the form opened (`before`; null when unknown).
export function groupSentence(firstName: string, before: MenteeGroup | null, mentee: MenteeRow): string {
  const after = menteeGroup(mentee.reasons);
  if (before === null) return `${firstName} is in "${after}" in the student list.`;
  if (before === after) return `${firstName} is still in "${after}" in your student list.`;
  return `${firstName} moved from "${before}" to "${after}" in your student list.`;
}
