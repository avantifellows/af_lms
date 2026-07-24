import { PROGRAM_IDS } from "./constants";
import { withTransaction } from "./db";

export async function reconcileHolisticMappings(params: {
  academicYear?: string;
  schoolCode?: string;
  schoolId?: number;
  studentIds?: number[];
}): Promise<number> {
  const studentIds = params.studentIds?.length ? [...new Set(params.studentIds)] : null;
  if (!params.academicYear && !studentIds) {
    throw new Error("Holistic Mapping reconciliation requires a bounded scope");
  }

  return withTransaction(async (client) => {
    const result = await client.query<{ ended_count: number | string }>(
      `WITH candidates AS MATERIALIZED (
         SELECT mapping.id, mapping.student_id, mapping.mentor_user_id,
                mapping.academic_year,
                CASE
                  WHEN student.status = 'dropout' THEN 'student_dropout'
                  WHEN NOT EXISTS (
                    SELECT 1
                    FROM enrollment_record grade_enrollment
                    JOIN grade ON grade.id = grade_enrollment.group_id
                      AND grade.number IN (11, 12)
                    WHERE grade_enrollment.user_id = student.user_id
                      AND grade_enrollment.group_type = 'grade'
                      AND grade_enrollment.academic_year = mapping.academic_year
                      AND grade_enrollment.is_current IS TRUE
                  ) THEN 'student_grade_changed'
                  WHEN NOT EXISTS (
                    SELECT 1
                    FROM group_user batch_member
                    JOIN "group" batch_group
                      ON batch_group.id = batch_member.group_id
                     AND batch_group.type = 'batch'
                    JOIN batch ON batch.id = batch_group.child_id
                    WHERE batch_member.user_id = student.user_id
                      AND batch.program_id = mapping.program_id
                  ) THEN 'student_program_changed'
                  ELSE 'student_school_changed'
                END AS reason
         FROM holistic_mentorship_mentor_mentee_mappings mapping
         JOIN student ON student.id = mapping.student_id
         WHERE mapping.program_id = $1
           AND mapping.ended_at IS NULL
           AND ($2::text IS NULL OR mapping.academic_year = $2)
           AND ($3::bigint IS NULL OR mapping.school_id = $3)
           AND ($4::text IS NULL OR EXISTS (
             SELECT 1 FROM school
             WHERE school.id = mapping.school_id AND school.code = $4
           ))
           AND ($5::bigint[] IS NULL OR mapping.student_id = ANY($5))
           AND NOT (
             student.status IS DISTINCT FROM 'dropout'
             AND EXISTS (
               SELECT 1
               FROM centre_students roster_student
               JOIN centres roster_centre
                 ON roster_centre.id = roster_student.centre_id
                AND roster_centre.school_id = mapping.school_id
                AND roster_centre.program_id = mapping.program_id
                AND roster_centre.is_active IS TRUE
               WHERE roster_student.user_id = student.user_id
                 AND roster_student.academic_year = mapping.academic_year
                 AND roster_student.program_id = mapping.program_id
                 AND roster_student.grade IN (11, 12)
             )
           )
         FOR UPDATE OF mapping
       ), ended AS (
         UPDATE holistic_mentorship_mentor_mentee_mappings mapping
         SET ended_at = now(), ended_by_user_id = NULL,
             end_source = 'af_lms_student_eligibility',
             end_reason = candidates.reason, updated_at = now()
         FROM candidates
         WHERE mapping.id = candidates.id AND mapping.ended_at IS NULL
         RETURNING mapping.id, mapping.student_id, mapping.mentor_user_id,
                   mapping.program_id, mapping.academic_year, candidates.reason
       ), draft_notes AS MATERIALIZED (
         SELECT DISTINCT ON (notes.id)
                notes.id, notes.author_user_id, ended.reason
         FROM holistic_mentorship_post_session_notes notes
         JOIN ended ON ended.student_id = notes.student_id
         WHERE notes.state = 'draft'
           AND NOT EXISTS (
             SELECT 1
             FROM holistic_mentorship_mentor_mentee_mappings active_mapping
             WHERE active_mapping.student_id = ended.student_id
               AND active_mapping.program_id = ended.program_id
               AND active_mapping.academic_year > ended.academic_year
               AND active_mapping.ended_at IS NULL
           )
         ORDER BY notes.id, ended.academic_year DESC, ended.id DESC
       ), updated_notes AS (
         UPDATE holistic_mentorship_post_session_notes notes
         SET revision = revision + 1, last_edited_at = now(), updated_at = now()
         FROM draft_notes
         WHERE notes.id = draft_notes.id
         RETURNING notes.id, draft_notes.author_user_id, draft_notes.reason
       ), erased_answers AS (
         DELETE FROM holistic_mentorship_post_session_answers answers
         USING updated_notes
         WHERE answers.notes_id = updated_notes.id
       ), audits AS (
         INSERT INTO holistic_mentorship_post_session_note_audits
           (notes_id, actor_user_id, action, occurred_at, reason, inserted_at, updated_at)
         SELECT id, author_user_id, 'draft_erased_on_mapping_end', now(), reason, now(), now()
         FROM updated_notes
       )
       SELECT COUNT(*) AS ended_count FROM ended`,
      [
        PROGRAM_IDS.COE,
        params.academicYear ?? null,
        params.schoolId ?? null,
        params.schoolCode ?? null,
        studentIds,
      ]
    );
    return Number(result.rows[0]?.ended_count ?? 0);
  });
}
