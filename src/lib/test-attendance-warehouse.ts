// Attendance read for the Test Attendance tab (#517): who opened and who
// submitted each Paper, from the warehouse table `fact_student_test_attendance`.
// Server-only (BigQuery). Parameterised; never interpolate ids into the SQL.
//
// The table keys Students on `enrollment_user_id` (the LMS user id). Its type
// isn't pinned (INT64 in the dbt catalog today), so both sides are cast to
// STRING and a type change can't silently drop matches. `has_submitted` comes
// from etl-next#238; an empty value is passed on as null (not submitted).
//
// "Last refreshed" is when the table was last rebuilt, from the dataset's
// table metadata (as PMU Live Tracking reads it), not when the LMS fetched it.
// Both reads are cached per School for 60 seconds, so the Refresh button and
// several viewers don't multiply warehouse queries.

import { getBigQueryClient } from "@/lib/bigquery";
import type { PaperAttendance } from "@/lib/test-attendance-rules";
import { ttlCache } from "@/lib/ttl-cache";

const ATTENDANCE_TABLE = "`avantifellows.production_dbt_final.fact_student_test_attendance`";
const ATTENDANCE_TABLE_METADATA = "`avantifellows.production_dbt_final.__TABLES__`";

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
async function readPaperAttendance(quizIds: string[], userIds: string[]): Promise<PaperAttendance[]> {
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

/** When the attendance table was last rebuilt (UTC ISO), or null when the metadata has no usable row. Throws when the read fails. */
async function readLastRefreshed(): Promise<string | null> {
  const [rows] = await getBigQueryClient().query({
    query: `
      SELECT FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', TIMESTAMP_MILLIS(last_modified_time), 'UTC') AS last_refreshed
        FROM ${ATTENDANCE_TABLE_METADATA}
       WHERE table_id = @tableId
    `,
    params: { tableId: "fact_student_test_attendance" },
  });
  const value = (rows as { last_refreshed?: unknown }[])[0]?.last_refreshed;
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export interface SchoolAttendance {
  attendance: PaperAttendance[];
  /** When the attendance table was last rebuilt (UTC ISO); null when unknown. */
  lastRefreshed: string | null;
}

const cached = ttlCache<SchoolAttendance>(60 * 1000);

/**
 * One School's attendance and the table's last-refreshed time, cached per
 * School for 60 seconds. A failed attendance read throws (and is not kept); a
 * failed last-refreshed lookup is tolerated as an unknown time.
 */
export function readSchoolAttendance(
  schoolId: string | number,
  quizIds: string[],
  userIds: string[],
): Promise<SchoolAttendance> {
  return cached(String(schoolId), async () => {
    const [attendance, lastRefreshed] = await Promise.all([
      readPaperAttendance(quizIds, userIds),
      readLastRefreshed().catch((error: unknown) => {
        console.error(
          "Test Attendance last-refreshed lookup failed:",
          error instanceof Error ? error.message : "unknown error",
        );
        return null;
      }),
    ]);
    return { attendance, lastRefreshed };
  });
}
