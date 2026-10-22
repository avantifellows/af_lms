import type { PoolClient } from "pg";

import { withTransaction } from "./db";
import {
  canBlendedLearning,
  lockMappingInScope,
  type BlendedLearningAccess,
  type MappingSnapshot,
} from "./blended-learning-access";
import { isCalendarDate, MODES, oneOf, SPOKE_WITH } from "./blended-learning-format";
import { listMentees, type MenteeRow } from "./blended-learning-mentees";
import { sanitiseNotesHtml } from "./blended-learning-notes-sanitiser";
import {
  MAX_CONVERSATION_PHOTOS,
  photoKeyContentType,
  uploadedPhotoSizes,
} from "./blended-learning-photos";
import { notifyWellbeingFlag } from "./blended-learning-wellbeing-notifier";

// Conversation write use case (server-only): logEntry saves one Conversation
// or Attempt for a Mentee in a single transaction, with a Conversation's new
// Action Items, photos, Mentor Flags and ticks on earlier Action Items. After
// commit, an Emotional Well-being flag emails the well-being lead. Saving a
// reviewed Conversation Draft (`draftId`) happens in the same transaction: the
// ready draft is locked, its recording and transcript move onto the
// Conversation, and the draft becomes saved.

type ActionItemOwner = "student" | "mentor" | "parent";
type ActionItemInput = { owner: ActionItemOwner; text: string; dueOn: string | null };
type FlagRecipient = "emotional_wellbeing" | "physics" | "chemistry" | "maths";
type FlagInput = { recipient: FlagRecipient; comment: string | null };
// An uploaded photo, already under this Student's photo prefix.
type PhotoInput = { s3Key: string; contentType: string };
type StoredPhoto = PhotoInput & { byteSize: number };

type ConversationInput = {
  kind: "conversation";
  occurredOn: string;
  mode: "call" | "in_person";
  spokeWith: "student" | "parent_or_sibling" | "both";
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
type EntryInput = ConversationInput | AttemptInput;

export type LoggedEntry = { id: number; kind: "conversation" | "attempt"; occurredOn: string };

export type LogEntryResult =
  // `mentee` is the Mentee's row as the Mentee list now reads it.
  | { ok: true; entry: LoggedEntry; mentee: MenteeRow | null }
  | { ok: false; status: 403 | 404 | 409 | 422; error: string; fieldErrors?: Record<string, string> };

const ACTION_ITEM_OWNERS = ["student", "mentor", "parent"] as const;
const FLAG_RECIPIENTS = ["emotional_wellbeing", "physics", "chemistry", "maths"] as const;

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type Validated = { ok: true; input: EntryInput } | { ok: false; fieldErrors: Record<string, string> };

// Field-level validation. `today` is the IST calendar date; an entry can be
// dated today or earlier.
function validate(raw: unknown, today: string, studentId: number): Validated {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  if (body.kind !== "conversation" && body.kind !== "attempt") {
    return { ok: false, fieldErrors: { kind: "Choose a Conversation or an Attempt." } };
  }

  if (!isCalendarDate(body.occurredOn)) errors.occurredOn = "Enter the date.";
  else if (body.occurredOn > today) errors.occurredOn = "The date can't be in the future.";

  if (body.kind === "attempt") {
    // Only a Conversation carries Action Items or ticks earlier ones done.
    if (body.actionItems !== undefined) errors.actionItems = "An Attempt can't have Action Items.";
    if (body.photoKeys !== undefined) errors.photoKeys = "An Attempt can't have photos.";
    if (body.flags !== undefined) errors.flags = "An Attempt can't have Mentor Flags.";
    if (body.completeActionItemIds !== undefined) {
      errors.completeActionItemIds = "Only a Conversation can tick Action Items done.";
    }
    if (body.draftId !== undefined && body.draftId !== null) {
      errors.draftId = "A Conversation Draft can only be saved as a Conversation.";
    }
    if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
    return {
      ok: true,
      input: { kind: "attempt", occurredOn: body.occurredOn as string, note: optionalText(body.note) },
    };
  }

  if (!oneOf(MODES, body.mode)) errors.mode = "Choose call or in person.";
  if (!oneOf(SPOKE_WITH, body.spokeWith)) errors.spokeWith = "Choose who you spoke with.";
  const duration = body.durationMinutes;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 240) {
    errors.durationMinutes = "Duration must be between 1 and 240 minutes.";
  }
  const summary = optionalText(body.summary);
  if (!summary) errors.summary = "Add a summary.";
  if (body.notesHtml !== undefined && body.notesHtml !== null && typeof body.notesHtml !== "string") {
    errors.notesHtml = "Notes must be text.";
  }
  const notes = sanitiseNotesHtml(typeof body.notesHtml === "string" ? body.notesHtml : null);
  if (!notes.ok) errors.notesHtml = notes.error;

  const actionItems = validateActionItems(body.actionItems, errors);
  const photos = validatePhotoKeys(body.photoKeys, studentId, errors);
  const flags = validateFlags(body.flags, errors);
  const completeActionItemIds = validateCompleteActionItemIds(body.completeActionItemIds, errors);
  const draftId = body.draftId === undefined || body.draftId === null ? null : body.draftId;
  if (draftId !== null && !(Number.isSafeInteger(draftId) && (draftId as number) > 0)) {
    errors.draftId = "This Conversation Draft isn't valid. Reload and try again.";
  }

  if (Object.keys(errors).length > 0 || !notes.ok) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    input: {
      kind: "conversation",
      occurredOn: body.occurredOn as string,
      mode: body.mode as ConversationInput["mode"],
      spokeWith: body.spokeWith as ConversationInput["spokeWith"],
      durationMinutes: duration as number,
      summary: summary as string,
      notesHtml: notes.html,
      actionItems,
      photos,
      flags,
      completeActionItemIds,
      draftId: draftId as number | null,
    },
  };
}

