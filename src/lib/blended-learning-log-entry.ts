import type { PoolClient } from "pg";

import { withTransaction } from "./db";
import {
  canBlendedLearning,
  lockMappingInScope,
  type BlendedLearningAccess,
  type MappingSnapshot,
} from "./blended-learning-access";
import {
  SCREENER_RATING_ERROR,
  validateEntry,
  type ActionItemInput,
  type ConversationInput,
  type EntryInput,
  type FlagInput,
  type PhotoInput,
  type ScreenerFeedbackInput,
} from "./blended-learning-log-entry-input";
import { listMentees, type MenteeRow } from "./blended-learning-mentees";
import { uploadedPhotoSizes } from "./blended-learning-photos";
import { notifyWellbeingFlag } from "./blended-learning-wellbeing-notifier";

// Conversation write use case (server-only): logEntry saves one Conversation
// or Attempt for a Mentee in a single transaction, with a Conversation's new
// Action Items, photos, Mentor Flags and ticks on earlier Action Items. After
// commit, an Emotional Well-being flag emails the well-being lead. Saving a
// reviewed Conversation Draft (`draftId`) happens in the same transaction: the
// ready draft is locked, its recording and transcript move onto the
// Conversation, and the draft becomes saved. A Conversation's screener answer
// is checked against the Student's Screener link before it is saved, and the
// first Screener Feedback for the Student is saved with it, last (once per
// Student: the UNIQUE student_id turns a racing second save into a 409).

// A photo the request named, with the size S3 holds for it.
type StoredPhoto = PhotoInput & { byteSize: number };

export type LoggedEntry = { id: number; kind: "conversation" | "attempt"; occurredOn: string };

export type LogEntryResult =
  // `mentee` is the Mentee's row as the Mentee list now reads it.
  | { ok: true; entry: LoggedEntry; mentee: MenteeRow | null }
  | { ok: false; status: 403 | 404 | 409 | 422; error: string; fieldErrors?: Record<string, string> };

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

// The locked draft now has its Conversation (linked by its source_draft_id).
async function markDraftSaved(client: PoolClient, draftId: number): Promise<void> {
  const result = await client.query(
    `UPDATE blended_learning_conversation_drafts
     SET state = 'saved', updated_at = now()
     WHERE id = $1 AND state = 'ready'
     RETURNING id`,
    [draftId]
  );
  if ((result.rowCount ?? result.rows.length) !== 1) throw new DraftConflict();
}

// What an Attempt stores in a Conversation's own columns.
const NO_CONVERSATION = {
  mode: null,
  spokeWith: null,
  durationMinutes: null,
  summary: null,
  notesHtml: null,
  screenerUsed: null,
} as const;

