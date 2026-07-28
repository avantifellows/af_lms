import { PROGRAM_IDS } from "./constants";
import type {
  HistoricalImportDb,
  HistoricalImportWrite,
  HolisticRolloverCandidate,
  HolisticRolloverCounts,
  HolisticRolloverDb,
  ResolvedHistoricalStudent,
} from "./holistic-operations";
import { PM_SEAT_ROLES } from "./staff-shared";

type Database = Pick<typeof import("./db"), "query" | "withTransaction">;
type TransactionClient = Parameters<Parameters<Database["withTransaction"]>[0]>[0];

export function createHolisticOperationsDb(database: Database): {
  historicalImport: HistoricalImportDb;
  rollover: HolisticRolloverDb;
} {
  return {
    historicalImport: createHistoricalImportDb(database),
    rollover: createHolisticRolloverDb(database),
  };
}

function createHistoricalImportDb(database: Database): HistoricalImportDb {
  const { query, withTransaction } = database;
  return {
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
              roster.school_id IS NOT NULL AND student.status IS DISTINCT FROM 'dropout'
                AND NOT EXISTS (
                  SELECT 1 FROM holistic_mentorship_privacy_deletions deletion
                  WHERE deletion.student_id = student.id
                ) AS eligible
       FROM source
       JOIN student ON student.student_id = source.business_student_id
       JOIN "user" student_user ON student_user.id = student.user_id
       LEFT JOIN LATERAL (
         SELECT DISTINCT centre.school_id
         FROM centre_students roster_student
         JOIN centres centre ON centre.id = roster_student.centre_id
         WHERE roster_student.user_id = student_user.id
           AND roster_student.academic_year = $3
           AND roster_student.grade = 12
           AND roster_student.program_id = $4
       ) roster ON TRUE
       LEFT JOIN LATERAL (
         SELECT CASE WHEN COUNT(DISTINCT teacher.user_id) = 1
                     THEN MIN(teacher.user_id) END AS user_id
         FROM teacher
         JOIN centre_positions seat ON seat.user_id = teacher.user_id
           AND seat.deleted_at IS NULL AND NOT (seat.role = ANY($5::text[]))
         JOIN centres centre ON centre.id = seat.centre_id AND centre.is_active IS TRUE
           AND centre.school_id = roster.school_id AND centre.program_id = $4
         JOIN user_permission permission ON permission.revoked_at IS NULL
           AND permission.role = 'teacher'
           AND (permission.user_id = teacher.user_id OR LOWER(permission.email) = LOWER((
             SELECT email FROM "user" WHERE id = teacher.user_id
           )))
         WHERE LOWER(BTRIM(teacher.teacher_id)) = LOWER(BTRIM(source.source_mentor_id))
           AND teacher.is_af_teacher IS TRUE AND teacher.exit_date IS NULL
       ) mentor ON TRUE`,
        [
          source.map(({ businessStudentId }) => businessStudentId),
          source.map(({ sourceMentorId }) => sourceMentorId),
          "2026-2027",
          PROGRAM_IDS.COE,
          [...PM_SEAT_ROLES],
        ]
      ).then((rows): ResolvedHistoricalStudent[] => rows.map((row) => ({
        businessStudentId: row.business_student_id,
        studentId: Number(row.student_id),
        mentorUserId: row.mentor_user_id == null ? null : Number(row.mentor_user_id),
        eligible: row.eligible,
      })));
    },
    async existing(studentIds, sourceSystem) {
      if (!studentIds.length) return new Map<number, string>();
      const rows = await query<{ student_id: number | string; source_fingerprint: string }>(
        `SELECT student_id, source_fingerprint FROM holistic_mentorship_historical_notes
       WHERE student_id = ANY($1::bigint[]) AND source_system = $2`,
        [studentIds, sourceSystem]
      );
      return new Map(rows.map(({ student_id, source_fingerprint }) =>
        [Number(student_id), source_fingerprint]
      ));
    },
    async insert(records) {
      if (!records.length) return;
      await withTransaction(async (client) => {
        for (const record of records) await insertHistoricalRecord(client, record);
      });
    },
  };
}

async function insertHistoricalRecord(
  client: TransactionClient,
  record: HistoricalImportWrite
): Promise<void> {
  const inserted = await client.query<{ id: number | string }>(
    `INSERT INTO holistic_mentorship_historical_notes
       (student_id, mentor_user_id, source_system, source_record_key, source_fingerprint,
        imported_by_user_id, imported_at, reconciliation_metadata, inserted_at, updated_at)
     VALUES ($1, $2, 'approved_2025_holistic_export', $3, $4, $5, now(), $6::jsonb, now(), now())
     ON CONFLICT (student_id, source_system) DO NOTHING RETURNING id`,
    [record.studentId, record.mentorUserId, record.sourceRecordKey, record.sourceFingerprint,
      record.actorUserId, JSON.stringify({
        source_snapshot: record.sourceSnapshot,
        source_started_at: record.sourceStartedAt,
        source_ended_at: record.sourceEndedAt,
        source_timezone: record.sourceTimezone,
      })]
  );
  if (!inserted.rows[0]) {
    const existing = await client.query<{ source_fingerprint: string }>(
      `SELECT source_fingerprint
       FROM holistic_mentorship_historical_notes
       WHERE student_id = $1 AND source_system = 'approved_2025_holistic_export'
       FOR UPDATE`,
      [record.studentId]
    );
    if (existing.rows[0]?.source_fingerprint !== record.sourceFingerprint) {
      throw new Error("Historical Note source conflict");
    }
    return;
  }
  for (const question of record.questions) {
    await client.query(
      `INSERT INTO holistic_mentorship_historical_note_answers
         (historical_note_id, position, question, answer, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [inserted.rows[0].id, question.position, question.question, question.answer]
    );
  }
}

