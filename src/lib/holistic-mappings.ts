import { query, withTransaction } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import { findEligibleHolisticMentorUserId } from "./holistic-mentor-eligibility";
import { reconcileHolisticMappings } from "./holistic-reconciliation";
import { buildHolisticSchoolScopePredicate } from "./holistic-scope";
import type { UserPermission } from "./permissions";
import type { PoolClient } from "pg";

interface RosterRow {
  student_id: number | string;
  name: string | null;
  external_student_id: string | null;
  grade: number | string;
  active_phase_id: number | string | null;
  active_notes_state: "draft" | "submitted" | null;
  mapping_id: number | string | null;
  mentor_user_id: number | string | null;
  mentor_name: string | null;
}

export interface HolisticAssignmentRosterStudent {
  studentId: number;
  name: string;
  externalStudentId: string | null;
  grade: number;
  activePhaseId: number | null;
  activeNotesState: "draft" | "submitted" | null;
  ownership: {
    mappingId: number;
    mentorUserId: number;
    mentorName: string;
  } | null;
}

export interface HolisticAssignmentCoverageSummary {
  eligible: number;
  assigned: number;
  unassigned: number;
  activeMentors: number;
  coveragePercentage: number;
  completed: number;
  pending: number;
  noActivePhase: number;
}

interface CoverageSummaryRow {
  eligible_count: number | string;
  assigned_count: number | string;
  unassigned_count: number | string;
  active_mentor_count: number | string;
  coverage_percentage: number | string;
  completed_count: number | string;
  pending_count: number | string;
  no_active_phase_count: number | string;
}

interface ActiveMappingRow {
  id: number | string;
  student_id: number | string;
  mentor_user_id: number | string;
}

export type HolisticMappingMutationResult =
  | { ok: true; changed: number }
  | {
      ok: false;
      status: 409 | 422;
      error: string;
      ownership?: Array<{
        studentId: number;
        ownership: HolisticAssignmentRosterStudent["ownership"];
      }>;
    };

class MappingMutationError extends Error {
  constructor(readonly status: 409 | 422, message: string) {
    super(message);
  }
}

const ELIGIBLE_ROSTER_CTE_SQL = `eligible_roster AS MATERIALIZED (
  SELECT roster_student.user_id, MIN(roster_student.grade) AS grade
  FROM centre_students roster_student
  JOIN centres roster_centre
    ON roster_centre.id = roster_student.centre_id
   AND roster_centre.school_id = $1
   AND roster_centre.program_id = $3
   AND roster_centre.is_active IS TRUE
  WHERE roster_student.academic_year = $2
    AND roster_student.program_id = $3
    AND roster_student.grade IN (11, 12)
  GROUP BY roster_student.user_id
  HAVING COUNT(DISTINCT roster_student.grade) = 1
)`;

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

export async function lockHolisticMentorMappingMutation(
  client: PoolClient,
  mentorUserId: number
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`holistic_mentorship_mentor:${mentorUserId}`]
  );
}

export async function eraseDraftHolisticNotes(
  client: PoolClient,
  studentIds: number[],
  actorUserId: number | null,
  reason: string,
  actorEmail?: string,
): Promise<void> {
  if (studentIds.length === 0) return;
  await client.query(
    `WITH draft_notes AS MATERIALIZED (
       SELECT id
       FROM holistic_mentorship_post_session_notes
       WHERE student_id = ANY($1::bigint[]) AND state = 'draft'
       FOR UPDATE
     ), updated_notes AS (
       UPDATE holistic_mentorship_post_session_notes notes
       SET revision = revision + 1, last_edited_at = now(), updated_at = now()
       FROM draft_notes
       WHERE notes.id = draft_notes.id
       RETURNING notes.id
     ), erased_answers AS (
       DELETE FROM holistic_mentorship_post_session_answers answers
       USING updated_notes
       WHERE answers.notes_id = updated_notes.id
     )
     INSERT INTO holistic_mentorship_post_session_note_audits
       (notes_id, actor_user_id, actor_email, action, occurred_at, reason, inserted_at, updated_at)
     SELECT id, $2, $3, 'draft_erased_on_mapping_end', now(), $4, now(), now()
     FROM updated_notes`,
    [studentIds, actorUserId, actorEmail ?? null, reason]
  );
}

