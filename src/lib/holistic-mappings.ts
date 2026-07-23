import { PROGRAM_IDS } from "./constants";
import { query, withTransaction } from "./db";
import { reconcileHolisticMappings } from "./holistic-reconciliation";
import { PM_SEAT_ROLES } from "./staff-shared";
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

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

async function actorIsEligible(
  client: PoolClient,
  actorUserId: number,
  schoolId: number
): Promise<boolean> {
  const actor = await client.query(
    `SELECT DISTINCT u.id AS user_id
     FROM teacher t
     JOIN "user" u ON u.id = t.user_id
     JOIN user_permission up
       ON (up.user_id = u.id OR LOWER(up.email) = LOWER(u.email))
      AND up.revoked_at IS NULL AND up.role = 'teacher'
     JOIN centre_positions cp
       ON cp.user_id = u.id AND cp.deleted_at IS NULL AND NOT (cp.role = ANY($4::text[]))
     JOIN centres c ON c.id = cp.centre_id AND c.is_active IS TRUE
     WHERE u.id = $1 AND c.school_id = $2 AND c.program_id = $3
       AND t.is_af_teacher = true AND t.exit_date IS NULL
     LIMIT 1`,
    [actorUserId, schoolId, PROGRAM_IDS.COE, [...PM_SEAT_ROLES]]
  );
  return actor.rows.length > 0;
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
  actorUserId: number,
  reason: string
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
       (notes_id, actor_user_id, action, occurred_at, reason, inserted_at, updated_at)
     SELECT id, $2, 'draft_erased_on_mapping_end', now(), $3, now(), now()
     FROM updated_notes`,
    [studentIds, actorUserId, reason]
  );
}

async function currentOwnership(
  studentIds: number[],
  academicYear: string,
  schoolId: number
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
    [studentIds, academicYear, schoolId, PROGRAM_IDS.COE]
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

async function requireEligibleActor(client: PoolClient, actorUserId: number, schoolId: number) {
  if (!(await actorIsEligible(client, actorUserId, schoolId))) {
    throw new MappingMutationError(422, "Teacher is no longer eligible for this School");
  }
}

async function lockEligibleStudents(
  client: PoolClient,
  params: { schoolId: number; academicYear: string; studentIds: number[] }
) {
  const eligible = await client.query<{ student_id: number | string }>(
    `SELECT st.id AS student_id
     FROM centre_students roster_student
     JOIN centres roster_centre
       ON roster_centre.id = roster_student.centre_id
      AND roster_centre.school_id = $1
      AND roster_centre.program_id = $3
      AND roster_centre.is_active IS TRUE
     JOIN student st ON st.user_id = roster_student.user_id
     WHERE roster_student.academic_year = $2
       AND roster_student.program_id = $3
       AND st.id = ANY($4::bigint[])
       AND st.status IS DISTINCT FROM 'dropout'
       AND roster_student.grade IN (11, 12)
     ORDER BY st.id
         FOR UPDATE OF st`,
    [params.schoolId, params.academicYear, PROGRAM_IDS.COE, params.studentIds]
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
  schoolId: number
) {
  const active = await client.query<ActiveMappingRow>(
    `SELECT id, student_id, mentor_user_id
     FROM holistic_mentorship_mentor_mentee_mappings
     WHERE student_id = ANY($1::bigint[]) AND academic_year = $2
       AND school_id = $3 AND program_id = $4 AND ended_at IS NULL
     FOR UPDATE`,
    [studentIds, academicYear, schoolId, PROGRAM_IDS.COE]
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
  takeoverConfirmed: boolean
) {
  for (const selection of selections) {
    assertAssignmentCurrent(
      selection,
      activeByStudent.get(selection.studentId),
      actorUserId,
      takeoverConfirmed
    );
  }
}

function assertAssignmentCurrent(
  selection: { studentId: number; expectedMappingId: number | null },
  current: ActiveMappingRow | undefined,
  actorUserId: number,
  takeoverConfirmed: boolean
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
  if (!takeoverConfirmed) {
    throw new MappingMutationError(409, "Confirm takeover using the refreshed roster");
  }
}

async function endMappingsForTakeover(
  client: PoolClient,
  active: ActiveMappingRow[],
  actorUserId: number
) {
  if (active.length === 0) return;
  await client.query(
    `UPDATE holistic_mentorship_mentor_mentee_mappings
     SET ended_at = now(), ended_by_user_id = $1, end_source = $2,
         end_reason = $3, updated_at = now()
     WHERE id = ANY($4::bigint[])`,
    [actorUserId, "af_lms_teacher", "teacher_takeover", active.map((row) => Number(row.id))]
  );
  await eraseDraftHolisticNotes(
    client,
    active.map((row) => Number(row.student_id)),
    actorUserId,
    "teacher_takeover"
  );
}

async function insertMappings(
  client: PoolClient,
  params: {
    studentIds: number[];
    actorUserId: number;
    schoolId: number;
    academicYear: string;
    activeByStudent: Map<number, ActiveMappingRow>;
  }
) {
  for (const studentId of params.studentIds) {
    const source = params.activeByStudent.has(studentId)
      ? "af_lms_teacher_takeover"
      : "af_lms_teacher_claim";
    await client.query(
      `INSERT INTO holistic_mentorship_mentor_mentee_mappings
         (student_id, mentor_user_id, school_id, program_id, academic_year,
          started_at, assigned_by_user_id, assignment_source, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7, now(), now())
       RETURNING id`,
      [studentId, params.actorUserId, params.schoolId, PROGRAM_IDS.COE,
        params.academicYear, params.actorUserId, source]
    );
  }
}

async function assignInTransaction(
  client: PoolClient,
  params: Parameters<typeof assignHolisticMentees>[0],
  studentIds: number[]
): Promise<HolisticMappingMutationResult> {
  await lockHolisticMentorMappingMutation(client, params.actorUserId);
  await requireEligibleActor(client, params.actorUserId, params.schoolId);
  await lockEligibleStudents(client, {
    schoolId: params.schoolId,
    academicYear: params.academicYear,
    studentIds,
  });
  const active = await lockActiveMappings(
    client,
    studentIds,
    params.academicYear,
    params.schoolId
  );
  assertAssignmentsCurrent(
    params.selections,
    active.byStudent,
    params.actorUserId,
    params.takeoverConfirmed
  );
  await endMappingsForTakeover(client, active.rows, params.actorUserId);
  await insertMappings(client, { ...params, studentIds, activeByStudent: active.byStudent });
  return { ok: true, changed: studentIds.length };
}

async function mutationConflict(
  error: MappingMutationError | { code?: unknown },
  studentIds: number[],
  academicYear: string,
  schoolId: number
): Promise<HolisticMappingMutationResult> {
  const known = error instanceof MappingMutationError;
  if (known && error.status === 422) {
    return { ok: false, status: error.status, error: error.message };
  }
  return {
    ok: false,
    status: known ? error.status : 409,
    error: known ? error.message : "Mapping ownership changed; review the refreshed roster",
    ownership: await currentOwnership(studentIds, academicYear, schoolId),
  };
}

export async function assignHolisticMentees(params: {
  actorUserId: number;
  schoolId: number;
  academicYear: string;
  selections: Array<{ studentId: number; expectedMappingId: number | null }>;
  takeoverConfirmed: boolean;
}): Promise<HolisticMappingMutationResult> {
  const studentIds = params.selections.map(({ studentId }) => studentId).sort((a, b) => a - b);
  await reconcileHolisticMappings({ academicYear: params.academicYear, studentIds });
  try {
    return await withTransaction((client) => assignInTransaction(client, params, studentIds));
  } catch (error) {
    if (error instanceof MappingMutationError || isUniqueViolation(error)) {
      return mutationConflict(
        error as MappingMutationError | { code?: unknown },
        studentIds,
        params.academicYear,
        params.schoolId
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
  await requireEligibleActor(client, params.actorUserId, params.schoolId);
  const active = await lockActiveMappings(
    client,
    studentIds,
    params.academicYear,
    params.schoolId
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
     SET ended_at = now(), ended_by_user_id = $1, end_source = $2,
         end_reason = $3, updated_at = now()
     WHERE id = ANY($4::bigint[])`,
    [params.actorUserId, "af_lms_teacher", "teacher_removal", mappingIds]
  );
  await eraseDraftHolisticNotes(client, studentIds, params.actorUserId, "teacher_removal");
  return { ok: true, changed: mappingIds.length };
}

