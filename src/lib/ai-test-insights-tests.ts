// AI Test Insights (#550): the tests an AI Summary can cover, for the AI
// Summary card's test picker. Server-only (BigQuery). Callers pass the `user.id`
// from a Student access context, so the Student is already in the user's
// scope. Parameterised; never interpolate the Student or the year into the
// SQL. No cache: a test the Student has just submitted shows on the next load.
import { FACT_TABLE, SUBMITTED_ONLY, getBigQueryClient } from "@/lib/bigquery";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import {
  AI_TEST_INSIGHTS_TEST_FORMATS,
  type AiTestInsightsTest,
  type AiTestInsightsTestFormat,
} from "@/lib/ai-test-insights-shared";
import { academicYearStart } from "@/lib/student-support-rules";

// Aliases unlike the table's own column names, so GROUP BY and ORDER BY can
// only mean the picker's values. The read casts the id and the date to
// strings, so each row is already the picker's shape.
interface TestRow {
  picker_test_id: string;
  picker_test_name: string | null;
  picker_test_format: AiTestInsightsTestFormat;
  picker_test_date: string;
}

/**
 * The Student's submitted Major, Full Syllabus and Mock tests of the current
 * academic year, newest first, one row per test. From
 * `fact_student_test_results_overall`, keyed by `enrollment_user_id` (the
 * Student's `user.id`): the `overall` section, this academic year and no
 * earlier than its 1 April, and submitted by the warehouse rule
 * (`has_quiz_ended IS NOT FALSE`, so an unknown end counts as submitted). A
 * test's date is the Student's newest sitting of it; tests with no `test_id`
 * are dropped. Throws when the warehouse can't be read.
 */
export async function readAiTestInsightsTests(userId: number): Promise<AiTestInsightsTest[]> {
  const [rows] = await getBigQueryClient().query({
    query: `
      SELECT CAST(test_id AS STRING) AS picker_test_id,
             ANY_VALUE(test_name) AS picker_test_name,
             ANY_VALUE(test_format) AS picker_test_format,
             CAST(MAX(SAFE_CAST(start_date AS DATE)) AS STRING) AS picker_test_date
        FROM ${FACT_TABLE}
       WHERE enrollment_user_id = @userId
         AND section = 'overall'
         AND test_format IN UNNEST(@formats)
         AND academic_year = @academicYear
         AND SAFE_CAST(start_date AS DATE) >= SAFE_CAST(@yearStart AS DATE)
         AND test_id IS NOT NULL
         ${SUBMITTED_ONLY}
       GROUP BY picker_test_id
       ORDER BY picker_test_date DESC, picker_test_id DESC
    `,
    params: {
      userId,
      formats: [...AI_TEST_INSIGHTS_TEST_FORMATS],
      academicYear: CURRENT_ACADEMIC_YEAR,
      yearStart: academicYearStart(CURRENT_ACADEMIC_YEAR),
    },
    types: { formats: ["STRING"] },
  });

  // The read already gives one row per test (GROUP BY), only the three
  // formats, no missing id, newest first, ids and dates as strings.
  return (rows as TestRow[]).map((row) => ({
    id: row.picker_test_id,
    name: row.picker_test_name ?? "",
    date: row.picker_test_date,
    format: row.picker_test_format,
  }));
}
