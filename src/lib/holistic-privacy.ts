import { withTransaction } from "./db";
import type { PoolClient } from "pg";

const ERASED_CONTENT = "Content erased under approved privacy request";

async function eraseFollowUpAnswers(
  client: PoolClient,
  params: { actorUserId: number; studentId: number; reason: string }
): Promise<number> {
  // The tombstone must already exist in a previous statement. Keep the original
  // values in the CTE so the audit counts answer fields, not note rows or markers.
  const result = await client.query<{ count: number | string }>(
    `WITH target_notes AS MATERIALIZED (
       SELECT id,
         (CASE WHEN challenges_answer <> $2 THEN 1 ELSE 0 END
          + CASE WHEN solutions_answer <> $2 THEN 1 ELSE 0 END
          + CASE WHEN action_plan_answer <> $2 THEN 1 ELSE 0 END) AS pending_count
       FROM holistic_mentorship_follow_up_notes
       WHERE student_id = $1
         AND (challenges_answer <> $2 OR solutions_answer <> $2 OR action_plan_answer <> $2)
       FOR UPDATE
     ), erased AS (
       UPDATE holistic_mentorship_follow_up_notes note
       SET challenges_answer = CASE WHEN note.challenges_answer IS NULL THEN NULL ELSE $2 END,
           solutions_answer = CASE WHEN note.solutions_answer IS NULL THEN NULL ELSE $2 END,
           action_plan_answer = CASE WHEN note.action_plan_answer IS NULL THEN NULL ELSE $2 END
       FROM target_notes target
       WHERE note.id = target.id
       RETURNING target.pending_count
     ) SELECT COALESCE(SUM(pending_count), 0) AS count FROM erased`,
    [params.studentId, ERASED_CONTENT]
  );
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) {
    // A separate immutable audit also supports erasure under an older tombstone
    // without rewriting its original actor, date, reason or counts.
    const audit = await client.query(
      `INSERT INTO holistic_mentorship_follow_up_erasures
         (privacy_deletion_id, actor_user_id, reason, answers_erased,
          occurred_at, inserted_at, updated_at)
       SELECT id, $2, $3, $4, now(), now(), now()
       FROM holistic_mentorship_privacy_deletions WHERE student_id = $1
       RETURNING id`,
      [params.studentId, params.actorUserId, params.reason, count]
    );
    if (audit.rows.length !== 1) throw new Error("Follow-up erasure audit was not recorded");
  }
  return count;
}

export async function deleteHolisticStudentContent(params: {
  actorUserId: number;
  studentId: number;
  reason: string;
}): Promise<
  | {
    ok: true;
    profileSummariesErased: number;
    postSessionAnswersErased: number;
    historicalAnswersErased: number;
    followUpAnswersErased: number;
  }
  | { ok: false; status: 404; error: string }
> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1, 0)", [params.studentId]);
    const scope = await client.query<{ actor_user_id: number | string }>(
      `SELECT permission.user_id AS actor_user_id
       FROM user_permission permission
       JOIN student ON student.id = $2
       WHERE permission.user_id = $1
         AND permission.revoked_at IS NULL AND permission.read_only IS NOT TRUE
         AND permission.role = 'admin'
       LIMIT 1 FOR UPDATE OF permission, student`,
      [params.actorUserId, params.studentId]
    );
    if (!scope.rows[0]) return { ok: false, status: 404, error: "Student not found" } as const;
    const actorUserId = Number(scope.rows[0].actor_user_id);
    const profiles = await client.query<{ count: number | string }>(
      `WITH erased AS (
         UPDATE holistic_mentorship_student_profile_summaries summary
         SET summary = $2, updated_at = now()
         FROM holistic_mentorship_student_profiles profile
         JOIN holistic_mentorship_profile_journeys journey ON journey.id = profile.profile_journey_id
         WHERE summary.student_profile_id = profile.id AND journey.student_id = $1
           AND summary.summary <> $2
         RETURNING summary.student_profile_id
       ) SELECT COUNT(*) AS count FROM erased`,
      [params.studentId, ERASED_CONTENT]
    );
    const historicalNotes = await client.query<{ count: number | string }>(
      `WITH target_answers AS MATERIALIZED (
         SELECT answer.id, answer.historical_note_id
         FROM holistic_mentorship_historical_note_answers answer
         JOIN holistic_mentorship_historical_notes notes
           ON notes.id = answer.historical_note_id
         WHERE notes.student_id = $1 AND answer.answer IS NOT NULL
         FOR UPDATE OF answer
       ), erased AS (
         UPDATE holistic_mentorship_historical_note_answers answer
         SET answer = NULL, updated_at = now()
         FROM target_answers target
         WHERE answer.id = target.id
         RETURNING target.historical_note_id
       ) SELECT COUNT(*) AS count FROM erased`,
      [params.studentId]
    );
    const notes = await client.query<{ count: number | string }>(
      `WITH target_notes AS MATERIALIZED (
         SELECT notes.id FROM holistic_mentorship_post_session_notes notes
         WHERE notes.student_id = $1
           AND EXISTS (SELECT 1 FROM holistic_mentorship_post_session_answers answer
                       WHERE answer.notes_id = notes.id)
         FOR UPDATE OF notes
       ), erased_answers AS (
         DELETE FROM holistic_mentorship_post_session_answers answer
         USING target_notes WHERE answer.notes_id = target_notes.id
         RETURNING answer.notes_id
       ), updated_notes AS (
         UPDATE holistic_mentorship_post_session_notes notes
         SET revision = revision + 1, last_edited_at = now(), updated_at = now()
         FROM target_notes WHERE notes.id = target_notes.id
         RETURNING notes.id
       ), audited AS (
         INSERT INTO holistic_mentorship_post_session_note_audits
           (notes_id, actor_user_id, action, occurred_at, reason, inserted_at, updated_at)
         SELECT id, $2, 'privacy_content_erased', now(), $3, now(), now()
         FROM updated_notes RETURNING notes_id
       ) SELECT COUNT(*) AS count FROM erased_answers`,
      [params.studentId, actorUserId, params.reason]
    );
    const profileSummariesErased = Number(profiles.rows[0]?.count ?? 0);
    const postSessionAnswersErased = Number(notes.rows[0]?.count ?? 0);
    const historicalAnswersErased = Number(historicalNotes.rows[0]?.count ?? 0);
    await client.query(
      `INSERT INTO holistic_mentorship_privacy_deletions
         (student_id, actor_user_id, reason, profile_summaries_erased,
          post_session_answers_erased, historical_answers_erased,
          occurred_at, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now(), now())
       ON CONFLICT (student_id) DO NOTHING`,
      [params.studentId, actorUserId, params.reason, profileSummariesErased,
        postSessionAnswersErased, historicalAnswersErased]
    );
    const followUpAnswersErased = await eraseFollowUpAnswers(client, { ...params, actorUserId });
    return {
      ok: true,
      profileSummariesErased,
      postSessionAnswersErased,
      historicalAnswersErased,
      followUpAnswersErased,
    };
  });
}
