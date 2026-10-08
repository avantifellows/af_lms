import { NextResponse } from "next/server";

import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { getRespondersByQuiz, getTeacherFeedbackSummaries } from "@/lib/teacher-feedback-bq";
import { getRoundRoster, loadAuthorizedRound } from "@/lib/teacher-feedback-rounds";

// GET /api/teacher-feedback/cycles/:setupRunId/responses
// Per teacher: how many of the round's students responded, and who hasn't yet
// (to chase them). Never says what anyone answered.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ setupRunId: string }> }
) {
  const access = await authenticateTeacherFeedback("view");
  if (!access.ok) return access.response;

  const { setupRunId } = await params;
  const round = await loadAuthorizedRound(setupRunId, access.permission);
  if (!round.ok) return round.response;

  try {
    const roster = await getRoundRoster(round.rows[0].batch_class_ids ?? []);
    const quizIds = round.rows.map((r) => r.quiz_id).filter((id): id is string => !!id);
    const [responders, scores] = await Promise.all([
      getRespondersByQuiz(quizIds),
      getTeacherFeedbackSummaries(quizIds),
    ]);

    const rosterIds = new Set(roster.map((s) => s.user_id));
    const teachers = round.rows.map((row) => {
      const answered = (row.quiz_id && responders.get(row.quiz_id)) || new Set<string>();
      const pending = roster.filter((s) => !answered.has(s.user_id));
      return {
        teacherName: row.teacher_name,
        teacherOrder: row.teacher_order,
        responded: roster.length - pending.length,
        total: roster.length,
        // Answered but not in the round's batches today: dropouts, students who
        // moved batch, or a class handed a link meant for another batch. Analysis
        // still counts them, so say so rather than let the numbers disagree.
        outsideBatches: [...answered].filter((id) => !rosterIds.has(id)).length,
        responseCount: (row.quiz_id && scores.get(row.quiz_id)?.responseCount) || 0,
        percentage: (row.quiz_id && scores.get(row.quiz_id)?.percentage) || 0,
        notResponded: pending.map(({ name, student_id, batch_id }) => ({
          name,
          studentId: student_id,
          batchId: batch_id,
        })),
      };
    });
    return NextResponse.json({ teachers });
  } catch (error) {
    console.error("Teacher feedback responses error:", error);
    return NextResponse.json({ error: "Failed to load responses" }, { status: 500 });
  }
}