async function eraseDraftHolisticNotesForMapping(
  client: PoolClient,
  params: {
    studentId: number;
    mentorUserId: number;
    programId: number;
    academicYear: string;
    actorUserId: number | null;
    actorEmail: string;
    reason: string;
  },
): Promise<void> {
  await client.query(
    `WITH draft_notes AS MATERIALIZED (
       SELECT notes.id
       FROM holistic_mentorship_post_session_notes notes
       JOIN holistic_mentorship_phases phase ON phase.id = notes.phase_id
       JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
       WHERE notes.student_id = ANY($1::bigint[])
         AND notes.author_user_id = $2
         AND plan.program_id = $3
         AND plan.academic_year = $4
         AND notes.state = 'draft'
       FOR UPDATE OF notes
     ), updated_notes AS (
       UPDATE holistic_mentorship_post_session_notes notes
       SET revision = revision + 1, last_edited_at = now(), updated_at = now()
       FROM draft_notes
       WHERE notes.id = draft_notes.id
       RETURNING notes.id
     ), erased_answers AS (
       DELETE FROM holistic_mentorship_post_session_answers answers
       USING updated_notes
       WHERE answers.notes_id = updated_notes.id
     )
     INSERT INTO holistic_mentorship_post_session_note_audits
       (notes_id, actor_user_id, actor_email, action, occurred_at, reason, inserted_at, updated_at)
     SELECT id, $5, $6, 'draft_erased_on_mapping_end', now(), $7, now(), now()
     FROM updated_notes`,
    [
      [params.studentId],
      params.mentorUserId,
      params.programId,
      params.academicYear,
      params.actorUserId,
      params.actorEmail,
      params.reason,
    ],
  );
}

async function currentOwnership(
  studentIds: number[],
  academicYear: string,
  schoolId: number,
  programId: number,
): Promise<Array<{ studentId: number; ownership: HolisticAssignmentRosterStudent["ownership"] }>> {
  const rows = await query<ActiveMappingRow & { mentor_name: string | null }>(
    `SELECT mapping.id, mapping.student_id, mapping.mentor_user_id,
            NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), '') AS mentor_name
     FROM holistic_mentorship_mentor_mentee_mappings mapping
     JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
     WHERE mapping.student_id = ANY($1::bigint[])
       AND mapping.academic_year = $2
       AND mapping.school_id = $3
       AND mapping.program_id = $4
       AND mapping.ended_at IS NULL`,
    [studentIds, academicYear, schoolId, programId]
  );
  const byStudent = new Map(rows.map((row) => [Number(row.student_id), row]));
  return studentIds.map((studentId) => {
    const row = byStudent.get(studentId);
    return {
      studentId,
      ownership: row
        ? {
            mappingId: Number(row.id),
            mentorUserId: Number(row.mentor_user_id),
            mentorName: row.mentor_name || "Unknown Mentor",
          }
        : null,
    };
  });
}

async function requireEligibleActor(
  client: PoolClient,
  actorUserId: number,
  schoolId: number,
  programId: number,
) {
  if (!(await findEligibleHolisticMentorUserId({
    client,
    userId: actorUserId,
    schoolId,
    programId,
  }))) {
    throw new MappingMutationError(422, "Teacher is no longer eligible for this School");
  }
}

async function lockEligibleStudents(
  client: PoolClient,
  params: {
    schoolId: number;
    programId: number;
    academicYear: string;
    studentIds: number[];
  }
) {
  const eligible = await client.query<{ student_id: number | string }>(
    `WITH ${ELIGIBLE_ROSTER_CTE_SQL}
     SELECT st.id AS student_id
     FROM eligible_roster
     JOIN student st ON st.user_id = eligible_roster.user_id
     WHERE st.id = ANY($4::bigint[])
       AND st.status IS DISTINCT FROM 'dropout'
     ORDER BY st.id
         FOR UPDATE OF st`,
    [params.schoolId, params.academicYear, params.programId, params.studentIds]
  );
  const eligibleIds = new Set(eligible.rows.map((row) => Number(row.student_id)));
  if (eligibleIds.size !== params.studentIds.length ||
      params.studentIds.some((id) => !eligibleIds.has(id))) {
    throw new MappingMutationError(422, "One or more Students are no longer eligible");
  }
}