export async function removeHolisticMentees(params: {
  actorUserId: number;
  schoolId: number;
  academicYear: string;
  mappings: Array<{ studentId: number; expectedMappingId: number }>;
  confirmed: boolean;
}): Promise<HolisticMappingMutationResult> {
  const studentIds = params.mappings.map(({ studentId }) => studentId);
  if (!params.confirmed) {
    return { ok: false, status: 422, error: "Removal confirmation is required" };
  }
  await reconcileHolisticMappings({ academicYear: params.academicYear, studentIds });
  try {
    return await withTransaction((client) => removeInTransaction(client, params, studentIds));
  } catch (error) {
    if (error instanceof MappingMutationError) {
      return mutationConflict(error, studentIds, params.academicYear, params.schoolId);
    }
    throw error;
  }
}

export async function listHolisticAssignmentRoster(params: {
  schoolId: number;
  academicYear: string;
  search?: string;
  grade?: 11 | 12 | null;
}): Promise<HolisticAssignmentRosterStudent[]> {
  await reconcileHolisticMappings({
    academicYear: params.academicYear,
    schoolId: params.schoolId,
  });
  const rows = await query<RosterRow>(
    `SELECT st.id AS student_id,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name,
            st.student_id AS external_student_id,
            roster_student.grade,
            active_phase.id AS active_phase_id,
            active_notes.state AS active_notes_state,
            mapping.id AS mapping_id,
            mapping.mentor_user_id,
            NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), '') AS mentor_name
     FROM centre_students roster_student
     JOIN centres roster_centre
       ON roster_centre.id = roster_student.centre_id
      AND roster_centre.school_id = $1
      AND roster_centre.program_id = $3
      AND roster_centre.is_active IS TRUE
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
     WHERE roster_student.academic_year = $2
       AND roster_student.program_id = $3
       AND st.status IS DISTINCT FROM 'dropout'
       AND roster_student.grade IN (11, 12)
       AND ($4 = '%%' OR st.student_id ILIKE $4 OR
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $4)
       AND ($5::int IS NULL OR roster_student.grade = $5)
     ORDER BY roster_student.grade, name NULLS LAST, st.student_id`,
    [
      params.schoolId,
      params.academicYear,
      PROGRAM_IDS.COE,
      `%${(params.search ?? "").trim()}%`,
      params.grade ?? null,
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
