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
// Slice #574 has the `draft` mode only; submit (#575) and edit (#578) add
// theirs here.
import type { AiTestInsightsStudentContext } from "@/lib/ai-test-insights-access";
import {
  isBlankNote,
  SESSION_NOTES_TEXT_FIELDS,
  validateSessionNotes,
  type SessionNotesDraft,
  type SessionNotesField,
} from "@/lib/ai-test-insights-session-notes-rules";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
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

/** What a save did: the route maps it to a status. */
export type SaveSessionNotesResult =
  | { outcome: "saved"; revision: number }
  | { outcome: "stale"; currentRevision: number }
  | { outcome: "invalid"; field: SessionNotesField; error: string };

function isOneDraftConflict(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return pgError?.code === "23505" && pgError.constraint === ONE_DRAFT_INDEX;
}

async function stale(studentId: number, authorUserId: number): Promise<SaveSessionNotesResult> {
  return { outcome: "stale", currentRevision: (await readOwnDraft(studentId, authorUserId))?.revision ?? 0 };
}

/**
 * Saves the acting Teacher's Session Notes for a Student. `draft` mode, by
 * `expectedRevision`:
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
 */
export async function saveSessionNotes(params: {
  mode: "draft";
  student: AiTestInsightsStudentContext;
  actorUserId: number;
  notes: unknown;
  expectedRevision: number;
}): Promise<SaveSessionNotesResult> {
  const { student, actorUserId, expectedRevision } = params;
  const checked = validateSessionNotes(params.notes, params.mode);
  if (!checked.ok) return { outcome: "invalid", field: checked.field, error: checked.error };
  const { sessionDate } = checked.notes;
  const text = SESSION_NOTES_TEXT_FIELDS.map((field) => {
    const value = checked.notes[field];
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