async function lockActiveMappings(
  client: PoolClient,
  studentIds: number[],
  academicYear: string,
  schoolId: number,
  programId: number,
) {
  const active = await client.query<ActiveMappingRow>(
    `SELECT id, student_id, mentor_user_id
     FROM holistic_mentorship_mentor_mentee_mappings
     WHERE student_id = ANY($1::bigint[]) AND academic_year = $2
       AND school_id = $3 AND program_id = $4 AND ended_at IS NULL
     FOR UPDATE`,
    [studentIds, academicYear, schoolId, programId]
  );
  return {
    rows: active.rows,
    byStudent: new Map(active.rows.map((row) => [Number(row.student_id), row])),
  };
}

function assertAssignmentsCurrent(
  selections: Array<{ studentId: number; expectedMappingId: number | null }>,
  activeByStudent: Map<number, ActiveMappingRow>,
  actorUserId: number,
) {
  for (const selection of selections) {
    assertAssignmentCurrent(
      selection,
      activeByStudent.get(selection.studentId),
      actorUserId,
    );
  }
}

function assertAssignmentCurrent(
  selection: { studentId: number; expectedMappingId: number | null },
  current: ActiveMappingRow | undefined,
  actorUserId: number,
) {
  const currentId = current ? Number(current.id) : 0;
  const expectedId = selection.expectedMappingId ?? 0;
  if (currentId !== expectedId) {
    throw new MappingMutationError(409, "Mapping ownership changed; review the refreshed roster");
  }
  if (!current) return;
  if (Number(current.mentor_user_id) === actorUserId) {
    throw new MappingMutationError(409, "Student is already assigned to you");
  }
  throw new MappingMutationError(409, "Student is already assigned to another Mentor");
}

async function insertMappings(
  client: PoolClient,
  params: {
    studentIds: number[];
    actorUserId: number;
    auditActorUserId?: number;
    actorEmail: string;
    schoolId: number;
    programId: number;
    academicYear: string;
  }
) {
  for (const studentId of params.studentIds) {
    await client.query(
      `INSERT INTO holistic_mentorship_mentor_mentee_mappings
         (student_id, mentor_user_id, school_id, program_id, academic_year,
          started_at, assigned_by_user_id, assigned_by_email, assignment_source,
          inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, now(), now())
       RETURNING id`,
      [studentId, params.actorUserId, params.schoolId, params.programId,
        params.academicYear, params.auditActorUserId ?? null, params.actorEmail,
        "af_lms_teacher_claim"]
    );
  }
}

async function assignAdminMappingInTransaction(
  client: PoolClient,
  params: Parameters<typeof assignHolisticMenteeAsAdmin>[0],
): Promise<HolisticMappingMutationResult> {
  await lockHolisticMentorMappingMutation(client, params.mentorUserId);
  await lockEligibleStudents(client, {
    schoolId: params.schoolId,
    programId: params.programId,
    academicYear: params.academicYear,
    studentIds: [params.studentId],
  });
  const eligibleMentorUserId = await findEligibleHolisticMentorUserId({
    client,
    userId: params.mentorUserId,
    schoolId: params.schoolId,
    programId: params.programId,
  });
  if (eligibleMentorUserId === null) {
    throw new MappingMutationError(422, "Mentor is not eligible for this School and Program");
  }
  const active = await lockActiveMappings(
    client,
    [params.studentId],
    params.academicYear,
    params.schoolId,
    params.programId,
  );
  if (active.byStudent.has(params.studentId)) {
    throw new MappingMutationError(409, "Student is already assigned");
  }
  await client.query(
    `INSERT INTO holistic_mentorship_mentor_mentee_mappings
       (student_id, mentor_user_id, school_id, program_id, academic_year,
        started_at, assigned_by_user_id, assigned_by_email, assignment_source,
        assignment_audit_reason, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, now(), now())
     RETURNING id`,
    [
      params.studentId,
      params.mentorUserId,
      params.schoolId,
      params.programId,
      params.academicYear,
      params.auditActorUserId ?? null,
      params.actorEmail.trim().toLowerCase(),
      "af_lms_admin_assign",
      params.reason.trim(),
    ],
  );
  return { ok: true, changed: 1 };
}

