import { query, withTransaction } from "./db";
import { PROGRAM_IDS } from "./constants";

type NotesInput = {
  mode: "draft" | "submit" | "edit";
  studentId: number;
  phaseId: number;
  schoolId: number;
  academicYear: string;
  actorUserId: number;
  expectedRevision: number;
  answers: Array<{ questionId: number; answer: string }>;
  expectedMappingId?: number;
  expectedPhaseRevision?: number;
  confirmed?: boolean;
};

export type HolisticNotesResult =
  | { ok: true; changed: boolean; revision: number }
  | { ok: false; status: 403 | 404 | 409 | 422; error: string; currentRevision?: number };

export async function saveHolisticNotes(input: NotesInput): Promise<HolisticNotesResult> {
  const academicYearStart = Number(input.academicYear.slice(0, 4));
  const priorAcademicYear = `${academicYearStart - 1}-${academicYearStart}`;

  try {
    return await withTransaction(async (client) => {
    const scope = await client.query<{
      mapping_id: number | string;
      mentor_user_id: number | string;
      phase_revision: number;
      phase_state: "locked" | "open";
    }>(
      `SELECT mapping.id AS mapping_id, mapping.mentor_user_id,
              phase.revision AS phase_revision, phase.state AS phase_state
       FROM holistic_mentorship_mentor_mentee_mappings mapping
       JOIN student st ON st.id = mapping.student_id AND st.status IS DISTINCT FROM 'dropout'
       JOIN "user" student_user ON student_user.id = st.user_id
       JOIN enrollment_record grade_enrollment ON grade_enrollment.user_id = student_user.id
         AND grade_enrollment.group_type = 'grade' AND grade_enrollment.academic_year = $5
         AND grade_enrollment.is_current IS TRUE
       JOIN grade current_grade ON current_grade.id = grade_enrollment.group_id
         AND current_grade.number IN (11, 12)
       JOIN holistic_mentorship_phases phase ON phase.id = $1
       JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
       JOIN grade phase_grade ON phase_grade.id = phase.grade_id
       LEFT JOIN holistic_mentorship_profile_journeys journey ON journey.student_id = st.id
       LEFT JOIN LATERAL (
         SELECT true AS has_prior_mapping
         FROM holistic_mentorship_mentor_mentee_mappings prior_mapping
         WHERE prior_mapping.student_id = mapping.student_id
           AND prior_mapping.program_id = $4 AND prior_mapping.academic_year = $6
         LIMIT 1
       ) prior_history ON true
       WHERE mapping.student_id = $2 AND mapping.school_id = $3
         AND mapping.program_id = $4 AND mapping.academic_year = $5
         AND mapping.ended_at IS NULL AND plan.program_id = $4
         AND (
           (plan.academic_year = $5 AND phase_grade.number = current_grade.number)
           OR (plan.academic_year = $6 AND current_grade.number = 12
             AND phase_grade.number = 11 AND prior_history.has_prior_mapping IS TRUE
             AND COALESCE(journey.entry_grade, 11) = 11)
         )
       FOR UPDATE OF mapping, phase`,
      [input.phaseId, input.studentId, input.schoolId, PROGRAM_IDS.COE,
        input.academicYear, priorAcademicYear]
    );
    const current = scope.rows[0];
    if (!current) return { ok: false, status: 404, error: "Not found" };
    if (Number(current.mentor_user_id) !== input.actorUserId) {
      return { ok: false, status: 404, error: "Not found" };
    }
    if (current.phase_state !== "open") {
      return { ok: false, status: 422, error: "Phase is not Open" };
    }

    const questions = await client.query<{ id: number | string }>(
      `SELECT id FROM holistic_mentorship_phase_questions
       WHERE phase_id = $1 ORDER BY position FOR SHARE`,
      [input.phaseId]
    );
    if (questions.rows.length === 0) {
      return { ok: false, status: 422, error: "Phase has no configured Questions" };
    }
    const questionIds = new Set(questions.rows.map(({ id }) => Number(id)));
    if (input.answers.some(({ questionId }) => !questionIds.has(questionId))) {
      return { ok: false, status: 422, error: "Answer does not belong to this Phase" };
    }
    if (input.mode === "draft" && input.expectedRevision === 0 && !input.answers.some(({ answer }) => answer.trim())) {
      return { ok: true, changed: false, revision: 0 };
    }

    const found = await client.query<{
      id: number | string;
      author_user_id: number | string;
      state: "draft" | "submitted";
      revision: number;
      has_answers: boolean;
    }>(
      `SELECT notes.id, notes.author_user_id, notes.state, notes.revision,
              EXISTS (SELECT 1 FROM holistic_mentorship_post_session_answers answer
                      WHERE answer.notes_id = notes.id) AS has_answers
       FROM holistic_mentorship_post_session_notes notes
       WHERE notes.student_id = $1 AND notes.phase_id = $2 FOR UPDATE`,
      [input.studentId, input.phaseId]
    );
    const existing = found.rows[0];
    if ((existing?.revision ?? 0) !== input.expectedRevision) {
      return {
        ok: false,
        status: 409,
        error: "Notes changed; reload the latest version",
        currentRevision: existing?.revision ?? 0,
      };
    }
    const claimsErasedDraft = existing && existing.state === "draft" &&
      !existing.has_answers && input.mode === "draft";
    if (existing && Number(existing.author_user_id) !== input.actorUserId && !claimsErasedDraft) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    if (input.mode !== "draft") {
      if (!input.confirmed) {
        return { ok: false, status: 422, error: "Confirmation is required" };
      }
      if (Number(current.mapping_id) !== input.expectedMappingId ||
          current.phase_revision !== input.expectedPhaseRevision) {
        return {
          ok: false,
          status: 409,
          error: "Mapping or Phase changed; reload before saving",
          currentRevision: existing?.revision ?? 0,
        };
      }
      if (!existing || (input.mode === "submit" && existing.state !== "draft") ||
          (input.mode === "edit" && existing.state !== "submitted")) {
        return { ok: false, status: 422, error: input.mode === "submit"
          ? "Save a draft before submitting"
          : "Only submitted Notes can be corrected" };
      }
      const answers = new Map(input.answers.map(({ questionId, answer }) => [questionId, answer.trim()]));
      if (answers.size !== questionIds.size || [...questionIds].some((id) => !answers.get(id))) {
        return { ok: false, status: 422, error: "Answer every Question before submitting" };
      }
    }
    if (input.mode === "draft" && existing?.state === "submitted") {
      return { ok: false, status: 422, error: "Submitted Notes are read-only" };
    }

    let notesId: number;
    let revision: number;
    if (existing) {
      const updated = await client.query<{ revision: number }>(
        `UPDATE holistic_mentorship_post_session_notes
         SET revision = revision + 1,
             state = CASE WHEN $3 = 'submit' THEN 'submitted' ELSE state END,
             author_user_id = $4,
             first_submitted_at = CASE WHEN $3 = 'submit'
               THEN COALESCE(first_submitted_at, now()) ELSE first_submitted_at END,
             last_edited_at = now(), updated_at = now()
         WHERE id = $1 AND revision = $2 RETURNING revision`,
        [existing.id, input.expectedRevision, input.mode, input.actorUserId]
      );
      if (!updated.rows[0]) {
        return { ok: false, status: 409, error: "Notes changed; reload the latest version" };
      }
      notesId = Number(existing.id);
      revision = updated.rows[0].revision;
    } else {
      const inserted = await client.query<{ id: number | string; revision: number }>(
        `INSERT INTO holistic_mentorship_post_session_notes
           (student_id, phase_id, author_user_id, state, revision, first_drafted_at,
            last_edited_at, inserted_at, updated_at)
         VALUES ($1, $2, $3, 'draft', 1, now(), now(), now(), now())
         RETURNING id, revision`,
        [input.studentId, input.phaseId, input.actorUserId]
      );
      notesId = Number(inserted.rows[0].id);
      revision = inserted.rows[0].revision;
    }

    await client.query(
      `DELETE FROM holistic_mentorship_post_session_answers WHERE notes_id = $1`,
      [notesId]
    );
    for (const answer of input.answers.filter(({ answer }) => answer.trim())) {
      await client.query(
        `INSERT INTO holistic_mentorship_post_session_answers
           (notes_id, question_id, answer, inserted_at, updated_at)
         VALUES ($1, $2, $3, now(), now())`,
        [notesId, answer.questionId, input.mode === "draft" ? answer.answer : answer.answer.trim()]
      );
    }
    if (!existing) {
      await client.query(
        `UPDATE holistic_mentorship_phases
         SET frozen_at = COALESCE(frozen_at, now()),
             frozen_by_user_id = COALESCE(frozen_by_user_id, $1), updated_at = now()
         WHERE id = $2`,
        [input.actorUserId, input.phaseId]
      );
    }
    await client.query(
      `INSERT INTO holistic_mentorship_post_session_note_audits
         (notes_id, actor_user_id, action, occurred_at, inserted_at, updated_at)
       VALUES ($1, $2, $3, now(), now(), now())`,
      [notesId, input.actorUserId, input.mode === "draft" ? "draft_saved"
        : input.mode === "submit" ? "submitted" : "submitted_edited"]
    );
      return { ok: true, changed: true, revision };
    });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== "23505") throw error;
    const current = await query<{ revision: number }>(
      `SELECT revision FROM holistic_mentorship_post_session_notes
       WHERE student_id = $1 AND phase_id = $2`,
      [input.studentId, input.phaseId]
    );
    return {
      ok: false,
      status: 409,
      error: "Notes changed; reload the latest version",
      currentRevision: current[0]?.revision ?? 0,
    };
  }
}
