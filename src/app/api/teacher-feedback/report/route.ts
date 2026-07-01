import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { requireTeacherFeedbackAccess } from "@/lib/teacher-feedback-access";
import { getTeacherFeedbackReport } from "@/lib/teacher-feedback-bq";

// GET /api/teacher-feedback/report?quiz_id=XXXX
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireTeacherFeedbackAccess(email, "view");
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
  }>(
    `
    SELECT tf.school_code, tf.teacher_name, sch.id AS school_id
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

  try {
    const report = await getTeacherFeedbackReport(quizId);

    // Resolve batch_id -> readable name (the BQ module returns raw ids).
    const batchIds = report.batches.map((b) => b.batch);
    if (batchIds.length > 0) {
      const nameRows = await query<{ batch_id: string; name: string | null }>(
        `SELECT batch_id, name FROM batch WHERE batch_id = ANY($1::text[])`,
        [batchIds]
      );
      const nameById = new Map(
        nameRows.filter((r) => r.name).map((r) => [r.batch_id, r.name as string])
      );
      report.batches = report.batches.map((b) => ({
        ...b,
        batchName: nameById.get(b.batch) ?? b.batch,
      }));
    }

    return NextResponse.json({ teacherName: row.teacher_name, ...report });
  } catch (error) {
    console.error("Teacher feedback report error:", error);
    return NextResponse.json(
      { error: "Failed to load feedback report" },
      { status: 500 }
    );
  }
}