export async function assignHolisticMenteeAsAdmin(params: {
  actorEmail: string;
  auditActorUserId?: number;
  schoolId: number;
  programId: number;
  academicYear: string;
  studentId: number;
  mentorUserId: number;
  expectedMappingId: null;
  confirmed: boolean;
  reason: string;
}): Promise<HolisticMappingMutationResult> {
  if (!params.confirmed) {
    return { ok: false, status: 422, error: "Assignment confirmation is required" };
  }
  if (!params.reason.trim()) {
    return { ok: false, status: 422, error: "Assignment reason is required" };
  }
  if (params.academicYear !== CURRENT_ACADEMIC_YEAR) {
    return {
      ok: false,
      status: 422,
      error: "Admin Mapping assignments are limited to the current Academic Year",
    };
  }
  await reconcileHolisticMappings({
    academicYear: params.academicYear,
    studentIds: [params.studentId],
    programId: params.programId,
  });
  try {
    return await withTransaction((client) => assignAdminMappingInTransaction(client, params));
  } catch (error) {
    if (error instanceof MappingMutationError || isUniqueViolation(error)) {
      return mutationConflict(
        error as MappingMutationError | { code?: unknown },
        [params.studentId],
        params.academicYear,
        params.schoolId,
        params.programId,
      );
    }
    throw error;
  }
}

async function assignInTransaction(
  client: PoolClient,
  params: Parameters<typeof assignHolisticMentees>[0],
  studentIds: number[]
): Promise<HolisticMappingMutationResult> {
  await lockHolisticMentorMappingMutation(client, params.actorUserId);
  await requireEligibleActor(
    client,
    params.actorUserId,
    params.schoolId,
    params.programId,
  );
  await lockEligibleStudents(client, {
    schoolId: params.schoolId,
    programId: params.programId,
    academicYear: params.academicYear,
    studentIds,
  });
  const active = await lockActiveMappings(
    client,
    studentIds,
    params.academicYear,
    params.schoolId,
    params.programId,
  );
  assertAssignmentsCurrent(
    params.selections,
    active.byStudent,
    params.actorUserId,
  );
  await insertMappings(client, { ...params, studentIds });
  return { ok: true, changed: studentIds.length };
}

async function mutationConflict(
  error: MappingMutationError | { code?: unknown },
  studentIds: number[],
  academicYear: string,
  schoolId: number,
  programId: number,
): Promise<HolisticMappingMutationResult> {
  const known = error instanceof MappingMutationError;
  if (known && error.status === 422) {
    return { ok: false, status: error.status, error: error.message };
  }
  return {
    ok: false,
    status: known ? error.status : 409,
    error: known ? error.message : "Mapping ownership changed; review the refreshed roster",
    ownership: await currentOwnership(
      studentIds,
      academicYear,
      schoolId,
      programId,
    ),
  };
}

export async function assignHolisticMentees(params: {
  actorUserId: number;
  auditActorUserId?: number;
  actorEmail: string;
  schoolId: number;
  programId: number;
  academicYear: string;
  selections: Array<{ studentId: number; expectedMappingId: number | null }>;
}): Promise<HolisticMappingMutationResult> {
  const studentIds = params.selections.map(({ studentId }) => studentId).sort((a, b) => a - b);
  await reconcileHolisticMappings({
    academicYear: params.academicYear,
    studentIds,
    programId: params.programId,
  });
  try {
    return await withTransaction((client) => assignInTransaction(client, params, studentIds));
  } catch (error) {
    if (error instanceof MappingMutationError || isUniqueViolation(error)) {
      return mutationConflict(
        error as MappingMutationError | { code?: unknown },
        studentIds,
        params.academicYear,
        params.schoolId,
        params.programId,
      );
    }
    throw error;
  }
}

