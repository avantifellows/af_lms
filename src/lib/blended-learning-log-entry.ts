import type { PoolClient } from "pg";

import { withTransaction } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  activeBlendedMappingSql,
  canBlendedLearning,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import { listMentees, type MenteeRow } from "./blended-learning-mentees";
import { sanitiseNotesHtml } from "./blended-learning-notes-sanitiser";

// Conversation write use case (server-only): logEntry saves one Conversation
// or Attempt for a Mentee in a single transaction. Later slices add Action
// Items, Mentor Flags, photos and draft save to this same transaction.

type ConversationInput = {
  kind: "conversation";
  occurredOn: string;
  mode: "call" | "in_person";
  spokeWith: "student" | "parent_or_sibling" | "both";
  durationMinutes: number;
  summary: string;
  notesHtml: string | null;
};
type AttemptInput = { kind: "attempt"; occurredOn: string; note: string | null };
type EntryInput = ConversationInput | AttemptInput;

export type LoggedEntry = { id: number; kind: "conversation" | "attempt"; occurredOn: string };

export type LogEntryResult =
  // `mentee` is the Mentee's row as the Mentee list now reads it.
  | { ok: true; entry: LoggedEntry; mentee: MenteeRow | null }
  | { ok: false; status: 403 | 404 | 409 | 422; error: string; fieldErrors?: Record<string, string> };

const MODES = ["call", "in_person"] as const;
const SPOKE_WITH = ["student", "parent_or_sibling", "both"] as const;

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

type Validated = { ok: true; input: EntryInput } | { ok: false; fieldErrors: Record<string, string> };

// Field-level validation. `today` is the IST calendar date; an entry can be
// dated today or earlier.
function validate(raw: unknown, today: string): Validated {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  if (body.kind !== "conversation" && body.kind !== "attempt") {
    return { ok: false, fieldErrors: { kind: "Choose a Conversation or an Attempt." } };
  }

  if (!isCalendarDate(body.occurredOn)) errors.occurredOn = "Enter the date.";
  else if (body.occurredOn > today) errors.occurredOn = "The date can't be in the future.";

  if (body.kind === "attempt") {
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
    },
  };
}

type MappingSnapshot = {
  mentor_user_id: number | string;
  program_id: number | string;
  academic_year: string;
};

// The active current-year Mapping, re-read and locked inside the transaction.
async function lockActiveMapping(client: PoolClient, studentId: number): Promise<MappingSnapshot | null> {
  const result = await client.query<MappingSnapshot>(
    `SELECT mapping.mentor_user_id, mapping.program_id, mapping.academic_year
     FROM blended_learning_mentor_mentee_mappings mapping
     WHERE mapping.student_id = $1 AND ${activeBlendedMappingSql("mapping", "$2")}
     LIMIT 1
     FOR SHARE`,
    [studentId, CURRENT_ACADEMIC_YEAR]
  );
  return result.rows[0] ?? null;
}

async function insertEntry(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number,
  mapping: MappingSnapshot,
  input: EntryInput
): Promise<LoggedEntry> {
  const conversation = input.kind === "conversation" ? input : null;
  const result = await client.query<{ id: number | string; occurred_on: string }>(
    `INSERT INTO blended_learning_conversations (student_id, program_id, academic_year, mentor_user_id, logged_by_user_id, logged_by_email, kind, occurred_on, mode, spoke_with, duration_minutes, summary, notes_html, attempt_note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
    ]
  );
  const row = result.rows[0];
  return { id: Number(row.id), kind: input.kind, occurredOn: row.occurred_on };
}

class OutOfScope extends Error {}

// A check constraint or append-only trigger (23514), or a unique index (23505).
function isConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "23514" || code === "23505";
}

export async function logEntry(
  access: BlendedLearningAccess,
  studentId: number,
  raw: unknown,
  today: string
): Promise<LogEntryResult> {
  if (!canBlendedLearning(access, "log")) return { ok: false, status: 403, error: "Forbidden" };
  if (!Number.isSafeInteger(studentId) || studentId <= 0) return { ok: false, status: 404, error: "Not found" };

  const validated = validate(raw, today);
  if (!validated.ok) {
    const [first] = Object.values(validated.fieldErrors);
    return { ok: false, status: 422, error: first, fieldErrors: validated.fieldErrors };
  }

  let committed: { saved: LoggedEntry; mentorUserId: number };
  try {
    committed = await withTransaction(async (client) => {
      const mapping = await lockActiveMapping(client, studentId);
      if (!mapping) throw new OutOfScope();
      if (access.kind === "mentor" && Number(mapping.mentor_user_id) !== access.mentorUserId) {
        throw new OutOfScope();
      }
      const saved = await insertEntry(client, access, studentId, mapping, validated.input);
      return { saved, mentorUserId: Number(mapping.mentor_user_id) };
    });
  } catch (error) {
    if (error instanceof OutOfScope) return { ok: false, status: 404, error: "Not found" };
    if (isConflict(error)) {
      return {
        ok: false,
        status: 409,
        error: "This entry conflicts with what is already saved. Reload and try again.",
      };
    }
    throw error;
  }

  // After commit: the Mentee's row as the (mapped Mentor's) list now reads it.
  const list = await listMentees({ access, mentorUserId: committed.mentorUserId, studentId, today });
  const mentee = [...list.talkToFirst, ...list.everyoneElse][0] ?? null;
  return { ok: true, entry: committed.saved, mentee };
}
