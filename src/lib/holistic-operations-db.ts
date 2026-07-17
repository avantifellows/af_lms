import { PROGRAM_IDS } from "./constants";
import { query, withTransaction } from "./db";
import type {
  HistoricalImportDb,
  HistoricalImportWrite,
  HolisticRolloverCandidate,
  HolisticRolloverDb,
  ResolvedHistoricalStudent,
} from "./holistic-operations";
import { PM_SEAT_ROLES } from "./staff-shared";

export const historicalImportDb: HistoricalImportDb = {
  async resolve(source) {
    if (!source.length) return [];
    return query<{
      business_student_id: string;
      student_id: number | string;
      mentor_user_id: number | string | null;
      eligible: boolean;
    }>(
      `WITH source(business_student_id, source_mentor_id) AS (
         SELECT * FROM unnest($1::text[], $2::text[])
       )
       SELECT source.business_student_id, student.id AS student_id,
              mentor.user_id AS mentor_user_id,
              roster.school_id IS NOT NULL AND student.status IS DISTINCT FROM 'dropout' AS eligible
       FROM source
       JOIN student ON student.student_id = source.business_student_id
       JOIN "user" student_user ON student_user.id = student.user_id
       LEFT JOIN LATERAL (
         SELECT school_group.child_id AS school_id
         FROM group_user school_membership
         JOIN "group" school_group ON school_group.id = school_membership.group_id
           AND school_group.type = 'school'
         JOIN school ON school.id = school_group.child_id
           AND $4 = ANY(COALESCE(school.program_ids, '{}'))
         JOIN enrollment_record grade_enrollment ON grade_enrollment.user_id = student_user.id
           AND grade_enrollment.group_type = 'grade' AND grade_enrollment.academic_year = $3
           AND grade_enrollment.is_current IS TRUE
         JOIN grade ON grade.id = grade_enrollment.group_id AND grade.number = 12
         JOIN enrollment_record batch_enrollment ON batch_enrollment.user_id = student_user.id
           AND batch_enrollment.group_type = 'batch' AND batch_enrollment.is_current IS TRUE
         JOIN "group" batch_group ON batch_group.id = batch_enrollment.group_id AND batch_group.type = 'batch'
         JOIN batch ON batch.id = batch_group.child_id AND batch.program_id = $4
         WHERE school_membership.user_id = student_user.id
       ) roster ON TRUE
       LEFT JOIN LATERAL (
         SELECT CASE WHEN COUNT(*) = 1 THEN MIN(teacher.user_id) END AS user_id
         FROM teacher WHERE teacher.teacher_id = source.source_mentor_id
           AND teacher.is_af_teacher IS TRUE
       ) mentor ON TRUE`,
      [
        source.map(({ businessStudentId }) => businessStudentId),
        source.map(({ sourceMentorId }) => sourceMentorId),
        "2026-2027",
        PROGRAM_IDS.COE,
      ]
    ).then((rows): ResolvedHistoricalStudent[] => rows.map((row) => ({
      businessStudentId: row.business_student_id,
      studentId: Number(row.student_id),
      mentorUserId: row.mentor_user_id == null ? null : Number(row.mentor_user_id),
      eligible: row.eligible,
    })));
  },
  async existing(studentIds, sourceSystem) {
    if (!studentIds.length) return new Set<number>();
    const rows = await query<{ student_id: number | string }>(
      `SELECT student_id FROM holistic_mentorship_historical_notes
       WHERE student_id = ANY($1::bigint[]) AND source_system = $2`,
      [studentIds, sourceSystem]
    );
    return new Set(rows.map(({ student_id }) => Number(student_id)));
  },
  async insert(records) {
    if (!records.length) return;
    await withTransaction(async (client) => {
      for (const record of records) await insertHistoricalRecord(client, record);
    });
  },
};