async function reassignAdminMappingInTransaction(
  client: PoolClient,
  params: Parameters<typeof reassignHolisticMenteeAsAdmin>[0],
): Promise<HolisticMappingMutationResult> {
  await lockHolisticMentorMappingMutation(client, params.mentorUserId);
  await lockEligibleStudents(client, {
    schoolId: params.schoolId,
    programId: params.programId,
    academicYear: params.academicYear,
    studentIds: [params.studentId],
  });
  const eligibleMentorUserId = await findEligibleHolisticMentorUserId({
    client,
    userId: params.mentorUserId,
    schoolId: params.schoolId,
    programId: params.programId,
  });
  if (eligibleMentorUserId === null) {
    throw new MappingMutationError(422, "Mentor is not eligible for this School and Program");
  }
  const active = await lockActiveMappings(
    client,
    [params.studentId],
    params.academicYear,
    params.schoolId,
    params.programId,
  );
  const current = active.byStudent.get(params.studentId);
  if (Number(current?.id ?? 0) !== params.expectedMappingId) {
    throw new MappingMutationError(409, "Mapping ownership changed; review the refreshed roster");
  }
  if (Number(current?.mentor_user_id) === params.mentorUserId) {
    throw new MappingMutationError(422, "Replacement Mentor must differ from the current Mentor");
  }

  const actorEmail = params.actorEmail.trim().toLowerCase();
  const reason = params.reason.trim();
  await client.query(
    `UPDATE holistic_mentorship_mentor_mentee_mappings
     SET ended_at = now(), ended_by_user_id = $1, ended_by_email = $2,
         end_source = $3, end_reason = $4, end_audit_reason = $5, updated_at = now()
     WHERE id = $6`,
    [params.auditActorUserId ?? null, actorEmail, "af_lms_admin_reassign",
      "admin_reassignment", reason, params.expectedMappingId],
  );
  await eraseDraftHolisticNotes(
    client,
    [params.studentId],
    params.auditActorUserId ?? null,
    reason,
    actorEmail,
  );
  await client.query(
    `INSERT INTO holistic_mentorship_mentor_mentee_mappings
       (student_id, mentor_user_id, school_id, program_id, academic_year,
        started_at, assigned_by_user_id, assigned_by_email, assignment_source,
        assignment_audit_reason, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, now(), now())
     RETURNING id`,
    [
      params.studentId,
      params.mentorUserId,
      params.schoolId,
      params.programId,
      params.academicYear,
      params.auditActorUserId ?? null,
      actorEmail,
      "af_lms_admin_reassign",
      reason,
    ],
  );
  return { ok: true, changed: 1 };
}

export async function reassignHolisticMenteeAsAdmin(params: {
  actorEmail: string;
  auditActorUserId?: number;
  schoolId: number;
  programId: number;
  academicYear: string;
  studentId: number;
  mentorUserId: number;
  expectedMappingId: number;
  confirmed: boolean;
  reason: string;
}): Promise<HolisticMappingMutationResult> {
  if (!params.confirmed) {
    return { ok: false, status: 422, error: "Reassignment confirmation is required" };
  }
  if (!params.reason.trim()) {
    return { ok: false, status: 422, error: "Reassignment reason is required" };
  }
  if (params.academicYear !== CURRENT_ACADEMIC_YEAR) {
    return {
      ok: false,
      status: 422,
      error: "Admin Mapping reassignments are limited to the current Academic Year",
    };
  }
  try {
    return await withTransaction((client) => reassignAdminMappingInTransaction(client, params));
  } catch (error) {
    if (error instanceof MappingMutationError || isUniqueViolation(error)) {
      return mutationConflict(
        error as MappingMutationError | { code?: unknown },
        [params.studentId],
        params.academicYear,
        params.schoolId,
        params.programId,
      );
    }
    throw error;
  }
}

