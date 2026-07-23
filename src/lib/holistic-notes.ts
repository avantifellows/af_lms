import { query, withTransaction } from "./db";
import { PROGRAM_IDS } from "./constants";
import type { PoolClient } from "pg";

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

type NotesScope = {
  mapping_id: number | string;
  mentor_user_id: number | string;
  phase_revision: number;
  phase_state: "locked" | "open";
};

type ExistingNotes = {
  id: number | string;
  author_user_id: number | string;
  state: "draft" | "submitted";
  revision: number;
  has_answers: boolean;
};

function notesConflict(revision: number): HolisticNotesResult {
  return {
    ok: false,
    status: 409,
    error: "Notes changed; reload the latest version",
    currentRevision: revision,
  };
}

async function loadScope(
  client: PoolClient,
  input: NotesInput,
  priorAcademicYear: string
): Promise<NotesScope | null> {
  const scope = await client.query<NotesScope>(
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
         AND EXISTS (
           SELECT 1
           FROM centre_students roster_student
           JOIN centres roster_centre
             ON roster_centre.id = roster_student.centre_id
            AND roster_centre.school_id = mapping.school_id
            AND roster_centre.program_id = mapping.program_id
            AND roster_centre.is_active IS TRUE
           WHERE roster_student.user_id = student_user.id
             AND roster_student.academic_year = mapping.academic_year
             AND roster_student.program_id = mapping.program_id
             AND roster_student.grade IN (11, 12)
         )
         AND NOT EXISTS (
           SELECT 1 FROM holistic_mentorship_privacy_deletions deletion
           WHERE deletion.student_id = mapping.student_id
         )
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
  return scope.rows[0] ?? null;
}

function validateScope(scope: NotesScope | null, input: NotesInput): HolisticNotesResult | null {
  if (!scope || Number(scope.mentor_user_id) !== input.actorUserId) {
    return { ok: false, status: 404, error: "Not found" };
  }
  return scope.phase_state === "open"
    ? null
    : { ok: false, status: 422, error: "Phase is not Open" };
}

async function loadQuestionIds(client: PoolClient, phaseId: number): Promise<Set<number>> {
  const questions = await client.query<{ id: number | string }>(
    `SELECT id FROM holistic_mentorship_phase_questions
     WHERE phase_id = $1 ORDER BY position FOR SHARE`,
    [phaseId]
  );
  return new Set(questions.rows.map(({ id }) => Number(id)));
}

function validateAnswers(
  questionIds: Set<number>,
  input: NotesInput
): HolisticNotesResult | null {
  if (questionIds.size === 0) {
    return { ok: false, status: 422, error: "Phase has no configured Questions" };
  }
  return input.answers.some(({ questionId }) => !questionIds.has(questionId))
    ? { ok: false, status: 422, error: "Answer does not belong to this Phase" }
    : null;
}

function isEmptyInitialDraft(input: NotesInput): boolean {
  return input.mode === "draft" && input.expectedRevision === 0 &&
    !input.answers.some(({ answer }) => answer.trim());
}

async function loadExistingNotes(
  client: PoolClient,
  studentId: number,
  phaseId: number
): Promise<ExistingNotes | null> {
  const found = await client.query<ExistingNotes>(
      `SELECT notes.id, notes.author_user_id, notes.state, notes.revision,
              EXISTS (SELECT 1 FROM holistic_mentorship_post_session_answers answer
                      WHERE answer.notes_id = notes.id) AS has_answers
       FROM holistic_mentorship_post_session_notes notes
       WHERE notes.student_id = $1 AND notes.phase_id = $2 FOR UPDATE`,
    [studentId, phaseId]
  );
  return found.rows[0] ?? null;
}

function claimsErasedDraft(existing: ExistingNotes | null, mode: NotesInput["mode"]): boolean {
  return !!existing && existing.state === "draft" && !existing.has_answers && mode === "draft";
}

function validateAuthor(existing: ExistingNotes | null, input: NotesInput): HolisticNotesResult | null {
  if (!existing || Number(existing.author_user_id) === input.actorUserId ||
      claimsErasedDraft(existing, input.mode)) return null;
  return { ok: false, status: 403, error: "Forbidden" };
}

function validateFinalTokens(
  scope: NotesScope,
  existing: ExistingNotes | null,
  input: NotesInput
): HolisticNotesResult | null {
  if (!input.confirmed) return { ok: false, status: 422, error: "Confirmation is required" };
  if (Number(scope.mapping_id) !== input.expectedMappingId) {
    return {
      ok: false,
      status: 409,
      error: "Mapping or Phase changed; reload before saving",
      currentRevision: existing?.revision ?? 0,
    };
  }
  if (scope.phase_revision !== input.expectedPhaseRevision) {
    return {
      ok: false,
      status: 409,
      error: "Mapping or Phase changed; reload before saving",
      currentRevision: existing?.revision ?? 0,
    };
  }
  return null;
}

function validateFinalState(
  existing: ExistingNotes | null,
  input: NotesInput
): HolisticNotesResult | null {
  const expectedState = input.mode === "submit" ? "draft" : "submitted";
  if (existing?.state === expectedState) return null;
  return {
    ok: false,
    status: 422,
    error: input.mode === "submit"
      ? "Save a draft before submitting"
      : "Only submitted Notes can be corrected",
  };
}

function hasEveryAnswer(questionIds: Set<number>, input: NotesInput): boolean {
  const answers = new Map(input.answers.map(({ questionId, answer }) => [questionId, answer.trim()]));
  if (answers.size !== questionIds.size) return false;
  return ![...questionIds].some((id) => !answers.get(id));
}

function validateFinalWrite(
  scope: NotesScope,
  existing: ExistingNotes | null,
  questionIds: Set<number>,
  input: NotesInput
): HolisticNotesResult | null {
  const tokenError = validateFinalTokens(scope, existing, input);
  if (tokenError) return tokenError;
  const stateError = validateFinalState(existing, input);
  if (stateError) return stateError;
  return hasEveryAnswer(questionIds, input)
    ? null
    : { ok: false, status: 422, error: "Answer every Question before submitting" };
}

function existingRevision(existing: ExistingNotes | null): number {
  return existing ? existing.revision : 0;
}

function validateExisting(
  scope: NotesScope,
  existing: ExistingNotes | null,
  questionIds: Set<number>,
  input: NotesInput
): HolisticNotesResult | null {
  const revision = existingRevision(existing);
  if (revision !== input.expectedRevision) {
    return notesConflict(revision);
  }
  const authorError = validateAuthor(existing, input);
  if (authorError) return authorError;
  if (input.mode !== "draft") return validateFinalWrite(scope, existing, questionIds, input);
  return existing?.state === "submitted"
    ? { ok: false, status: 422, error: "Submitted Notes are read-only" }
    : null;
}

async function upsertNotes(
  client: PoolClient,
  existing: ExistingNotes | null,
  input: NotesInput
): Promise<{ notesId: number; revision: number }> {
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
    if (!updated.rows[0]) throw new Error("optimistic_notes_update_failed");
    return { notesId: Number(existing.id), revision: updated.rows[0].revision };
  }
  const inserted = await client.query<{ id: number | string; revision: number }>(
        `INSERT INTO holistic_mentorship_post_session_notes
           (student_id, phase_id, author_user_id, state, revision, first_drafted_at,
            last_edited_at, inserted_at, updated_at)
         VALUES ($1, $2, $3, 'draft', 1, now(), now(), now(), now())
         RETURNING id, revision`,
    [input.studentId, input.phaseId, input.actorUserId]
  );
  return { notesId: Number(inserted.rows[0].id), revision: inserted.rows[0].revision };
}

