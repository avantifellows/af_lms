// AI Test Insights (#550): the Student card on the Student page. Server-only
// (uses `@/lib/db`). Callers pass a context from Student access, so the
// Student is already listed and in the user's scope.
import { query } from "@/lib/db";
import type { AiTestInsightsStudentContext } from "@/lib/ai-test-insights-access";
import { readAiTestInsightsCounts } from "@/lib/ai-test-insights-counts";
import type { AiTestInsightsStudentCardData } from "@/lib/ai-test-insights-shared";

/**
 * Who the Student is: name, Student ID, gender, category and stream as
 * recorded (blank reads as missing), the names of their current batches in
 * the Program of the centre that lists them, the Grade from the context, and
 * their Insight Sessions from the same read the AI Test Insights Tab uses.
 * Null when the Student no longer exists. A failed read throws.
 */
export async function readAiTestInsightsStudentCard(
  student: AiTestInsightsStudentContext,
): Promise<AiTestInsightsStudentCardData | null> {
  const rows = await query<{
    name: string;
    student_code: string | null;
    gender: string | null;
    category: string | null;
    stream: string | null;
    batches: string[] | null;
  }>(
    `SELECT BTRIM(CONCAT_WS(' ', BTRIM(u.first_name), BTRIM(u.last_name))) AS name,
            NULLIF(BTRIM(s.student_id), '') AS student_code,
            NULLIF(BTRIM(u.gender), '') AS gender,
            NULLIF(BTRIM(s.category), '') AS category,
            NULLIF(BTRIM(s.stream), '') AS stream,
            ARRAY(
              SELECT DISTINCT b.name
              FROM enrollment_record er
              JOIN batch b ON b.id = er.group_id
              WHERE er.user_id = s.user_id
                AND er.group_type = 'batch'
                AND er.is_current IS TRUE
                AND b.program_id = $2
                AND NULLIF(BTRIM(b.name), '') IS NOT NULL
              ORDER BY b.name
            ) AS batches
     FROM student s
     JOIN "user" u ON u.id = s.user_id
     WHERE s.id = $1`,
    [student.studentId, student.programId],
  );
  const row = rows[0];
  if (!row) return null;

  const counts = (await readAiTestInsightsCounts([student.studentId])).get(student.studentId)!;
  return {
    name: row.name,
    studentCode: row.student_code,
    grade: student.grade,
    batches: row.batches ?? [],
    gender: row.gender,
    category: row.category,
    stream: row.stream,
    insightSessionsCompleted: counts.insightSessionsCompleted,
    lastInsightSessionDate: counts.lastInsightSessionDate,
  };
}
