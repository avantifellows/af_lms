import { withTransaction } from "./db";

export async function deleteHolisticStudentContent(params: {
  email: string;
  studentId: number;
  reason: string;
}): Promise<
  | { ok: true; profilesErased: number; notesErased: number }
  | { ok: false; status: 404; error: string }
> {
  return withTransaction(async (client) => {
    const scope = await client.query<{ actor_user_id: number | string }>(
      `SELECT actor.id AS actor_user_id
       FROM user_permission permission
       JOIN "user" actor ON actor.id = permission.user_id OR LOWER(actor.email) = LOWER(permission.email)
       JOIN student ON student.id = $2
       WHERE LOWER(permission.email) = LOWER($1)
         AND permission.revoked_at IS NULL AND permission.read_only IS NOT TRUE
         AND permission.role = 'admin'
       LIMIT 1 FOR UPDATE OF permission, student`,
      [params.email, params.studentId]
    );
    if (!scope.rows[0]) return { ok: false, status: 404, error: "Student not found" } as const;
    const actorUserId = Number(scope.rows[0].actor_user_id);
    const profiles = await client.query<{ count: number | string }>(
      `WITH erased AS (
         UPDATE holistic_mentorship_student_profile_summaries summary
         SET summary = 'Content erased under approved privacy request', updated_at = now()
         FROM holistic_mentorship_student_profiles profile
         JOIN holistic_mentorship_profile_journeys journey ON journey.id = profile.profile_journey_id
         WHERE summary.student_profile_id = profile.id AND journey.student_id = $1
           AND summary.summary <> 'Content erased under approved privacy request'
         RETURNING summary.student_profile_id
       ) SELECT COUNT(DISTINCT student_profile_id) AS count FROM erased`,
      [params.studentId]
    );
    const notes = await client.query<{ count: number | string }>(
      `WITH target_notes AS MATERIALIZED (
         SELECT id FROM holistic_mentorship_post_session_notes
         WHERE student_id = $1 FOR UPDATE
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
       ) SELECT COUNT(*) AS count FROM updated_notes`,
      [params.studentId, actorUserId, params.reason]
    );
    return {
      ok: true,
      profilesErased: Number(profiles.rows[0]?.count ?? 0),
      notesErased: Number(notes.rows[0]?.count ?? 0),
    };
  });
}
