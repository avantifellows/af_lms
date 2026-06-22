import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { requireTeacherFeedbackAccess } from "@/lib/teacher-feedback-access";
import { buildPortalLink } from "@/lib/teacher-feedback-session";

const PORTAL_URL = process.env.PORTAL_URL ?? "https://auth.avantifellows.org/";
const QUIZ_FRONTEND_URL = process.env.QUIZ_FRONTEND_URL ?? "";
const QUIZ_AF_API_KEY = process.env.QUIZ_AF_API_KEY ?? "";

function adminTestingLink(quizId: string | null): string {
  if (!QUIZ_FRONTEND_URL || !quizId) return "";
  const base = QUIZ_FRONTEND_URL.replace(/\/$/, "");
  const key = QUIZ_AF_API_KEY ? `&apiKey=${QUIZ_AF_API_KEY}` : "";
  return `${base}/form/${quizId}?userId=test_admin${key}&singlePageMode=true&autoStart=true`;
}

interface Row {
  setup_run_id: string;
  cycle_label: string;
  batch_parent_id: string;
  batch_class_ids: string[];
  grade: number;
  teacher_name: string;
  teacher_order: number;
  teacher_id: string | null;
  quiz_id: string | null;
  session_id: string | null;
  status: string;
  start_time: string | null;
  end_time: string | null;
  created_by: string;
  inserted_at: string;
}

interface TeacherEntry {
  teacherName: string;
  teacherOrder: number;
  teacherId: string | null;
  quizId: string | null;
  sessionId: string | null;
  status: string;
  portalLink: string;
  adminTestingLink: string;
}

interface Cycle {
  setupRunId: string;
  cycleLabel: string;
  batchClassIds: string[];
  grade: number;
  startTime: string | null;
  endTime: string | null;
  createdBy: string;
  createdAt: string;
  teachers: TeacherEntry[];
}

// GET /api/teacher-feedback/cycles?school_code=XXXXX
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

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) {
    return NextResponse.json(
      { error: "school_code query parameter is required" },
      { status: 400 }
    );
  }

  const schoolRows = await query<{ id: number }>(
    `SELECT id FROM school WHERE code = $1 LIMIT 1`,
    [schoolCode]
  );
  const school = schoolRows[0];
  if (!school) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }
  if (!(await canAccessQuizSessionSchool(access.permission, school.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await query<Row>(
    `
    SELECT setup_run_id, cycle_label, batch_parent_id, batch_class_ids, grade,
           teacher_name, teacher_order, teacher_id, quiz_id, session_id, status,
           start_time::text AS start_time, end_time::text AS end_time,
           created_by, inserted_at::text AS inserted_at
    FROM lms_teacher_feedback
    WHERE school_code = $1 AND deleted_at IS NULL
    ORDER BY inserted_at DESC, teacher_order ASC
    `,
    [schoolCode]
  );

  // Group rows into cycles by setup_run_id (preserving the DESC insertion order).
  const byRun = new Map<string, Cycle>();
  for (const r of rows) {
    let cycle = byRun.get(r.setup_run_id);
    if (!cycle) {
      cycle = {
        setupRunId: r.setup_run_id,
        cycleLabel: r.cycle_label,
        batchClassIds: r.batch_class_ids ?? [],
        grade: r.grade,
        startTime: r.start_time,
        endTime: r.end_time,
        createdBy: r.created_by,
        createdAt: r.inserted_at,
        teachers: [],
      };
      byRun.set(r.setup_run_id, cycle);
    }
    cycle.teachers.push({
      teacherName: r.teacher_name,
      teacherOrder: r.teacher_order,
      teacherId: r.teacher_id,
      quizId: r.quiz_id,
      sessionId: r.session_id,
      status: r.status,
      portalLink: r.session_id ? buildPortalLink(PORTAL_URL, r.session_id) : "",
      adminTestingLink: adminTestingLink(r.quiz_id),
    });
  }

  // Keep teachers ordered within each cycle.
  const cycles = Array.from(byRun.values()).map((c) => ({
    ...c,
    teachers: c.teachers.sort((a, b) => a.teacherOrder - b.teacherOrder),
  }));

  return NextResponse.json({ cycles });
}
