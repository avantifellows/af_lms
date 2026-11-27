// AI Test Insights (#550): how much attention each Student has had. The one
// read the AI Test Insights Tab and the Student page both use, so the two can
// never disagree. Server-only (uses `@/lib/db`).
import { query } from "@/lib/db";
import type { AiTestInsightsCounts } from "@/lib/ai-test-insights-shared";

const NO_INSIGHTS: AiTestInsightsCounts = {
  insightSessionsCompleted: 0,
  testInsightsGenerated: 0,
  lastInsightSessionDate: null,
};

/**
 * For each Student id, across all academic years:
 *
 * - `insightSessionsCompleted`: the Student's `submitted` Insight Sessions;
 * - `lastInsightSessionDate`: the newest `session_date` among them
 *   (`YYYY-MM-DD`), or null;
 * - `testInsightsGenerated`: the Student's `completed` Insight Requests.
 *
 * Draft sessions and requests in any other state are not counted. A Student
 * with no rows gets 0, 0 and null. A failed read throws; callers never turn a
 * failure into zeros.
 */
export async function readAiTestInsightsCounts(studentIds: number[]): Promise<Map<number, AiTestInsightsCounts>> {
  const counts = new Map<number, AiTestInsightsCounts>(studentIds.map((id) => [id, { ...NO_INSIGHTS }]));
  if (studentIds.length === 0) return counts;

  const [sessions, requests] = await Promise.all([
    query<{ student_id: string | number; sessions_completed: string | number; last_session_date: string | null }>(
      `SELECT student_id,
              COUNT(*)::int AS sessions_completed,
              TO_CHAR(MAX(session_date), 'YYYY-MM-DD') AS last_session_date
       FROM ai_test_insight_sessions
       WHERE student_id = ANY($1::bigint[])
         AND state = 'submitted'
       GROUP BY student_id`,
      [studentIds],
    ),
    query<{ student_id: string | number; tests_generated: string | number }>(
      `SELECT student_id, COUNT(*)::int AS tests_generated
       FROM ai_test_insight_requests
       WHERE student_id = ANY($1::bigint[])
         AND state = 'completed'
       GROUP BY student_id`,
      [studentIds],
    ),
  ]);

  for (const row of sessions) {
    const entry = counts.get(Number(row.student_id));
    if (!entry) continue;
    entry.insightSessionsCompleted = Number(row.sessions_completed);
    entry.lastInsightSessionDate = row.last_session_date;
  }
  for (const row of requests) {
    const entry = counts.get(Number(row.student_id));
    if (entry) entry.testInsightsGenerated = Number(row.tests_generated);
  }
  return counts;
}