async function removeAdminMappingInTransaction(
  client: PoolClient,
  params: Parameters<typeof removeHolisticMenteeAsAdmin>[0],
): Promise<HolisticMappingMutationResult> {
  const active = await lockActiveMappings(
    client,
    [params.studentId],
    params.academicYear,
    params.schoolId,
    params.programId,
  );
  const current = active.byStudent.get(params.studentId);
  if (Number(current?.id ?? 0) !== params.expectedMappingId) {
    throw new MappingMutationError(409, "Mapping ownership changed; review the refreshed roster");
  }

  const actorEmail = params.actorEmail.trim().toLowerCase();
  const reason = params.reason.trim();
  await client.query(
    `UPDATE holistic_mentorship_mentor_mentee_mappings
     SET ended_at = now(), ended_by_user_id = $1, ended_by_email = $2,
         end_source = $3, end_reason = $4, end_audit_reason = $5, updated_at = now()
     WHERE id = $6`,
    [params.auditActorUserId ?? null, actorEmail, "af_lms_admin_remove",
      "admin_removal", reason, params.expectedMappingId],
  );
  await eraseDraftHolisticNotesForMapping(client, {
    studentId: params.studentId,
    mentorUserId: Number(current!.mentor_user_id),
    programId: params.programId,
    academicYear: params.academicYear,
    actorUserId: params.auditActorUserId ?? null,
    actorEmail,
    reason,
  });
  return { ok: true, changed: 1 };
}

export async function removeHolisticMenteeAsAdmin(params: {
  actorEmail: string;
  auditActorUserId?: number;
  schoolId: number;
  programId: number;
  academicYear: string;
  studentId: number;
  expectedMappingId: number;
  confirmed: boolean;
  reason: string;
}): Promise<HolisticMappingMutationResult> {
  if (!params.confirmed) {
    return { ok: false, status: 422, error: "Removal confirmation is required" };
  }
  if (!params.reason.trim()) {
    return { ok: false, status: 422, error: "Removal reason is required" };
  }
  if (params.academicYear !== CURRENT_ACADEMIC_YEAR) {
    return {
      ok: false,
      status: 422,
      error: "Admin Mapping removals are limited to the current Academic Year",
    };
  }
  try {
    return await withTransaction((client) => removeAdminMappingInTransaction(client, params));
  } catch (error) {
    if (error instanceof MappingMutationError) {
      return mutationConflict(
        error,
        [params.studentId],
        params.academicYear,
        params.schoolId,
        params.programId,
      );
    }
    throw error;
  }
}

async function removeInTransaction(
  client: PoolClient,
  params: Parameters<typeof removeHolisticMentees>[0],
  studentIds: number[]
): Promise<HolisticMappingMutationResult> {
  await lockHolisticMentorMappingMutation(client, params.actorUserId);
  await requireEligibleActor(
    client,
    params.actorUserId,
    params.schoolId,
    params.programId,
  );
  const active = await lockActiveMappings(
    client,
    studentIds,
    params.academicYear,
    params.schoolId,
    params.programId,
  );
  for (const expected of params.mappings) {
    const current = active.byStudent.get(expected.studentId);
    if (Number(current?.id ?? 0) !== expected.expectedMappingId ||
        Number(current?.mentor_user_id ?? 0) !== params.actorUserId) {
      throw new MappingMutationError(409, "Mapping ownership changed; review the refreshed roster");
    }
  }
  const mappingIds = params.mappings.map(({ expectedMappingId }) => expectedMappingId);
  await client.query(
    `UPDATE holistic_mentorship_mentor_mentee_mappings
     SET ended_at = now(), ended_by_user_id = $1, ended_by_email = $2,
         end_source = $3, end_reason = $4, updated_at = now()
     WHERE id = ANY($5::bigint[])`,
    [params.auditActorUserId ?? null, params.actorEmail, "af_lms_teacher",
      "teacher_removal", mappingIds]
  );
  await eraseDraftHolisticNotes(
    client,
    studentIds,
    params.auditActorUserId ?? null,
    "teacher_removal",
    params.actorEmail,
  );
  return { ok: true, changed: mappingIds.length };
}

export async function removeHolisticMentees(params: {
  actorUserId: number;
  auditActorUserId?: number;
  actorEmail: string;
  schoolId: number;
  programId: number;
  academicYear: string;
  mappings: Array<{ studentId: number; expectedMappingId: number }>;
  confirmed: boolean;
}): Promise<HolisticMappingMutationResult> {
  const studentIds = params.mappings.map(({ studentId }) => studentId);
  if (!params.confirmed) {
    return { ok: false, status: 422, error: "Removal confirmation is required" };
  }
  await reconcileHolisticMappings({
    academicYear: params.academicYear,
    studentIds,
    programId: params.programId,
  });
  try {
    return await withTransaction((client) => removeInTransaction(client, params, studentIds));
  } catch (error) {
    if (error instanceof MappingMutationError) {
      return mutationConflict(
        error,
        studentIds,
        params.academicYear,
        params.schoolId,
        params.programId,
      );
    }
    throw error;
  }
}

