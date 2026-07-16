import { PROGRAM_IDS } from "./constants";
import { query, withTransaction } from "./db";
import { PM_SEAT_ROLES } from "./staff-shared";
import type { PoolClient } from "pg";

interface RosterRow {
  student_id: number | string;
  name: string | null;
  external_student_id: string | null;
  grade: number | string;
  active_phase_id: number | string | null;
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
  academicYear: string
): Promise<Array<{ studentId: number; ownership: HolisticAssignmentRosterStudent["ownership"] }>> {
  const rows = await query<ActiveMappingRow & { mentor_name: string | null }>(
    `SELECT mapping.id, mapping.student_id, mapping.mentor_user_id,
            NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), '') AS mentor_name
     FROM holistic_mentorship_mentor_mentee_mappings mapping
     JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
     WHERE mapping.student_id = ANY($1::bigint[])
       AND mapping.academic_year = $2
       AND mapping.ended_at IS NULL`,
    [studentIds, academicYear]
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

export async function assignHolisticMentees(params: {
  actorUserId: number;
  schoolId: number;
  academicYear: string;
  selections: Array<{ studentId: number; expectedMappingId: number | null }>;
  takeoverConfirmed: boolean;
}): Promise<HolisticMappingMutationResult> {
  const studentIds = params.selections.map(({ studentId }) => studentId).sort((a, b) => a - b);
  try {
    return await withTransaction(async (client) => {
      if (!(await actorIsEligible(client, params.actorUserId, params.schoolId))) {
        throw new MappingMutationError(422, "Teacher is no longer eligible for this School");
      }

      const eligible = await client.query<{ student_id: number | string }>(
        `SELECT st.id AS student_id
         FROM group_user gu_school
         JOIN "group" school_group
           ON school_group.id = gu_school.group_id AND school_group.type = 'school' AND school_group.child_id = $1
         JOIN "user" u ON u.id = gu_school.user_id
         JOIN student st ON st.user_id = u.id
         JOIN enrollment_record er_grade
           ON er_grade.user_id = u.id AND er_grade.group_type = 'grade'
          AND er_grade.academic_year = $2 AND er_grade.is_current = true
         JOIN grade gr ON gr.id = er_grade.group_id
         JOIN LATERAL (
           SELECT b.program_id
           FROM enrollment_record er_batch
           JOIN "group" batch_group
             ON batch_group.id = er_batch.group_id AND batch_group.type = 'batch'
           JOIN batch b ON b.id = batch_group.child_id
           WHERE er_batch.user_id = u.id
             AND er_batch.group_type = 'batch'
             AND er_batch.is_current = true
           ORDER BY array_position(ARRAY[1, 2, 64]::int[], b.program_id), er_batch.id
           LIMIT 1
         ) roster_program ON true
         WHERE roster_program.program_id = $3
           AND st.id = ANY($4::bigint[])
           AND st.status IS DISTINCT FROM 'dropout'
           AND gr.number IN (11, 12)
         ORDER BY st.id
         FOR UPDATE OF st`,
        [params.schoolId, params.academicYear, PROGRAM_IDS.COE, studentIds]
      );
      const eligibleIds = new Set(eligible.rows.map((row) => Number(row.student_id)));
      if (eligibleIds.size !== studentIds.length || studentIds.some((id) => !eligibleIds.has(id))) {
        throw new MappingMutationError(422, "One or more Students are no longer eligible");
      }

      const active = await client.query<ActiveMappingRow>(
        `SELECT id, student_id, mentor_user_id
         FROM holistic_mentorship_mentor_mentee_mappings
         WHERE student_id = ANY($1::bigint[]) AND academic_year = $2 AND ended_at IS NULL
         FOR UPDATE`,
        [studentIds, params.academicYear]
      );
      const activeByStudent = new Map(
        active.rows.map((row) => [Number(row.student_id), row])
      );

      for (const selection of params.selections) {
        const current = activeByStudent.get(selection.studentId);
        if (Number(current?.id ?? 0) !== (selection.expectedMappingId ?? 0)) {
          throw new MappingMutationError(409, "Mapping ownership changed; review the refreshed roster");
        }
        if (current && Number(current.mentor_user_id) === params.actorUserId) {
          throw new MappingMutationError(409, "Student is already assigned to you");
        }
        if (current && !params.takeoverConfirmed) {
          throw new MappingMutationError(409, "Confirm takeover using the refreshed roster");
        }
      }

      const replacedIds = active.rows.map((row) => Number(row.id));
      if (replacedIds.length > 0) {
        await client.query(
          `UPDATE holistic_mentorship_mentor_mentee_mappings
           SET ended_at = now(), ended_by_user_id = $1, end_source = $2,
               end_reason = $3, updated_at = now()
           WHERE id = ANY($4::bigint[])`,
          [params.actorUserId, "af_lms_teacher", "teacher_takeover", replacedIds]
        );
        await eraseDraftHolisticNotes(
          client,
          active.rows.map((row) => Number(row.student_id)),
          params.actorUserId,
          "teacher_takeover"
        );
      }

      for (const studentId of studentIds) {
        const source = activeByStudent.has(studentId)
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
      return { ok: true, changed: studentIds.length };
    });
  } catch (error) {
    if (error instanceof MappingMutationError || isUniqueViolation(error)) {
      return {
        ok: false,
        status: error instanceof MappingMutationError ? error.status : 409,
        error: error instanceof MappingMutationError
          ? error.message
          : "Mapping ownership changed; review the refreshed roster",
        ownership: await currentOwnership(studentIds, params.academicYear),
      };
    }
    throw error;
  }
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
  try {
    return await withTransaction(async (client) => {
      if (!(await actorIsEligible(client, params.actorUserId, params.schoolId))) {
        throw new MappingMutationError(422, "Teacher is no longer eligible for this School");
      }
      const active = await client.query<ActiveMappingRow>(
        `SELECT id, student_id, mentor_user_id
         FROM holistic_mentorship_mentor_mentee_mappings
         WHERE student_id = ANY($1::bigint[]) AND academic_year = $2 AND ended_at IS NULL
         FOR UPDATE`,
        [studentIds, params.academicYear]
      );
      const activeByStudent = new Map(
        active.rows.map((row) => [Number(row.student_id), row])
      );
      for (const expected of params.mappings) {
        const current = activeByStudent.get(expected.studentId);
        if (
          Number(current?.id ?? 0) !== expected.expectedMappingId ||
          Number(current?.mentor_user_id ?? 0) !== params.actorUserId
        ) {
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
      await eraseDraftHolisticNotes(
        client,
        studentIds,
        params.actorUserId,
        "teacher_removal"
      );
      return { ok: true, changed: mappingIds.length };
    });
  } catch (error) {
    if (error instanceof MappingMutationError) {
      return {
        ok: false,
        status: error.status,
        error: error.message,
        ownership: await currentOwnership(studentIds, params.academicYear),
      };
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
  const rows = await query<RosterRow>(
    `SELECT st.id AS student_id,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name,
            st.student_id AS external_student_id,
            gr.number AS grade,
            active_phase.id AS active_phase_id,
            mapping.id AS mapping_id,
            mapping.mentor_user_id,
            NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), '') AS mentor_name
     FROM group_user gu_school
     JOIN "group" school_group
       ON school_group.id = gu_school.group_id
      AND school_group.type = 'school'
      AND school_group.child_id = $1
     JOIN "user" u ON u.id = gu_school.user_id
     JOIN student st ON st.user_id = u.id
     JOIN enrollment_record er_grade
       ON er_grade.user_id = u.id
      AND er_grade.group_type = 'grade'
      AND er_grade.academic_year = $2
      AND er_grade.is_current = true
     JOIN grade gr ON gr.id = er_grade.group_id
     JOIN LATERAL (
       SELECT b.program_id
       FROM enrollment_record er_batch
       JOIN "group" batch_group
         ON batch_group.id = er_batch.group_id AND batch_group.type = 'batch'
       JOIN batch b ON b.id = batch_group.child_id
       WHERE er_batch.user_id = u.id
         AND er_batch.group_type = 'batch'
         AND er_batch.is_current = true
       ORDER BY array_position(ARRAY[1, 2, 64]::int[], b.program_id), er_batch.id
       LIMIT 1
     ) roster_program ON true
     LEFT JOIN LATERAL (
       SELECT phase.id
       FROM holistic_mentorship_phase_plans plan
       JOIN holistic_mentorship_phases phase ON phase.phase_plan_id = plan.id AND phase.state = 'open'
       JOIN grade phase_grade ON phase_grade.id = phase.grade_id AND phase_grade.number = gr.number
       WHERE plan.program_id = $3 AND plan.academic_year = $2
       ORDER BY phase.position DESC
       LIMIT 1
     ) active_phase ON true
     LEFT JOIN holistic_mentorship_mentor_mentee_mappings mapping
       ON mapping.student_id = st.id
      AND mapping.academic_year = $2
      AND mapping.ended_at IS NULL
     LEFT JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
     WHERE st.status IS DISTINCT FROM 'dropout'
       AND gr.number IN (11, 12)
       AND roster_program.program_id = $3
       AND ($4 = '%%' OR st.student_id ILIKE $4 OR
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $4)
       AND ($5::int IS NULL OR gr.number = $5)
     ORDER BY gr.number, name NULLS LAST, st.student_id`,
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
