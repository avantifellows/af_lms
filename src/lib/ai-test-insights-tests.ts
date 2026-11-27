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
// only mean the picker's values.
interface TestRow {
  picker_test_id: unknown;
  picker_test_name: string | null;
  picker_test_format: string | null;
  picker_test_date: unknown;
}

const FORMATS: readonly string[] = AI_TEST_INSIGHTS_TEST_FORMATS;

/** A BigQuery date comes as a string or as `{ value }`; the picker wants `YYYY-MM-DD`. */
function dateOf(value: unknown): string {
  const text = typeof value === "string" ? value : ((value as { value?: unknown } | null)?.value ?? "");
  return String(text).slice(0, 10);
}

/** Newest first; tests of the same day by `test_id`, descending (as the read orders them). */
function newestFirst(a: AiTestInsightsTest, b: AiTestInsightsTest): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
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

  // One row per test even if a row repeats: the newest sitting wins.
  const byId = new Map<string, AiTestInsightsTest>();
  for (const row of rows as TestRow[]) {
    const id = row.picker_test_id;
    if (id === null || id === undefined || id === "") continue;
    if (!FORMATS.includes(row.picker_test_format ?? "")) continue;
    const test: AiTestInsightsTest = {
      id: String(id),
      name: row.picker_test_name ?? "",
      date: dateOf(row.picker_test_date),
      format: row.picker_test_format as AiTestInsightsTestFormat,
    };
    const seen = byId.get(test.id);
    if (!seen || test.date > seen.date) byId.set(test.id, test);
  }
  return [...byId.values()].sort(newestFirst);
}