async function replaceAnswers(client: PoolClient, notesId: number, input: NotesInput) {
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
}

async function freezeNewNotesPhase(client: PoolClient, existing: ExistingNotes | null, input: NotesInput) {
  if (existing) return;
  await client.query(
        `UPDATE holistic_mentorship_phases
         SET frozen_at = COALESCE(frozen_at, now()),
             frozen_by_user_id = COALESCE(frozen_by_user_id, $1), updated_at = now()
         WHERE id = $2`,
    [input.actorUserId, input.phaseId]
  );
}

async function recordNotesAudit(client: PoolClient, notesId: number, input: NotesInput) {
  const action = input.mode === "draft"
    ? "draft_saved"
    : input.mode === "submit" ? "submitted" : "submitted_edited";
  await client.query(
      `INSERT INTO holistic_mentorship_post_session_note_audits
         (notes_id, actor_user_id, action, occurred_at, inserted_at, updated_at)
       VALUES ($1, $2, $3, now(), now(), now())`,
    [notesId, input.actorUserId, action]
  );
}

async function saveNotesTransaction(
  client: PoolClient,
  input: NotesInput,
  priorAcademicYear: string
): Promise<HolisticNotesResult> {
  const scope = await loadScope(client, input, priorAcademicYear);
  const scopeError = validateScope(scope, input);
  if (scopeError) return scopeError;
  const questionIds = await loadQuestionIds(client, input.phaseId);
  const answerError = validateAnswers(questionIds, input);
  if (answerError) return answerError;
  if (isEmptyInitialDraft(input)) return { ok: true, changed: false, revision: 0 };
  const existing = await loadExistingNotes(client, input.studentId, input.phaseId);
  const existingError = validateExisting(scope!, existing, questionIds, input);
  if (existingError) return existingError;
  let saved: { notesId: number; revision: number };
  try {
    saved = await upsertNotes(client, existing, input);
  } catch (error) {
    if ((error as Error).message !== "optimistic_notes_update_failed") throw error;
    return notesConflict(existing?.revision ?? 0);
  }
  await replaceAnswers(client, saved.notesId, input);
  await freezeNewNotesPhase(client, existing, input);
  await recordNotesAudit(client, saved.notesId, input);
  return { ok: true, changed: true, revision: saved.revision };
}

export async function saveHolisticNotes(input: NotesInput): Promise<HolisticNotesResult> {
  const academicYearStart = Number(input.academicYear.slice(0, 4));
  const priorAcademicYear = `${academicYearStart - 1}-${academicYearStart}`;
  try {
    return await withTransaction((client) => saveNotesTransaction(client, input, priorAcademicYear));
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
