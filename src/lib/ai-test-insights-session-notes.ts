// AI Test Insights (#551): the Session Notes module, the one place that reads
// and writes `ai_test_insight_sessions` (part 1's counts read included) and
// decides draft privacy. Server-only
// (uses `@/lib/db`). It does not import the Insight Request module.
//
// The table is db-service's (#884); the LMS writes it directly through its
// Postgres boundary with `$n` placeholders (ADR 0015). Times are written as
// `now() AT TIME ZONE 'UTC'`, and every update sets `updated_at`. Modelled on
// the Holistic notes save (`saveHolisticNotes`): one transaction per save,
// and a revision check on every update.
//
// Modes: `draft` (#574), `submit` (#575) and `edit` (#578, the author only).
// It also lists a Student's submitted sessions for the History timeline (#576).
// A submit checks its open request key against `ai_test_insight_requests`
// in its own SQL.
import type { AiTestInsightsStudentContext } from "@/lib/ai-test-insights-access";
import {
  isBlankNote,
  SESSION_NOTES_TEXT_FIELDS,
  validateSessionNotes,
  type SessionNotesDraft,
  type SessionNotesField,
  type SessionNotesFields,
} from "@/lib/ai-test-insights-session-notes-rules";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import { query, withTransaction } from "@/lib/db";

const UTC_NOW = "(now() AT TIME ZONE 'UTC')";
/** The unique index that allows one draft per author per Student. */
const ONE_DRAFT_INDEX = "ati_sessions_author_student_draft_unique";

type DraftRow = {
  revision: number;
  session_date: string | null;
  areas_of_concern: string | null;
  immediate_actions: string | null;
  other_notes: string | null;
};

/**
 * The author's own draft of a Student, or null. The only read of a draft:
 * a draft is never returned to anyone but its author.
 */