async function insertEntry(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number,
  mapping: MappingSnapshot,
  input: EntryInput,
  draft: ReadyDraft | null
): Promise<LoggedEntry> {
  const conversation = input.kind === "conversation" ? input : NO_CONVERSATION;
  const result = await client.query<{ id: number | string; occurred_on: string }>(
    `INSERT INTO blended_learning_conversations (student_id, program_id, academic_year, mentor_user_id, logged_by_email, kind, occurred_on, mode, spoke_with, duration_minutes, summary, notes_html, attempt_note, call_recording_s3_key, transcript_s3_key, source_draft_id, screener_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING id, occurred_on::text AS occurred_on`,
    [
      studentId,
      Number(mapping.program_id),
      mapping.academic_year,
      Number(mapping.mentor_user_id),
      access.actorEmail,
      input.kind,
      input.occurredOn,
      conversation.mode,
      conversation.spokeWith,
      conversation.durationMinutes,
      conversation.summary,
      conversation.notesHtml,
      input.kind === "attempt" ? input.note : null,
      draft?.callRecordingS3Key ?? null,
      draft?.transcriptS3Key ?? null,
      draft?.id ?? null,
      // Conversations are append-only, so the answer is set here or never.
      conversation.screenerUsed,
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
      `INSERT INTO blended_learning_action_items (conversation_id, student_id, position, owner, text)
       VALUES ($1, $2, $3, $4, $5)`,
      [conversationId, studentId, index + 1, item.owner, item.text]
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
class ScreenerFeedbackGiven extends Error {}
class ScreenerRatingsMissing extends Error {}

type ScreenerState = { hasLink: boolean; feedbackGiven: boolean };

const SCREENER_FEEDBACK_GIVEN =
  "Screener feedback for this student was already saved, so it isn't asked again. Save again to log this conversation.";

// Whether the Student has a Screener link and already has Screener Feedback
// (from any Mentor).
async function readScreenerState(client: PoolClient, studentId: number): Promise<ScreenerState> {
  const result = await client.query<{ has_link: boolean; feedback_given: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM blended_learning_student_links links
                    WHERE links.student_id = $1 AND links.screener_url IS NOT NULL) AS has_link,
            EXISTS (SELECT 1 FROM blended_learning_screener_feedback feedback
                    WHERE feedback.student_id = $1) AS feedback_given`,
    [studentId]
  );
  const row = result.rows[0];
  return { hasLink: row?.has_link === true, feedbackGiven: row?.feedback_given === true };
}

const NOT_ASKED = { screenerUsed: null, screenerFeedback: null } as const;

// The Conversation with the screener answer it keeps. The form asks only when
// it saw a Screener link, and a link can be added or removed while the form is
// open, so a mismatch saves the Conversation as not asked (NULL, no feedback)
// instead of refusing it. With a link, a ticked box needs both ratings while
// the Student's feedback is still due, and ratings once it is given are a 409.
async function checkScreener(
  client: PoolClient,
  studentId: number,
  input: ConversationInput
): Promise<ConversationInput> {
  if (input.screenerUsed === null) return input;
  const state = await readScreenerState(client, studentId);
  if (!state.hasLink) return { ...input, ...NOT_ASKED };
  if (input.screenerUsed && !state.feedbackGiven && !input.screenerFeedback) throw new ScreenerRatingsMissing();
  if (input.screenerFeedback && state.feedbackGiven) throw new ScreenerFeedbackGiven();
  return input;
}

// The Student's first Screener Feedback, against this Conversation and its
// Mentor.
async function insertScreenerFeedback(
  client: PoolClient,
  studentId: number,
  conversationId: number,
  mentorUserId: number,
  feedback: ScreenerFeedbackInput
): Promise<void> {
  await client.query(
    `INSERT INTO blended_learning_screener_feedback (student_id, conversation_id, mentor_user_id, helped_understand, more_comfortable)
     VALUES ($1, $2, $3, $4, $5)`,
    [studentId, conversationId, mentorUserId, feedback.helpedUnderstand, feedback.moreComfortable]
  );
}

// Another save gave this Student's Screener Feedback first.
function isScreenerFeedbackRace(error: unknown): boolean {
  const pg = error as { code?: unknown; constraint?: unknown } | null;
  return pg?.code === "23505" && pg.constraint === "bl_screener_feedback_student_unique";
}

// A check constraint or append-only trigger (23514), or a unique index (23505).
function isConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "23514" || code === "23505";
}

function invalid(fieldErrors: Record<string, string>): LogEntryResult {
  const [first] = Object.values(fieldErrors);
  return { ok: false, status: 422, error: first, fieldErrors };
}

const NOT_FOUND: LogEntryResult = { ok: false, status: 404, error: "Not found" };

// Each photo must already sit in S3; its stored size is what the row keeps.
async function storedPhotos(
  input: EntryInput
): Promise<{ ok: true; photos: StoredPhoto[] } | { ok: false; fieldErrors: Record<string, string> }> {
  if (input.kind !== "conversation" || input.photos.length === 0) return { ok: true, photos: [] };
  const sizes = await uploadedPhotoSizes(input.photos.map((photo) => photo.s3Key));
  const missing: Record<string, string> = {};
  sizes.forEach((size, index) => {
    if (size === null) missing[`photoKeys.${index}`] = "This photo didn't finish uploading. Remove it and add it again.";
  });
  if (Object.keys(missing).length > 0) return { ok: false, fieldErrors: missing };
  return { ok: true, photos: input.photos.map((photo, index) => ({ ...photo, byteSize: sizes[index] as number })) };
}

// A Conversation's Action Items, photos, Mentor Flags and ticks, then its
// draft marked saved. Returns the Emotional Well-being flag ids.
async function insertConversationParts(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number,
  conversationId: number,
  input: ConversationInput,
  photos: StoredPhoto[],
  draft: ReadyDraft | null
): Promise<number[]> {
  await insertActionItems(client, studentId, conversationId, input.actionItems);
  await insertPhotos(client, conversationId, photos);
  const wellbeingFlagIds = await insertFlags(client, access, studentId, conversationId, input.flags);
  await completeActionItems(client, access, studentId, conversationId, input.completeActionItemIds);
  if (draft) await markDraftSaved(client, draft.id);
  return wellbeingFlagIds;
}

type Committed = { saved: LoggedEntry; mentorUserId: number; wellbeingFlagIds: number[] };

// The entry and everything it carries, in one transaction.
function saveEntry(
  access: BlendedLearningAccess,
  studentId: number,
  input: EntryInput,
  photos: StoredPhoto[]
): Promise<Committed> {
  return withTransaction(async (client) => {
    const mapping = await lockMappingInScope(client, access, studentId);
    if (!mapping) throw new OutOfScope();
    const draftId = input.kind === "conversation" ? input.draftId : null;
    const draft = draftId ? await lockReadyDraft(client, studentId, draftId) : null;
    const conversation = input.kind === "conversation" ? await checkScreener(client, studentId, input) : null;
    const mentorUserId = Number(mapping.mentor_user_id);
    const saved = await insertEntry(client, access, studentId, mapping, conversation ?? input, draft);
    const wellbeingFlagIds = conversation
      ? await insertConversationParts(client, access, studentId, saved.id, conversation, photos, draft)
      : [];
    if (conversation?.screenerFeedback) {
      await insertScreenerFeedback(client, studentId, saved.id, mentorUserId, conversation.screenerFeedback);
    }
    return { saved, mentorUserId, wellbeingFlagIds };
  });
}

// The 409 message for a save that conflicted, or null for any other error.
function conflictMessage(error: unknown): string | null {
  if (error instanceof TickConflict) {
    return "An Action Item you ticked is already done or isn't this Mentee's. Reload and try again.";
  }
  if (error instanceof DraftConflict) return "This Conversation Draft is no longer ready to save. Reload and try again.";
  if (isConflict(error)) return "This entry conflicts with what is already saved. Reload and try again.";
  return null;
}

// A failed save as a result; an unexpected error is rethrown. Feedback that
// is no longer due names `screenerFeedback`, so the form drops the questions.
function failedSave(error: unknown): LogEntryResult {
  if (error instanceof OutOfScope) return NOT_FOUND;
  if (error instanceof ScreenerRatingsMissing) {
    return invalid({
      "screenerFeedback.helpedUnderstand": SCREENER_RATING_ERROR,
      "screenerFeedback.moreComfortable": SCREENER_RATING_ERROR,
    });
  }
  if (error instanceof ScreenerFeedbackGiven || isScreenerFeedbackRace(error)) {
    return {
      ok: false,
      status: 409,
      error: SCREENER_FEEDBACK_GIVEN,
      fieldErrors: { screenerFeedback: SCREENER_FEEDBACK_GIVEN },
    };
  }
  const message = conflictMessage(error);
  if (message === null) throw error;
  return { ok: false, status: 409, error: message };
}

export async function logEntry(
  access: BlendedLearningAccess,
  studentId: number,
  raw: unknown,
  today: string
): Promise<LogEntryResult> {
  if (!canBlendedLearning(access, "log")) return { ok: false, status: 403, error: "Forbidden" };
  if (!Number.isSafeInteger(studentId) || studentId <= 0) return NOT_FOUND;

  const validated = validateEntry(raw, today, studentId);
  if (!validated.ok) return invalid(validated.fieldErrors);
  const photos = await storedPhotos(validated.input);
  if (!photos.ok) return invalid(photos.fieldErrors);

  let committed: Committed;
  try {
    committed = await saveEntry(access, studentId, validated.input, photos.photos);
  } catch (error) {
    return failedSave(error);
  }

  // After commit, best-effort: the notifier never throws, so the save stands.
  for (const flagId of committed.wellbeingFlagIds) await notifyWellbeingFlag(flagId);

  // After commit: the Mentee's row as the (mapped Mentor's) list now reads it.
  const list = await listMentees({ access, mentorUserId: committed.mentorUserId, studentId, today });
  const mentee = [...list.talkToFirst, ...list.everyoneElse][0] ?? null;
  return { ok: true, entry: committed.saved, mentee };
}