async function insertHistoricalRecord(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  record: HistoricalImportWrite
): Promise<void> {
  const inserted = await client.query<{ id: number | string }>(
    `INSERT INTO holistic_mentorship_historical_notes
       (student_id, mentor_user_id, source_system, source_record_key, source_fingerprint,
        imported_by_user_id, imported_at, reconciliation_metadata, inserted_at, updated_at)
     VALUES ($1, $2, 'approved_2025_holistic_export', $3, $4, $5, now(), $6::jsonb, now(), now())
     ON CONFLICT (student_id, source_system) DO NOTHING RETURNING id`,
    [record.studentId, record.mentorUserId, record.sourceRecordKey, record.sourceFingerprint,
      record.actorUserId, JSON.stringify({ source_snapshot: record.sourceSnapshot })]
  );
  if (!inserted.rows[0]) return;
  for (const question of record.questions) {
    await client.query(
      `INSERT INTO holistic_mentorship_historical_note_answers
         (historical_note_id, position, question, answer, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [inserted.rows[0].id, question.position, question.question, question.answer]
    );
  }
}

export const holisticRolloverDb: HolisticRolloverDb = {
  async candidates(fromAcademicYear, toAcademicYear) {
    const rows = await query<{
      student_id: number | string;
      mentor_user_id: number | string;
      school_id: number | string;
      eligible: boolean;
      already_mapped: boolean;
    }>(
      `SELECT mapping.student_id, mapping.mentor_user_id, mapping.school_id,
              EXISTS (
                SELECT 1
                FROM student
                JOIN "user" student_user ON student_user.id = student.user_id
                JOIN group_user school_membership ON school_membership.user_id = student_user.id
                JOIN "group" school_group ON school_group.id = school_membership.group_id
                  AND school_group.type = 'school' AND school_group.child_id = mapping.school_id
                JOIN enrollment_record grade_enrollment ON grade_enrollment.user_id = student_user.id
                  AND grade_enrollment.group_type = 'grade' AND grade_enrollment.academic_year = $2
                  AND grade_enrollment.is_current IS TRUE
                JOIN grade ON grade.id = grade_enrollment.group_id AND grade.number IN (11, 12)
                JOIN enrollment_record batch_enrollment ON batch_enrollment.user_id = student_user.id
                  AND batch_enrollment.group_type = 'batch' AND batch_enrollment.is_current IS TRUE
                JOIN "group" batch_group ON batch_group.id = batch_enrollment.group_id AND batch_group.type = 'batch'
                JOIN batch ON batch.id = batch_group.child_id AND batch.program_id = $3
                JOIN teacher mentor_teacher ON mentor_teacher.user_id = mapping.mentor_user_id
                  AND mentor_teacher.is_af_teacher IS TRUE AND mentor_teacher.exit_date IS NULL
                JOIN centre_positions seat ON seat.user_id = mapping.mentor_user_id
                  AND seat.deleted_at IS NULL AND NOT (seat.role = ANY($4::text[]))
                JOIN centres centre ON centre.id = seat.centre_id AND centre.is_active IS TRUE
                  AND centre.school_id = mapping.school_id AND centre.program_id = $3
                JOIN user_permission permission ON permission.revoked_at IS NULL AND permission.role = 'teacher'
                  AND (permission.user_id = mapping.mentor_user_id OR LOWER(permission.email) = LOWER((SELECT email FROM "user" WHERE id = mapping.mentor_user_id)))
                WHERE student.id = mapping.student_id AND student.status IS DISTINCT FROM 'dropout'
              ) AS eligible,
              EXISTS (SELECT 1 FROM holistic_mentorship_mentor_mentee_mappings next_mapping
                      WHERE next_mapping.student_id = mapping.student_id
                        AND next_mapping.academic_year = $2 AND next_mapping.ended_at IS NULL) AS already_mapped
       FROM holistic_mentorship_mentor_mentee_mappings mapping
       WHERE mapping.academic_year = $1 AND mapping.ended_at IS NULL
       ORDER BY mapping.student_id`,
      [fromAcademicYear, toAcademicYear, PROGRAM_IDS.COE, [...PM_SEAT_ROLES]]
    );
    return rows.map((row): HolisticRolloverCandidate => ({
      studentId: Number(row.student_id), mentorUserId: Number(row.mentor_user_id),
      schoolId: Number(row.school_id), eligible: row.eligible, alreadyMapped: row.already_mapped,
    }));
  },
  async insert(candidates, params) {
    if (!candidates.length) return;
    await withTransaction(async (client) => {
      for (const candidate of candidates) {
        await client.query(
          `INSERT INTO holistic_mentorship_mentor_mentee_mappings
             (student_id, mentor_user_id, school_id, program_id, academic_year, started_at,
              assigned_by_user_id, assignment_source, inserted_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now(), $6, 'academic_year_rollover', now(), now())
           ON CONFLICT (student_id, academic_year) WHERE ended_at IS NULL DO NOTHING`,
          [candidate.studentId, candidate.mentorUserId, candidate.schoolId, PROGRAM_IDS.COE,
            params.academicYear, params.actorUserId]
        );
      }
    });
  },
};