export async function readOwnDraft(studentId: number, authorUserId: number): Promise<SessionNotesDraft | null> {
  const rows = await query<DraftRow>(
    `SELECT revision,
            to_char(session_date, 'YYYY-MM-DD') AS session_date,
            areas_of_concern,
            immediate_actions,
            other_notes
     FROM ai_test_insight_sessions
     WHERE student_id = $1 AND author_user_id = $2 AND state = 'draft'`,
    [studentId, authorUserId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    revision: Number(row.revision),
    sessionDate: row.session_date,
    areasOfConcern: row.areas_of_concern,
    immediateActions: row.immediate_actions,
    otherNotes: row.other_notes,
  };
}

/**
 * Each Student's `submitted` Insight Sessions across all academic years: how
 * many, and the newest `session_date` (`YYYY-MM-DD`). Drafts never count. A
 * Student with none has no entry. Part 1's counts read (`readAiTestInsightsCounts`).
 */
export async function readSubmittedSessionCounts(
  studentIds: number[],
): Promise<Array<{ studentId: number; completed: number; lastSessionDate: string | null }>> {
  const rows = await query<{ student_id: string | number; sessions_completed: string | number; last_session_date: string | null }>(
    `SELECT student_id,
            COUNT(*)::int AS sessions_completed,
            TO_CHAR(MAX(session_date), 'YYYY-MM-DD') AS last_session_date
     FROM ai_test_insight_sessions
     WHERE student_id = ANY($1::bigint[])
       AND state = 'submitted'
     GROUP BY student_id`,
    [studentIds],
  );
  return rows.map((row) => ({
    studentId: Number(row.student_id),
    completed: Number(row.sessions_completed),
    lastSessionDate: row.last_session_date,
  }));
}

/** A `submitted` Insight Session as the History timeline reads it. */
export interface SubmittedInsightSession {
  sessionId: number;
  revision: number;
  /** `YYYY-MM-DD`. */
  sessionDate: string;
  authorUserId: number;
  /** The author's name, by the same rule as an Insight Request's "Asked for by". */
  authorName: string;
  areasOfConcern: string;
  immediateActions: string;
  otherNotes: string | null;
  /** The `ai_test_insight_requests.id` of the Test Insight the session records, or null. */
  insightRequestId: number | null;
  /** UTC ISO 8601. */
  submittedAt: string;
  /** UTC ISO 8601: the newest `submitted_edited` audit row; null when never edited. */
  lastEditedAt: string | null;
}

type SubmittedSessionRow = {
  id: string | number;
  revision: number;
  session_date: string;
  author_user_id: string | number;
  author_name: string | null;
  areas_of_concern: string;
  immediate_actions: string;
  other_notes: string | null;
  insight_request_id: string | number | null;
  submitted_at: string;
  last_edited_at: string | null;
};

/** A stored UTC timestamp as ISO 8601 with a `Z`, as the Insight Request module writes its times. */
const isoUtc = (column: string) => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/**
 * Every `submitted` Insight Session of a Student, by any Teacher, in any
 * academic year and under any School or Program: the History timeline's
 * sessions (#576), in no order (the timeline orders them). Drafts never come
 * back. The author's name is the rule "Asked for by" uses (first and last
 * name, else email).
 */
export async function listSubmittedSessions(studentId: number): Promise<SubmittedInsightSession[]> {
  const rows = await query<SubmittedSessionRow>(
    `SELECT s.id,
            s.revision,
            to_char(s.session_date, 'YYYY-MM-DD') AS session_date,
            s.author_user_id,
            COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', BTRIM(u.first_name), BTRIM(u.last_name))), ''), u.email) AS author_name,
            s.areas_of_concern,
            s.immediate_actions,
            s.other_notes,
            s.insight_request_id,
            ${isoUtc("s.submitted_at")} AS submitted_at,
            (SELECT ${isoUtc("MAX(a.occurred_at)")}
             FROM ai_test_insight_session_note_audits a
             WHERE a.session_id = s.id AND a.action = 'submitted_edited') AS last_edited_at
     FROM ai_test_insight_sessions s
     JOIN "user" u ON u.id = s.author_user_id
     WHERE s.student_id = $1 AND s.state = 'submitted'`,
    [studentId],
  );
  return rows.map((row) => ({
    sessionId: Number(row.id),
    revision: Number(row.revision),
    sessionDate: row.session_date,
    authorUserId: Number(row.author_user_id),
    authorName: row.author_name ?? "",
    areasOfConcern: row.areas_of_concern,
    immediateActions: row.immediate_actions,
    otherNotes: row.other_notes,
    insightRequestId: row.insight_request_id === null ? null : Number(row.insight_request_id),
    submittedAt: row.submitted_at,
    lastEditedAt: row.last_edited_at,
  }));
}

/** A save the module refused: the route maps it to 409 `stale` or 422. */
export type SessionNotesRefusal =
  | { outcome: "stale"; currentRevision: number }
  | { outcome: "invalid"; field: SessionNotesField | "openRequestKey"; error: string };

/** What a draft save did. */
type DraftSaveResult = { outcome: "saved"; revision: number } | SessionNotesRefusal;
/** What a submit did. */
type SubmitResult = { outcome: "submitted"; sessionId: number; revision: number } | SessionNotesRefusal;
/**
 * What an edit did: saved (the revision now, and whether anything changed),
 * not found (no submitted session of this Student by that id), not the
 * author, or refused (stale, invalid).
 */
type EditResult =
  | { outcome: "saved"; revision: number; changed: boolean }
  | { outcome: "not_found" }
  | { outcome: "not_author" }
  | SessionNotesRefusal;

function isOneDraftConflict(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return pgError?.code === "23505" && pgError.constraint === ONE_DRAFT_INDEX;
}

async function stale(studentId: number, authorUserId: number): Promise<SessionNotesRefusal> {
  return { outcome: "stale", currentRevision: (await readOwnDraft(studentId, authorUserId))?.revision ?? 0 };
}

type SaveBase = {
  student: AiTestInsightsStudentContext;
  actorUserId: number;
  notes: unknown;
  expectedRevision: number;
};
type DraftParams = SaveBase & { mode: "draft" };
type SubmitParams = SaveBase & { mode: "submit"; openRequestKey: string | null };
type EditParams = SaveBase & { mode: "edit"; sessionId: number };

/**
 * Saves the acting Teacher's Session Notes for a Student, in one transaction.
 *
 * `draft` mode, by `expectedRevision`:
 *
 * - 0: inserts the author's draft at revision 1 with the Student context's
 *   School and Program and the current academic year. While all three text
 *   fields are blank nothing is written and the revision is 0. When the
 *   author already has a draft (the one-draft unique index), stale with that
 *   draft's revision.
 * - 1 or more: updates the author's draft of that Student at that revision
 *   to the next one. No row updated is stale, with the current revision (0
 *   when the author has no draft).
 *
 * Text is stored as typed; a blank field is stored as null. No audit row.
 *
 * `submit` mode (the final rule, with today in India from the server's
 * clock): turns the author's draft of that Student at `expectedRevision` into
 * a `submitted` Insight Session at the next revision, with the text trimmed (a
 * blank Other notes is null), `submitted_at`, the School, Program and current
 * academic year of the Student context, and the open request linked; and
 * writes one `submitted` audit row (the acting User and the new revision, no
 * note text). The open request key is null or the key of a `completed`
 * Insight Request of the same Student; anything else is invalid and nothing
 * is stored. No draft at that revision (none saved, another revision, already
 * submitted) is stale, so a second press of Submit never makes a second
 * session.
 *
 * `edit` mode (the final rule, as a submit): the author's correction of a
 * `submitted` Insight Session of that Student, by its id, at
 * `expectedRevision`. The text is trimmed (a blank Other notes is null) and
 * saved at the next revision with `updated_at`, with one `submitted_edited`
 * audit row (the acting User and the new revision, no note text). The date of
 * conversation may change; `submitted_at`, the linked request, the School,
 * Program, academic year and author are kept. No submitted session of that
 * Student by that id (a draft's id included) is not found; another author's is
 * not the author; another revision is stale, with the current one. Notes that
 * read the same after trim write nothing and keep the revision.
 */
export async function saveSessionNotes(params: DraftParams): Promise<DraftSaveResult>;
export async function saveSessionNotes(params: SubmitParams): Promise<SubmitResult>;
export async function saveSessionNotes(params: EditParams): Promise<EditResult>;
export async function saveSessionNotes(
  params: DraftParams | SubmitParams | EditParams,
): Promise<DraftSaveResult | SubmitResult | EditResult> {
  const checked =
    params.mode === "draft"
      ? validateSessionNotes(params.notes, "draft")
      : validateSessionNotes(params.notes, "final", getTodayIST());
  if (!checked.ok) return { outcome: "invalid", field: checked.field, error: checked.error };
  if (params.mode === "submit") return submitDraft(params, checked.notes);
  if (params.mode === "edit") return editSubmitted(params, checked.notes);
  return saveDraft(params, checked.notes);
}

/** The three text fields as a submit or an edit stores them: trimmed, a blank one null. */
function trimmedText(notes: SessionNotesFields): Array<string | null> {
  return SESSION_NOTES_TEXT_FIELDS.map((field) => {
    const value = notes[field];
    return isBlankNote(value) ? null : (value as string).trim();
  });
}

async function saveDraft(params: DraftParams, notes: SessionNotesFields): Promise<DraftSaveResult> {
  const { student, actorUserId, expectedRevision } = params;
  const { sessionDate } = notes;
  const text = SESSION_NOTES_TEXT_FIELDS.map((field) => {
    const value = notes[field];
    return isBlankNote(value) ? null : value;
  });

  if (expectedRevision === 0) {
    if (text.every((value) => value === null)) return { outcome: "saved", revision: 0 };
    try {
      const revision = await withTransaction(async (client) => {
        const inserted = await client.query<{ revision: number }>(
          `INSERT INTO ai_test_insight_sessions
             (student_id, school_id, program_id, academic_year, author_user_id, state, session_date,
              areas_of_concern, immediate_actions, other_notes, revision, inserted_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'draft', $6::date, $7, $8, $9, 1, ${UTC_NOW}, ${UTC_NOW})
           RETURNING revision`,
          [student.studentId, student.school.id, student.programId, CURRENT_ACADEMIC_YEAR, actorUserId, sessionDate, ...text],
        );
        return Number(inserted.rows[0].revision);
      });
      return { outcome: "saved", revision };
    } catch (error) {
      if (!isOneDraftConflict(error)) throw error;
      return stale(student.studentId, actorUserId);
    }
  }

  const revision = await withTransaction(async (client) => {
    const updated = await client.query<{ revision: number }>(
      `UPDATE ai_test_insight_sessions
       SET session_date = $4::date,
           areas_of_concern = $5,
           immediate_actions = $6,
           other_notes = $7,
           revision = revision + 1,
           updated_at = ${UTC_NOW}
       WHERE student_id = $1 AND author_user_id = $2 AND revision = $3 AND state = 'draft'
       RETURNING revision`,
      [student.studentId, actorUserId, expectedRevision, sessionDate, ...text],
    );
    return updated.rows[0] ? Number(updated.rows[0].revision) : null;
  });
  if (revision === null) return stale(student.studentId, actorUserId);
  return { outcome: "saved", revision };
}

async function submitDraft(params: SubmitParams, notes: SessionNotesFields): Promise<SubmitResult> {
  const { student, actorUserId, expectedRevision, openRequestKey } = params;
  const text = trimmedText(notes);

  const result = await withTransaction(async (client): Promise<SubmitResult | null> => {
    let insightRequestId: number | null = null;
    if (openRequestKey !== null) {
      const found = await client.query<{ id: string | number }>(
        `SELECT id
         FROM ai_test_insight_requests
         WHERE student_id = $1 AND request_key = $2 AND state = 'completed'`,
        [student.studentId, openRequestKey],
      );
      if (!found.rows[0]) {
        return { outcome: "invalid", field: "openRequestKey", error: "The AI Summary these notes link to is not open." };
      }
      insightRequestId = Number(found.rows[0].id);
    }

    const updated = await client.query<{ id: string | number; revision: number }>(
      `UPDATE ai_test_insight_sessions
       SET state = 'submitted',
           session_date = $4::date,
           areas_of_concern = $5,
           immediate_actions = $6,
           other_notes = $7,
           insight_request_id = $8,
           school_id = $9,
           program_id = $10,
           academic_year = $11,
           submitted_at = ${UTC_NOW},
           revision = revision + 1,
           updated_at = ${UTC_NOW}
       WHERE student_id = $1 AND author_user_id = $2 AND revision = $3 AND state = 'draft'
       RETURNING id, revision`,
      [
        student.studentId,
        actorUserId,
        expectedRevision,
        notes.sessionDate,
        ...text,
        insightRequestId,
        student.school.id,
        student.programId,
        CURRENT_ACADEMIC_YEAR,
      ],
    );
    const row = updated.rows[0];
    if (!row) return null;
    const sessionId = Number(row.id);
    const revision = Number(row.revision);
    await client.query(
      `INSERT INTO ai_test_insight_session_note_audits (session_id, actor_user_id, action, revision, occurred_at, inserted_at)
       VALUES ($1, $2, 'submitted', $3, ${UTC_NOW}, ${UTC_NOW})`,
      [sessionId, actorUserId, revision],
    );
    return { outcome: "submitted", sessionId, revision };
  });
  return result ?? stale(student.studentId, actorUserId);
}

type StoredSubmittedRow = DraftRow & { author_user_id: string | number };

async function editSubmitted(params: EditParams, notes: SessionNotesFields): Promise<EditResult> {
  const { student, actorUserId, expectedRevision, sessionId } = params;
  const text = trimmedText(notes);

  return withTransaction(async (client): Promise<EditResult> => {
    const found = await client.query<StoredSubmittedRow>(
      `SELECT author_user_id,
              revision,
              to_char(session_date, 'YYYY-MM-DD') AS session_date,
              areas_of_concern,
              immediate_actions,
              other_notes
       FROM ai_test_insight_sessions
       WHERE id = $1 AND student_id = $2 AND state = 'submitted'
       FOR UPDATE`,
      [sessionId, student.studentId],
    );
    const stored = found.rows[0];
    if (!stored) return { outcome: "not_found" };
    if (Number(stored.author_user_id) !== actorUserId) return { outcome: "not_author" };
    const currentRevision = Number(stored.revision);
    if (currentRevision !== expectedRevision) return { outcome: "stale", currentRevision };

    const storedValues = [stored.session_date, stored.areas_of_concern, stored.immediate_actions, stored.other_notes];
    const unchanged = [notes.sessionDate, ...text].every((value, index) => value === storedValues[index]);
    if (unchanged) return { outcome: "saved", revision: currentRevision, changed: false };

    const updated = await client.query<{ revision: number }>(
      `UPDATE ai_test_insight_sessions
       SET session_date = $5::date,
           areas_of_concern = $6,
           immediate_actions = $7,
           other_notes = $8,
           revision = revision + 1,
           updated_at = ${UTC_NOW}
       WHERE id = $1 AND student_id = $2 AND author_user_id = $3 AND revision = $4 AND state = 'submitted'
       RETURNING revision`,
      [sessionId, student.studentId, actorUserId, expectedRevision, notes.sessionDate, ...text],
    );
    // The row is locked above, so this only guards the revision check itself.
    if (!updated.rows[0]) return { outcome: "stale", currentRevision };
    const revision = Number(updated.rows[0].revision);
    await client.query(
      `INSERT INTO ai_test_insight_session_note_audits (session_id, actor_user_id, action, revision, occurred_at, inserted_at)
       VALUES ($1, $2, 'submitted_edited', $3, ${UTC_NOW}, ${UTC_NOW})`,
      [sessionId, actorUserId, revision],
    );
    return { outcome: "saved", revision, changed: true };
  });
}