// Ids of earlier Action Items to tick done, de-duplicated.
function validateCompleteActionItemIds(raw: unknown, errors: Record<string, string>): number[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || !raw.every((id) => Number.isSafeInteger(id) && id > 0)) {
    errors.completeActionItemIds = "Choose Action Items from the list.";
    return [];
  }
  return [...new Set(raw as number[])];
}

// New Action Items: owner and text are required, the due date is optional.
// Errors are keyed per item, e.g. `actionItems.1.text`.
function validateActionItems(raw: unknown, errors: Record<string, string>): ActionItemInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.actionItems = "Action Items must be a list.";
    return [];
  }
  return raw.map((value, index) => {
    const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const text = optionalText(item.text);
    if (!oneOf(ACTION_ITEM_OWNERS, item.owner)) errors[`actionItems.${index}.owner`] = "Choose who owns this Action Item.";
    if (!text) errors[`actionItems.${index}.text`] = "Add the Action Item.";
    const dueOn = item.dueOn === undefined || item.dueOn === null || item.dueOn === "" ? null : item.dueOn;
    if (dueOn !== null && !isCalendarDate(dueOn)) errors[`actionItems.${index}.dueOn`] = "Enter a valid due date.";
    return { owner: item.owner as ActionItemOwner, text: text ?? "", dueOn: dueOn as string | null };
  });
}

// Photo keys from the upload route: at most five, each under this Student's
// photo prefix and attached once. Errors are keyed per key, e.g. `photoKeys.1`.
function validatePhotoKeys(raw: unknown, studentId: number, errors: Record<string, string>): PhotoInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.photoKeys = "Photos must be a list.";
    return [];
  }
  if (raw.length > MAX_CONVERSATION_PHOTOS) {
    errors.photoKeys = "A Conversation can have at most five photos.";
    return [];
  }
  const seen = new Set<string>();
  return raw.map((key, index) => {
    const contentType = photoKeyContentType(studentId, key);
    if (!contentType) errors[`photoKeys.${index}`] = "This photo isn't this Mentee's. Remove it and add it again.";
    else if (seen.has(key)) errors[`photoKeys.${index}`] = "Each photo can be attached once.";
    else seen.add(key);
    return { s3Key: key as string, contentType: contentType ?? "" };
  });
}

// Mentor Flags: at most one per Flag Recipient, each with an optional comment.
// Errors are keyed per flag, e.g. `flags.1.recipient`.
function validateFlags(raw: unknown, errors: Record<string, string>): FlagInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.flags = "Mentor Flags must be a list.";
    return [];
  }
  const seen = new Set<string>();
  return raw.map((value, index) => {
    const flag = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    if (!oneOf(FLAG_RECIPIENTS, flag.recipient)) {
      errors[`flags.${index}.recipient`] = "Choose who the flag is for.";
    } else if (seen.has(flag.recipient)) {
      errors[`flags.${index}.recipient`] = "Each Flag Recipient can be raised once.";
    } else {
      seen.add(flag.recipient);
    }
    if (flag.comment !== undefined && flag.comment !== null && typeof flag.comment !== "string") {
      errors[`flags.${index}.comment`] = "The comment must be text.";
    }
    return { recipient: flag.recipient as FlagRecipient, comment: optionalText(flag.comment) };
  });
}

