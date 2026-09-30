import type { PoolClient } from "pg";

import { withTransaction } from "./db";
import type { HolisticFollowUpAnswers, HolisticFollowUpNote } from "./holistic-follow-up-questions";
import {
  checkHolisticMentorWriteScope,
  loadHolisticMentorWriteScope,
} from "./holistic-mentor-write-scope";
import { toHolisticFollowUpNote, type HolisticFollowUpNoteRow } from "./holistic-student-phase";

type FollowUpNoteInput = {
  studentId: number;
  phaseId: number;
  schoolId: number;
  programId: number;
  academicYear: string;
  actorUserId: number;
  actorEmail: string;
  answers: HolisticFollowUpAnswers;
};

export type HolisticFollowUpNoteResult =
  | { ok: true; followUpNote: HolisticFollowUpNote }
  | { ok: false; status: 404 | 409 | 422; error: string };

async function postSessionNotesState(client: PoolClient, input: FollowUpNoteInput) {
  const notes = await client.query<{ state: "draft" | "submitted" }>(
    `SELECT state FROM holistic_mentorship_post_session_notes
     WHERE student_id = $1 AND phase_id = $2 FOR SHARE`,
    [input.studentId, input.phaseId]
  );
  return notes.rows[0]?.state ?? null;
}

async function insertFollowUpNote(client: PoolClient, input: FollowUpNoteInput) {
  const inserted = await client.query<HolisticFollowUpNoteRow>(
    `WITH note AS (
       INSERT INTO holistic_mentorship_follow_up_notes
         (student_id, phase_id, author_user_id, author_email, challenges_answer,
          solutions_answer, action_plan_answer, submitted_at, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), now())
       RETURNING id, submitted_at, author_user_id, author_email,
                 challenges_answer, solutions_answer, action_plan_answer
     )
     SELECT note.id, note.submitted_at, author.first_name AS author_first_name,
            author.last_name AS author_last_name, note.author_email,
            note.challenges_answer, note.solutions_answer, note.action_plan_answer
     FROM note LEFT JOIN "user" author ON author.id = note.author_user_id`,
    [input.studentId, input.phaseId, input.actorUserId, input.actorEmail.trim().toLowerCase(),
      input.answers.challenges, input.answers.solutions, input.answers.action_plan]
  );
  return toHolisticFollowUpNote(inserted.rows[0]);
}

async function addFollowUpNoteTransaction(
  client: PoolClient,
  input: FollowUpNoteInput
): Promise<HolisticFollowUpNoteResult> {
  const scope = await loadHolisticMentorWriteScope(client, input);
  const scopeError = checkHolisticMentorWriteScope(scope, input.actorUserId);
  if (scopeError) return scopeError;
  if (await postSessionNotesState(client, input) !== "submitted") {
    return { ok: false, status: 422, error: "Submit Post-Session Notes first" };
  }
  return { ok: true, followUpNote: await insertFollowUpNote(client, input) };
}

export async function addHolisticFollowUpNote(
  input: FollowUpNoteInput
): Promise<HolisticFollowUpNoteResult> {
  try {
    return await withTransaction((client) => addFollowUpNoteTransaction(client, input));
  } catch (error) {
    // The insert trigger raises 23514 when a privacy tombstone lands mid-save.
    if ((error as { code?: string }).code === "23514") {
      return { ok: false, status: 409, error: "Student changed; reload before saving" };
    }
    throw error;
  }
}