export async function listHolisticAssignmentRoster(params: {
  permission: UserPermission;
  actorUserId?: number;
  schoolId: number;
  programId: number;
  academicYear: string;
  search?: string;
  grade?: 11 | 12 | null;
}): Promise<HolisticAssignmentRosterStudent[]> {
  await reconcileHolisticMappings({
    academicYear: params.academicYear,
    schoolId: params.schoolId,
    programId: params.programId,
  });
  const schoolScope = buildHolisticSchoolScopePredicate(params.permission, {
    startIndex: 8,
    schoolCodeColumn: "scope_school.code",
    schoolRegionColumn: "scope_school.region",
  });
  const schoolScopeSql = schoolScope.clause
    ? `AND EXISTS (
         SELECT 1
         FROM school scope_school
         WHERE scope_school.id = $1 AND ${schoolScope.clause}
       )`
    : "";
  const rows = await query<RosterRow>(
    `WITH ${ELIGIBLE_ROSTER_CTE_SQL}
     SELECT st.id AS student_id,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name,
            st.student_id AS external_student_id,
            roster_student.grade,
            active_phase.id AS active_phase_id,
            CASE WHEN active_notes.state = 'submitted' THEN 'submitted'
                 WHEN $6::boolean
                  AND active_notes.state = 'draft'
                  AND active_notes.author_user_id = $7
                  AND mapping.mentor_user_id = $7 THEN 'draft'
            END AS active_notes_state,
            mapping.id AS mapping_id,
            mapping.mentor_user_id,
            NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), '') AS mentor_name
     FROM eligible_roster roster_student
     JOIN "user" u ON u.id = roster_student.user_id
     JOIN student st ON st.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT phase.id
       FROM holistic_mentorship_phase_plans plan
       JOIN holistic_mentorship_phases phase ON phase.phase_plan_id = plan.id AND phase.state = 'open'
       JOIN grade phase_grade
         ON phase_grade.id = phase.grade_id AND phase_grade.number = roster_student.grade
       WHERE plan.program_id = $3 AND plan.academic_year = $2
       ORDER BY phase.position DESC
       LIMIT 1
     ) active_phase ON true
     LEFT JOIN holistic_mentorship_post_session_notes active_notes
       ON active_notes.student_id = st.id
      AND active_notes.phase_id = active_phase.id
     LEFT JOIN holistic_mentorship_mentor_mentee_mappings mapping
       ON mapping.student_id = st.id
      AND mapping.academic_year = $2
      AND mapping.school_id = $1
      AND mapping.program_id = $3
      AND mapping.ended_at IS NULL
     LEFT JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
     WHERE st.status IS DISTINCT FROM 'dropout'
       ${schoolScopeSql}
       AND ($4 = '%%' OR st.student_id ILIKE $4 OR
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $4)
       AND ($5::int IS NULL OR roster_student.grade = $5)
     ORDER BY roster_student.grade, name NULLS LAST, st.student_id`,
    [
      params.schoolId,
      params.academicYear,
      params.programId,
      `%${(params.search ?? "").trim()}%`,
      params.grade ?? null,
      params.permission.role === "teacher" && params.actorUserId !== undefined,
      params.actorUserId ?? null,
      ...schoolScope.params,
    ]
  );

  return rows.map((row) => ({
    studentId: Number(row.student_id),
    name: row.name || row.external_student_id || "Unknown Student",
    externalStudentId: row.external_student_id,
    grade: Number(row.grade),
    activePhaseId: row.active_phase_id === null ? null : Number(row.active_phase_id),
    activeNotesState: row.active_notes_state ?? null,
    ownership:
      row.mapping_id === null || row.mentor_user_id === null
        ? null
        : {
            mappingId: Number(row.mapping_id),
            mentorUserId: Number(row.mentor_user_id),
            mentorName: row.mentor_name || "Unknown Mentor",
          },
  }));
}

