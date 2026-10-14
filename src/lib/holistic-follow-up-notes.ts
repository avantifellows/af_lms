import type { PoolClient } from "pg";

import { withTransaction } from "./db";
import type { HolisticFollowUpAnswers } from "./holistic-follow-up-questions";
import {
  checkHolisticMentorWriteScope,
  loadHolisticMentorWriteScope,
} from "./holistic-mentor-write-scope";

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
  | { ok: true; id: number }
  | { ok: false; status: 404 | 422; error: string };

async function postSessionNotesState(client: PoolClient, input: FollowUpNoteInput) {
  const notes = await client.query<{ state: "draft" | "submitted" }>(
    `SELECT state FROM holistic_mentorship_post_session_notes
     WHERE student_id = $1 AND phase_id = $2`,
    [input.studentId, input.phaseId]
  );
  return notes.rows[0]?.state ?? null;
}

async function insertFollowUpNote(client: PoolClient, input: FollowUpNoteInput) {
  const inserted = await client.query<{ id: number | string }>(
    `INSERT INTO holistic_mentorship_follow_up_notes
       (student_id, phase_id, author_user_id, author_email, challenges_answer,
        solutions_answer, action_plan_answer, submitted_at, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), now())
     RETURNING id`,
    [input.studentId, input.phaseId, input.actorUserId, input.actorEmail.trim().toLowerCase(),
      input.answers.challenges, input.answers.solutions, input.answers.action_plan]
  );
  return Number(inserted.rows[0].id);
}

async function addFollowUpNoteTransaction(
  client: PoolClient,
  input: FollowUpNoteInput
): Promise<HolisticFollowUpNoteResult> {
  // Take the per-Student privacy lock first, in the same order as privacy
  // deletion, so the insert trigger re-taking it can't deadlock.
  await client.query("SELECT pg_advisory_xact_lock($1, 0)", [input.studentId]);
  const scope = await loadHolisticMentorWriteScope(client, input);
  const scopeError = checkHolisticMentorWriteScope(scope, input.actorUserId);
  if (scopeError) return scopeError;
  if (await postSessionNotesState(client, input) !== "submitted") {
    return { ok: false, status: 422, error: "Submit Post-Session Notes first" };
  }
  return { ok: true, id: await insertFollowUpNote(client, input) };
}

export function addHolisticFollowUpNote(
  input: FollowUpNoteInput
): Promise<HolisticFollowUpNoteResult> {
  return withTransaction((client) => addFollowUpNoteTransaction(client, input));
}
