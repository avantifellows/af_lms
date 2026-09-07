import { NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/db";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback, requireCentreScope } from "@/lib/teacher-feedback-access";
import { getTeacherFeedbackReport } from "@/lib/teacher-feedback-bq";

// GET /api/teacher-feedback/report?quiz_id=XXXX
export async function GET(request: NextRequest) {
  const access = await authenticateTeacherFeedback("view");
  if (!access.ok) {
    return access.response;
  }

  const quizId = request.nextUrl.searchParams.get("quiz_id")?.trim();
  if (!quizId) {
    return NextResponse.json(
      { error: "quiz_id query parameter is required" },
      { status: 400 }
    );
  }

  // The quiz_id is the session's platform_id (filled by the sessionCreator
  // Lambda). Resolve the feedback row + school via the session this quiz belongs
  // to, so we can both check access and label the report with the teacher.
  const rows = await query<{
    school_code: string;
    teacher_name: string;
    school_id: number | null;
    centre_id: number | string | null;
  }>(
    `
    SELECT tf.school_code, tf.teacher_name, sch.id AS school_id, tf.centre_id
    FROM session s
    JOIN lms_teacher_feedback tf ON tf.session_pk = s.id AND tf.deleted_at IS NULL
    LEFT JOIN school sch ON sch.code = tf.school_code
    WHERE s.platform_id = $1
    LIMIT 1
    `,
    [quizId]
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Feedback quiz not found" }, { status: 404 });
  }
  if (row.school_id == null || !(await canAccessQuizSessionSchool(access.permission, row.school_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The report is the actual feedback content, so the centre check matters most
  // here: the school check above would otherwise hand a confined caller a
  // sibling centre's report given only its quiz id.
  if (row.centre_id != null) {
    const centreScopeCheck = requireCentreScope(access.permission, Number(row.centre_id));
    if (!centreScopeCheck.ok) {
      return centreScopeCheck.response;
    }
  }

  try {
    const report = await getTeacherFeedbackReport(quizId);

    return NextResponse.json({ teacherName: row.teacher_name, ...report });
  } catch (error) {
    console.error("Teacher feedback report error:", error);
    return NextResponse.json(
      { error: "Failed to load feedback report" },
      { status: 500 }
    );
  }
}