type ReadyDraft = { id: number; callRecordingS3Key: string; transcriptS3Key: string | null };

// Lock this Student's draft for the save. Only a ready draft can be saved;
// another Student's draft, an unknown id or any other state is a conflict.
async function lockReadyDraft(client: PoolClient, studentId: number, draftId: number): Promise<ReadyDraft> {
  const result = await client.query<{
    id: number | string;
    state: string;
    call_recording_s3_key: string;
    transcript_s3_key: string | null;
  }>(
    `SELECT draft.id, draft.state, draft.call_recording_s3_key, draft.transcript_s3_key
     FROM blended_learning_conversation_drafts draft
     WHERE draft.id = $1 AND draft.student_id = $2
     FOR UPDATE`,
    [draftId, studentId]
  );
  const draft = result.rows[0];
  if (!draft || draft.state !== "ready") throw new DraftConflict();
  return {
    id: Number(draft.id),
    callRecordingS3Key: draft.call_recording_s3_key,
    transcriptS3Key: draft.transcript_s3_key,
  };
}

// The locked draft now has its Conversation.
async function markDraftSaved(client: PoolClient, draftId: number, conversationId: number): Promise<void> {
  const result = await client.query(
    `UPDATE blended_learning_conversation_drafts
     SET state = 'saved', saved_conversation_id = $1, updated_at = now()
     WHERE id = $2 AND state = 'ready'
     RETURNING id`,
    [conversationId, draftId]
  );
  if ((result.rowCount ?? result.rows.length) !== 1) throw new DraftConflict();
}

async function insertEntry(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number,
  mapping: MappingSnapshot,
  input: EntryInput,
  draft: ReadyDraft | null
): Promise<LoggedEntry> {
  const conversation = input.kind === "conversation" ? input : null;
  const result = await client.query<{ id: number | string; occurred_on: string }>(
    `INSERT INTO blended_learning_conversations (student_id, program_id, academic_year, mentor_user_id, logged_by_user_id, logged_by_email, kind, occurred_on, mode, spoke_with, duration_minutes, summary, notes_html, attempt_note, call_recording_s3_key, transcript_s3_key, source_draft_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING id, occurred_on::text AS occurred_on`,
    [
      studentId,
      Number(mapping.program_id),
      mapping.academic_year,
      Number(mapping.mentor_user_id),
      access.actorUserId,
      access.actorEmail,
      input.kind,
      input.occurredOn,
      conversation?.mode ?? null,
      conversation?.spokeWith ?? null,
      conversation?.durationMinutes ?? null,
      conversation?.summary ?? null,
      conversation?.notesHtml ?? null,
      input.kind === "attempt" ? input.note : null,
      draft?.callRecordingS3Key ?? null,
      draft?.transcriptS3Key ?? null,
      draft?.id ?? null,
    ]
  );
  const row = result.rows[0];
  return { id: Number(row.id), kind: input.kind, occurredOn: row.occurred_on };
}

// A Conversation's new Action Items, numbered 1..n in the order given.
async function insertActionItems(
  client: PoolClient,
  studentId: number,
  conversationId: number,
  items: ActionItemInput[]
): Promise<void> {
  for (const [index, item] of items.entries()) {
    await client.query(
      `INSERT INTO blended_learning_action_items (conversation_id, student_id, position, owner, text, due_on)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [conversationId, studentId, index + 1, item.owner, item.text, item.dueOn]
    );
  }
}

// A Conversation's photos, numbered 1..n in the order given.
async function insertPhotos(client: PoolClient, conversationId: number, photos: StoredPhoto[]): Promise<void> {
  for (const [index, photo] of photos.entries()) {
    await client.query(
      `INSERT INTO blended_learning_conversation_photos (conversation_id, s3_key, content_type, byte_size, position)
       VALUES ($1, $2, $3, $4, $5)`,
      [conversationId, photo.s3Key, photo.contentType, photo.byteSize, index + 1]
    );
  }
}

// A Conversation's Mentor Flags, raised by the actor. Returns the ids of the
// Emotional Well-being flags, which notify after commit.
async function insertFlags(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number,
  conversationId: number,
  flags: FlagInput[]
): Promise<number[]> {
  const wellbeingFlagIds: number[] = [];
  for (const flag of flags) {
    const result = await client.query<{ id: number | string }>(
      `INSERT INTO blended_learning_mentor_flags (conversation_id, student_id, recipient, comment, raised_by_email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [conversationId, studentId, flag.recipient, flag.comment, access.actorEmail]
    );
    if (flag.recipient === "emotional_wellbeing") wellbeingFlagIds.push(Number(result.rows[0].id));
  }
  return wellbeingFlagIds;
}

// Mark this Mentee's earlier open Action Items done by this Conversation. An
// id that is already done, unknown or another Student's updates no row.
async function completeActionItems(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number,
  conversationId: number,
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  const result = await client.query(
    `UPDATE blended_learning_action_items
     SET status = 'done', completed_by_conversation_id = $1, completed_by_email = $2,
         completed_at = now(), updated_at = now()
     WHERE id = ANY($3::bigint[]) AND status = 'open' AND student_id = $4
     RETURNING id`,
    [conversationId, access.actorEmail, ids, studentId]
  );
  if ((result.rowCount ?? result.rows.length) < ids.length) throw new TickConflict();
}

class OutOfScope extends Error {}
class TickConflict extends Error {}
class DraftConflict extends Error {}

// A check constraint or append-only trigger (23514), or a unique index (23505).
function isConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "23514" || code === "23505";
}