function createHolisticRolloverDb(database: Database): HolisticRolloverDb {
  const { query, withTransaction } = database;
  return {
    async candidates(fromAcademicYear, toAcademicYear) {
      return loadRolloverCandidates(
        (sql, params) => query<RolloverRow>(sql, params), fromAcademicYear, toAcademicYear
      );
    },
    async apply(fromAcademicYear, toAcademicYear, actorUserId) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await withTransaction(async (client) => {
            await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
            await client.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`holistic_mentorship_rollover:${fromAcademicYear}:${toAcademicYear}`]
            );
            const actor = await client.query(
              `SELECT id FROM "user" WHERE id = $1 FOR SHARE`,
              [actorUserId]
            );
            if (!actor.rows[0]) throw new Error("Rollover actor does not exist");
            const candidates = await loadRolloverCandidates(
              async (sql, params) => (await client.query<RolloverRow>(sql, params)).rows,
              fromAcademicYear,
              toAcademicYear
            );
            const counts = rolloverCounts(candidates);
            for (const candidate of candidates.filter(({ eligible, alreadyMapped }) =>
              eligible && !alreadyMapped)) {
              const inserted = await client.query<{ id: number | string }>(
                `INSERT INTO holistic_mentorship_mentor_mentee_mappings
                 (student_id, mentor_user_id, school_id, program_id, academic_year, started_at,
                  assigned_by_user_id, assignment_source, inserted_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, now(), $6, 'academic_year_rollover', now(), now())
               ON CONFLICT (student_id, academic_year) WHERE ended_at IS NULL DO NOTHING
               RETURNING id`,
                [candidate.studentId, candidate.mentorUserId, candidate.schoolId, PROGRAM_IDS.COE,
                  toAcademicYear, actorUserId]
              );
              if (!inserted.rows[0]) {
                counts.carried -= 1;
                counts.skipped += 1;
              }
            }
            return counts;
          });
        } catch (error) {
          if ((error as { code?: unknown } | null)?.code !== "40001" || attempt === 2) throw error;
        }
      }
    },
  };
}

type RolloverRow = {
  student_id: number | string;
  mentor_user_id: number | string;
  school_id: number | string;
  eligible: boolean;
  already_mapped: boolean;
};

async function loadRolloverCandidates(
  execute: (sql: string, params: unknown[]) => Promise<RolloverRow[]>,
  fromAcademicYear: string,
  toAcademicYear: string
): Promise<HolisticRolloverCandidate[]> {
  const rows = await execute(
    `SELECT mapping.student_id, mapping.mentor_user_id, mapping.school_id,
              EXISTS (
                SELECT 1
                FROM student
                JOIN "user" student_user ON student_user.id = student.user_id
                JOIN centre_students roster_student ON roster_student.user_id = student_user.id
                  AND roster_student.academic_year = $2
                  AND roster_student.program_id = $3
                  AND roster_student.grade IN (11, 12)
                JOIN centres roster_centre ON roster_centre.id = roster_student.centre_id
                  AND roster_centre.is_active IS TRUE
                  AND roster_centre.school_id = mapping.school_id
                  AND roster_centre.program_id = $3
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
                        AND next_mapping.academic_year = $2) AS already_mapped
       FROM holistic_mentorship_mentor_mentee_mappings mapping
       WHERE mapping.academic_year = $1 AND mapping.program_id = $3
         AND mapping.ended_at IS NULL
       ORDER BY mapping.student_id`,
    [fromAcademicYear, toAcademicYear, PROGRAM_IDS.COE, [...PM_SEAT_ROLES]]
  );
  return rows.map((row): HolisticRolloverCandidate => ({
    studentId: Number(row.student_id), mentorUserId: Number(row.mentor_user_id),
    schoolId: Number(row.school_id), eligible: row.eligible, alreadyMapped: row.already_mapped,
  }));
}

function rolloverCounts(candidates: HolisticRolloverCandidate[]): HolisticRolloverCounts {
  return {
    carried: candidates.filter(({ eligible, alreadyMapped }) => eligible && !alreadyMapped).length,
    skipped: candidates.filter(({ alreadyMapped }) => alreadyMapped).length,
    ineligible: candidates.filter(({ eligible, alreadyMapped }) => !eligible && !alreadyMapped).length,
  };
}