export async function getHolisticAssignmentCoverageSummary(params: {
  permission: UserPermission;
  schoolId: number;
  programId: number;
  academicYear: string;
}): Promise<HolisticAssignmentCoverageSummary> {
  await reconcileHolisticMappings({
    academicYear: params.academicYear,
    schoolId: params.schoolId,
    programId: params.programId,
  });
  const schoolScope = buildHolisticSchoolScopePredicate(params.permission, {
    startIndex: 4,
    schoolCodeColumn: "scope_school.code",
    schoolRegionColumn: "scope_school.region",
  });
  const schoolScopeSql = schoolScope.clause
    ? `AND EXISTS (
         SELECT 1
         FROM school scope_school
         WHERE scope_school.id = $1 AND ${schoolScope.clause}
       )`
    : "";
  const rows = await query<CoverageSummaryRow>(
    `WITH ${ELIGIBLE_ROSTER_CTE_SQL},
     coverage_roster AS MATERIALIZED (
       SELECT st.id AS student_id,
              mapping.mentor_user_id,
              active_phase.id AS active_phase_id,
              EXISTS (
                SELECT 1
                FROM holistic_mentorship_post_session_notes notes
                WHERE notes.student_id = st.id
                  AND notes.phase_id = active_phase.id
                  AND notes.state = 'submitted'
              ) AS has_submitted_notes
       FROM eligible_roster roster_student
       JOIN student st ON st.user_id = roster_student.user_id
       LEFT JOIN LATERAL (
         SELECT phase.id
         FROM holistic_mentorship_phase_plans plan
         JOIN holistic_mentorship_phases phase
           ON phase.phase_plan_id = plan.id AND phase.state = 'open'
         JOIN grade phase_grade
           ON phase_grade.id = phase.grade_id AND phase_grade.number = roster_student.grade
         WHERE plan.program_id = $3 AND plan.academic_year = $2
         ORDER BY phase.position DESC
         LIMIT 1
       ) active_phase ON true
       LEFT JOIN holistic_mentorship_mentor_mentee_mappings mapping
         ON mapping.student_id = st.id
        AND mapping.academic_year = $2
        AND mapping.school_id = $1
        AND mapping.program_id = $3
        AND mapping.ended_at IS NULL
       WHERE st.status IS DISTINCT FROM 'dropout'
         ${schoolScopeSql}
     ), counts AS (
       SELECT COUNT(*)::int AS eligible_count,
              COUNT(*) FILTER (WHERE mentor_user_id IS NOT NULL)::int AS assigned_count,
              COUNT(*) FILTER (WHERE mentor_user_id IS NULL)::int AS unassigned_count,
              COUNT(DISTINCT mentor_user_id)::int AS active_mentor_count,
              COUNT(*) FILTER (
                WHERE active_phase_id IS NOT NULL AND has_submitted_notes
              )::int AS completed_count,
              COUNT(*) FILTER (
                WHERE active_phase_id IS NOT NULL AND NOT has_submitted_notes
              )::int AS pending_count,
              COUNT(*) FILTER (WHERE active_phase_id IS NULL)::int AS no_active_phase_count
       FROM coverage_roster
     )
     SELECT eligible_count, assigned_count, unassigned_count, active_mentor_count,
            CASE WHEN eligible_count = 0 THEN 0
                 ELSE ROUND(assigned_count * 100.0 / eligible_count, 1)
            END AS coverage_percentage,
            completed_count, pending_count, no_active_phase_count
     FROM counts`,
    [params.schoolId, params.academicYear, params.programId, ...schoolScope.params],
  );
  const row = rows[0];
  return {
    eligible: Number(row?.eligible_count ?? 0),
    assigned: Number(row?.assigned_count ?? 0),
    unassigned: Number(row?.unassigned_count ?? 0),
    activeMentors: Number(row?.active_mentor_count ?? 0),
    coveragePercentage: Number(row?.coverage_percentage ?? 0),
    completed: Number(row?.completed_count ?? 0),
    pending: Number(row?.pending_count ?? 0),
    noActivePhase: Number(row?.no_active_phase_count ?? 0),
  };
}
