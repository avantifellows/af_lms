// Attendance read for the Test Attendance tab (#517): who opened and who
// submitted each Paper, from the warehouse table `fact_student_test_attendance`.
// Server-only (BigQuery). Parameterised; never interpolate ids into the SQL.
//
// The table keys Students on `enrollment_user_id` (the LMS user id). Its type
// isn't pinned (INT64 in the dbt catalog today), so both sides are cast to
// STRING and a type change can't silently drop matches. `has_submitted` comes
// from etl-next#238; an empty value is passed on as null (not submitted).

import { getBigQueryClient } from "@/lib/bigquery";
import type { PaperAttendance } from "@/lib/test-attendance-rules";

const ATTENDANCE_TABLE = "`avantifellows.production_dbt_final.fact_student_test_attendance`";

interface AttendanceRow {
  user_id: string;
  quiz_id: string;
  submitted: boolean | null;
}

/**
 * One row per Student and quiz the Student opened (`attendance_status =
 * 'Present'`), with `submitted` true when any of its rows has `has_submitted`
 * true. Throws when the warehouse can't be read.
 */
export async function readPaperAttendance(quizIds: string[], userIds: string[]): Promise<PaperAttendance[]> {
  if (quizIds.length === 0 || userIds.length === 0) return [];
  const [rows] = await getBigQueryClient().query({
    query: `
      SELECT CAST(enrollment_user_id AS STRING) AS user_id,
             CAST(quiz_id AS STRING) AS quiz_id,
             LOGICAL_OR(has_submitted) AS submitted
        FROM ${ATTENDANCE_TABLE}
       WHERE attendance_status = 'Present'
         AND CAST(enrollment_user_id AS STRING) IN UNNEST(@userIds)
         AND CAST(quiz_id AS STRING) IN UNNEST(@quizIds)
       GROUP BY user_id, quiz_id
    `,
    params: { quizIds, userIds },
    types: { quizIds: ["STRING"], userIds: ["STRING"] },
  });
  return (rows as AttendanceRow[]).map((row) => ({
    userId: String(row.user_id),
    quizId: String(row.quiz_id),
    submitted: row.submitted ?? null,
  }));
}
