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

  // The quiz must belong to a feedback row this PM can access (by school).
  const rows = await query<{ school_code: string; teacher_name: string }>(
    `SELECT school_code, teacher_name FROM lms_teacher_feedback
     WHERE quiz_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [quizId]
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Feedback quiz not found" }, { status: 404 });
  }

  const schoolRows = await query<{ id: number }>(
    `SELECT id FROM school WHERE code = $1 LIMIT 1`,
    [row.school_code]
  );
  const school = schoolRows[0];
  if (!school || !(await canAccessQuizSessionSchool(access.permission, school.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
