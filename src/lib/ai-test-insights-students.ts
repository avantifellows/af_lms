// AI Test Insights (#550): which Students the feature is for, and the list the
// AI Test Insights Tab shows. Server-only (uses `@/lib/db`).
import { query } from "@/lib/db";
import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "@/lib/constants";
import { ENGINEERING_STREAM_VALUES } from "@/lib/student-support-rules";
import type { AiTestInsightsStudent } from "@/lib/ai-test-insights-shared";

/**
 * The listed-Student rule, the one place it is written. A subquery of
 * `(student_id, user_id, centre_id, program_id, grade)` rows, one per Student
 * and centre that lists them:
 *
 * - not a dropout (`student.status`),
 * - in Grade 11 or 12 this academic year,
 * - on the roster (`centre_students`) of an active centre of a physical-centre
 *   Program (every Program except JNV NVS),
 * - with `student.stream` meaning engineering: the exam-stream normaliser's
 *   engineering values, any case. A blank stream is not listed (no "blank
 *   means engineering" default here).
 *
 * Placeholders start at `$${firstParam}`; append `params` to the caller's own
 * after its first `firstParam - 1` values. A Student on two centres' rosters
 * gives two rows; callers that list Students group by `student_id`.
 */
export function listedStudentRowsSql(firstParam: number): { sql: string; params: unknown[] } {
  const year = `$${firstParam}`;
  const nvsProgram = `$${firstParam + 1}`;
  const engineeringStreams = `$${firstParam + 2}`;
  return {
    sql: `SELECT DISTINCT
             listed_student.id AS student_id,
             listed_student.user_id,
             roster.centre_id,
             roster.program_id,
             roster.grade
           FROM centre_students roster
           JOIN centres roster_centre
             ON roster_centre.id = roster.centre_id
            AND roster_centre.is_active IS TRUE
           JOIN student listed_student ON listed_student.user_id = roster.user_id
           WHERE roster.academic_year = ${year}
             AND roster.grade IN (11, 12)
             AND roster.program_id IS NOT NULL
             AND roster.program_id <> ${nvsProgram}
             AND listed_student.status IS DISTINCT FROM 'dropout'
             AND LOWER(BTRIM(listed_student.stream)) = ANY(${engineeringStreams}::text[])`,
    params: [CURRENT_ACADEMIC_YEAR, PROGRAM_IDS.NVS, [...ENGINEERING_STREAM_VALUES]],
  };
}

/**
 * The listed Students of these centres, one row per Student (a Student on two
 * centres' rosters appears once), ordered by Grade, then name. Callers pass
 * only centres the access module allowed.
 */
export async function listAiTestInsightsStudents(centreIds: number[]): Promise<AiTestInsightsStudent[]> {
  if (centreIds.length === 0) return [];
  const listed = listedStudentRowsSql(2);
  const rows = await query<{
    student_id: string | number;
    name: string;
    student_code: string | null;
    grade: number | string;
  }>(
    `WITH listed AS (${listed.sql})
     SELECT s.id AS student_id,
            BTRIM(CONCAT_WS(' ', BTRIM(u.first_name), BTRIM(u.last_name))) AS name,
            NULLIF(BTRIM(s.student_id), '') AS student_code,
            MIN(listed.grade) AS grade
     FROM listed
     JOIN student s ON s.id = listed.student_id
     JOIN "user" u ON u.id = s.user_id
     WHERE listed.centre_id = ANY($1::bigint[])
     GROUP BY s.id, u.first_name, u.last_name, s.student_id
     ORDER BY grade, name, student_id`,
    [centreIds, ...listed.params],
  );
  return rows.map((row) => ({
    studentId: Number(row.student_id),
    name: row.name,
    studentCode: row.student_code,
    grade: Number(row.grade) as 11 | 12,
  }));
}
