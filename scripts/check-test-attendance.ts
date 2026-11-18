/**
 * Test Attendance tab: pre-launch data check (#531, parent #517). READ-ONLY.
 *
 * For every closed Monthly Test, across all NVS (JNV) Schools, compares the
 * Students the tab's rules call Submitted with the Students who have a
 * submitted result (`has_quiz_ended = TRUE`) for one of that Monthly Test's
 * Papers in `fact_student_test_results_overall`, and prints both difference
 * lists with their counts. It also reports listed Students with an
 * unrecognised Exam Preparing For value or no joining date, and whether every
 * quiz id in the PMU test set list has a `session` row with a grade and both
 * times. Reading this output is part of the release gate in #517.
 *
 * The tab's side comes from the tab's own loader (`loadTestAttendance`) and
 * rules module; the comparison lives in `src/lib/test-attendance-check.ts`.
 *
 * Read-only: Postgres runs with `default_transaction_read_only=on`; BigQuery
 * and Firestore are only queried. No DB Service endpoint is called. Students
 * appear by LMS user id only, and the output goes to this terminal only. Don't
 * paste it anywhere public; the PR gets counts and explanations.
 *
 * Needs:
 *   - DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD,
 *     DATABASE_NAME (and DATABASE_SSL=false for a local database): the
 *     production LMS database, read access.
 *   - GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS): the LMS
 *     service account, which reads the warehouse (`production_dbt_final`) and
 *     the PMU test set list in Firestore.
 * They are read from --env-path (default `.env.production`); variables already
 * set in the shell win over the file.
 *
 * Usage:
 *   npm run test-attendance:check
 *   npm run test-attendance:check -- --env-path=.env.local
 *
 * Exits 1 when any source cannot be read (a failed run is never "no
 * differences"), printing only the error message.
 */
import * as dotenv from "dotenv";

import type { CheckSources, SubmittedResult } from "../src/lib/test-attendance-check";

function envFile(args: string[]): string {
  const flag = args.find((arg) => arg.startsWith("--env-path="));
  return flag ? flag.slice("--env-path=".length) : ".env.production";
}

const RESULTS_TABLE = "`avantifellows.production_dbt_final.fact_student_test_results_overall`";

async function main(): Promise<void> {
  dotenv.config({ path: envFile(process.argv.slice(2)), quiet: true });
  // Every Postgres session the pool opens is read-only: a write would fail.
  process.env.PGOPTIONS = [process.env.PGOPTIONS, "-c default_transaction_read_only=on"]
    .filter(Boolean)
    .join(" ");

  // Imported after the environment is set: the pool reads it on import.
  const [db, { getBigQueryClient }, check, rules, roster, loader, papers, list] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/bigquery"),
    import("../src/lib/test-attendance-check"),
    import("../src/lib/test-attendance-rules"),
    import("../src/lib/school-students"),
    import("../src/lib/test-attendance"),
    import("../src/lib/test-attendance-papers"),
    import("../src/lib/test-set-list"),
  ]);

  const sources: CheckSources = {
    nvsSchools: async () =>
      db.query<{ id: string; code: string }>(
        `SELECT id::text AS id, code FROM school WHERE af_school_category = $1 ORDER BY id`,
        ["JNV"],
      ),
    testSets: () => list.getNvsTestSets(),
    paperWindows: (quizIds) => papers.readPaperWindows(quizIds),
    schoolAttendance: (schoolId, now) => loader.loadTestAttendance(schoolId, now),
    schoolListing: async (schoolId) => {
      const { students } = await roster.getSchoolRoster(schoolId);
      const listed = students.filter(rules.isTestAttendanceStudent);
      const joinedOn = await loader.readNvsJoiningDates(listed.map((student) => String(student.user_id)));
      return listed.map((student) => ({
        userId: String(student.user_id),
        rawExamPreparingFor: student.stream ?? null,
        hasJoiningDate: joinedOn.has(String(student.user_id)),
      }));
    },
    submittedResults: async (quizIds) => {
      if (quizIds.length === 0) return [];
      const [rows] = await getBigQueryClient().query({
        query: `
          SELECT DISTINCT CAST(enrollment_user_id AS STRING) AS user_id,
                 CAST(test_id AS STRING) AS quiz_id
            FROM ${RESULTS_TABLE}
           WHERE CAST(test_id AS STRING) IN UNNEST(@quizIds)
             AND has_quiz_ended = TRUE
             AND enrollment_user_id IS NOT NULL
        `,
        params: { quizIds },
        types: { quizIds: ["STRING"] },
      });
      return (rows as Array<{ user_id: string; quiz_id: string }>).map(
        (row): SubmittedResult => ({ userId: String(row.user_id), quizId: String(row.quiz_id) }),
      );
    },
  };

  try {
    const report = await check.runTestAttendanceCheck(sources, new Date());
    process.stdout.write(check.formatCheckReport(report));
  } finally {
    await db.default.end();
  }
}

main().catch((error: unknown) => {
  // Message only: never Student names or ids.
  console.error(`Test Attendance check FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  console.error("A source could not be read. This is not a clean result.");
  process.exit(1);
});