function invalid(fieldErrors: Record<string, string>): LogEntryResult {
  const [first] = Object.values(fieldErrors);
  return { ok: false, status: 422, error: first, fieldErrors };
}

export async function logEntry(
  access: BlendedLearningAccess,
  studentId: number,
  raw: unknown,
  today: string
): Promise<LogEntryResult> {
  if (!canBlendedLearning(access, "log")) return { ok: false, status: 403, error: "Forbidden" };
  if (!Number.isSafeInteger(studentId) || studentId <= 0) return { ok: false, status: 404, error: "Not found" };

  const validated = validate(raw, today, studentId);
  if (!validated.ok) return invalid(validated.fieldErrors);

  // Each photo must already sit in S3; its stored size is what the row keeps.
  let photos: StoredPhoto[] = [];
  if (validated.input.kind === "conversation" && validated.input.photos.length > 0) {
    const input = validated.input;
    const sizes = await uploadedPhotoSizes(input.photos.map((photo) => photo.s3Key));
    const missing: Record<string, string> = {};
    sizes.forEach((size, index) => {
      if (size === null) missing[`photoKeys.${index}`] = "This photo didn't finish uploading. Remove it and add it again.";
    });
    if (Object.keys(missing).length > 0) return invalid(missing);
    photos = input.photos.map((photo, index) => ({ ...photo, byteSize: sizes[index] as number }));
  }

  let committed: { saved: LoggedEntry; mentorUserId: number; wellbeingFlagIds: number[] };
  try {
    committed = await withTransaction(async (client) => {
      const mapping = await lockMappingInScope(client, access, studentId);
      if (!mapping) throw new OutOfScope();
      const input = validated.input;
      const draft =
        input.kind === "conversation" && input.draftId !== null
          ? await lockReadyDraft(client, studentId, input.draftId)
          : null;
      const saved = await insertEntry(client, access, studentId, mapping, input, draft);
      let wellbeingFlagIds: number[] = [];
      if (input.kind === "conversation") {
        await insertActionItems(client, studentId, saved.id, input.actionItems);
        await insertPhotos(client, saved.id, photos);
        wellbeingFlagIds = await insertFlags(client, access, studentId, saved.id, input.flags);
        await completeActionItems(client, access, studentId, saved.id, input.completeActionItemIds);
        if (draft) await markDraftSaved(client, draft.id, saved.id);
      }
      return { saved, mentorUserId: Number(mapping.mentor_user_id), wellbeingFlagIds };
    });
  } catch (error) {
    if (error instanceof OutOfScope) return { ok: false, status: 404, error: "Not found" };
    if (error instanceof TickConflict) {
      return {
        ok: false,
        status: 409,
        error: "An Action Item you ticked is already done or isn't this Mentee's. Reload and try again.",
      };
    }
    if (error instanceof DraftConflict) {
      return {
        ok: false,
        status: 409,
        error: "This Conversation Draft is no longer ready to save. Reload and try again.",
      };
    }
    if (isConflict(error)) {
      return {
        ok: false,
        status: 409,
        error: "This entry conflicts with what is already saved. Reload and try again.",
      };
    }
    throw error;
  }

  // After commit, best-effort: the notifier never throws, so the save stands.
  for (const flagId of committed.wellbeingFlagIds) await notifyWellbeingFlag(flagId);

  // After commit: the Mentee's row as the (mapped Mentor's) list now reads it.
  const list = await listMentees({ access, mentorUserId: committed.mentorUserId, studentId, today });
  const mentee = [...list.talkToFirst, ...list.everyoneElse][0] ?? null;
  return { ok: true, entry: committed.saved, mentee };
}
