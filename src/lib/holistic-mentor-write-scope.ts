import type { PoolClient } from "pg";

export type HolisticMentorWriteScopeInput = {
  studentId: number;
  phaseId: number;
  schoolId: number;
  programId: number;
  academicYear: string;
};

export type HolisticMentorWriteScope = {
  mapping_id: number | string;
  mentor_user_id: number | string;
  phase_revision: number;
  phase_state: "locked" | "open";
};

export type HolisticMentorWriteScopeError = { ok: false; status: 404 | 422; error: string };

function priorAcademicYearOf(academicYear: string): string {
  const academicYearStart = Number(academicYear.slice(0, 4));
  return `${academicYearStart - 1}-${academicYearStart}`;
}

export async function loadHolisticMentorWriteScope(
  client: PoolClient,
  input: HolisticMentorWriteScopeInput
): Promise<HolisticMentorWriteScope | null> {
  const scope = await client.query<HolisticMentorWriteScope>(
      `SELECT mapping.id AS mapping_id, mapping.mentor_user_id,
              phase.revision AS phase_revision, phase.state AS phase_state
       FROM holistic_mentorship_mentor_mentee_mappings mapping
       JOIN student st ON st.id = mapping.student_id AND st.status IS DISTINCT FROM 'dropout'
       JOIN "user" student_user ON student_user.id = st.user_id
       JOIN LATERAL (
         SELECT MIN(roster_student.grade) AS grade
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
         HAVING COUNT(DISTINCT roster_student.grade) = 1
       ) current_roster ON true
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
         AND NOT EXISTS (
           SELECT 1 FROM holistic_mentorship_privacy_deletions deletion
           WHERE deletion.student_id = mapping.student_id
         )
         AND (
           (plan.academic_year = $5 AND phase_grade.number = current_roster.grade)
           OR (plan.academic_year = $6 AND current_roster.grade = 12
             AND phase_grade.number = 11 AND prior_history.has_prior_mapping IS TRUE
             AND COALESCE(journey.entry_grade, 11) = 11)
         )
       FOR UPDATE OF mapping, phase`,
      [input.phaseId, input.studentId, input.schoolId, input.programId,
        input.academicYear, priorAcademicYearOf(input.academicYear)]
  );
  return scope.rows[0] ?? null;
}

export function checkHolisticMentorWriteScope(
  scope: HolisticMentorWriteScope | null,
  actorUserId: number
): HolisticMentorWriteScopeError | null {
  if (!scope || Number(scope.mentor_user_id) !== actorUserId) {
    return { ok: false, status: 404, error: "Not found" };
  }
  return scope.phase_state === "open"
    ? null
    : { ok: false, status: 422, error: "Phase is not Open" };
}
