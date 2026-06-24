import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { requireTeacherFeedbackAccess } from "@/lib/teacher-feedback-access";

interface Row {
  setup_run_id: string;
  cycle_label: string;
  centre_name: string | null;
  batch_parent_id: string;
  batch_class_ids: string[];
  grade: number;
  teacher_name: string;
  teacher_order: number;
  teacher_id: string | null;
  session_pk: number | null;
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
  status: string;
  /** quiz id (= session.platform_id), filled by the Lambda; null until then. */
  quizId: string | null;
  /** Filled by the sessionCreator Lambda; "" until it has run ("Generating…"). */
  portalLink: string;
  adminTestingLink: string;
}

interface Cycle {
  setupRunId: string;
  cycleLabel: string;
  centreName: string | null;
  batchClassIds: string[];
  /** Human-readable batch names (falls back to the id when a name is unknown). */
  batchClassNames: string[];
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
    SELECT setup_run_id, cycle_label, centre_name, batch_parent_id, batch_class_ids, grade,
           teacher_name, teacher_order, teacher_id, session_pk, status,
           start_time::text AS start_time, end_time::text AS end_time,
           created_by, inserted_at::text AS inserted_at
    FROM lms_teacher_feedback
    WHERE school_code = $1 AND deleted_at IS NULL
    ORDER BY inserted_at DESC, teacher_order ASC
    `,
    [schoolCode]
  );

  // Resolve batch_id -> readable name for all class batches across these cycles.
  const allBatchIds = Array.from(
    new Set(rows.flatMap((r) => r.batch_class_ids ?? []))
  );
  const batchNameById = new Map<string, string>();
  if (allBatchIds.length > 0) {
    const batchRows = await query<{ batch_id: string; name: string | null }>(
      `SELECT batch_id, name FROM batch WHERE batch_id = ANY($1::text[])`,
      [allBatchIds]
    );
    for (const b of batchRows) {
      if (b.name) batchNameById.set(b.batch_id, b.name);
    }
  }

  // Links are written onto the db-service session by the sessionCreator Lambda
  // (async). Read them from the session rows by session_pk — absent until the
  // Lambda has run, so the UI shows "Generating…".
  const sessionPks = Array.from(
    new Set(rows.map((r) => r.session_pk).filter((pk): pk is number => pk != null))
  );
  const linksByPk = new Map<
    number,
    { quizId: string | null; portalLink: string; adminTestingLink: string }
  >();
  if (sessionPks.length > 0) {
    const sessionRows = await query<{
      id: number;
      platform_id: string | null;
      portal_link: string | null;
      meta_data: { admin_testing_link?: string } | null;
    }>(
      `SELECT id, platform_id, portal_link, meta_data FROM session WHERE id = ANY($1::int[])`,
      [sessionPks]
    );
    for (const s of sessionRows) {
      linksByPk.set(s.id, {
        quizId: s.platform_id || null,
        portalLink: s.portal_link ?? "",
        adminTestingLink: s.meta_data?.admin_testing_link ?? "",
      });
    }
  }

  // Group rows into cycles by setup_run_id (preserving the DESC insertion order).
  const byRun = new Map<string, Cycle>();
  for (const r of rows) {
    let cycle = byRun.get(r.setup_run_id);
    if (!cycle) {
      const classIds = r.batch_class_ids ?? [];
      cycle = {
        setupRunId: r.setup_run_id,
        cycleLabel: r.cycle_label,
        centreName: r.centre_name,
        batchClassIds: classIds,
        batchClassNames: classIds.map((id) => batchNameById.get(id) ?? id),
        grade: r.grade,
        startTime: r.start_time,
        endTime: r.end_time,
        createdBy: r.created_by,
        createdAt: r.inserted_at,
        teachers: [],
      };
      byRun.set(r.setup_run_id, cycle);
    }
    const links = r.session_pk != null ? linksByPk.get(r.session_pk) : undefined;
    cycle.teachers.push({
      teacherName: r.teacher_name,
      teacherOrder: r.teacher_order,
      teacherId: r.teacher_id,
      status: r.status,
      quizId: links?.quizId ?? null,
      portalLink: links?.portalLink ?? "",
      adminTestingLink: links?.adminTestingLink ?? "",
    });
  }

  // Keep teachers ordered within each cycle.
  const cycles = Array.from(byRun.values()).map((c) => ({
    ...c,
    teachers: c.teachers.sort((a, b) => a.teacherOrder - b.teacherOrder),
  }));

  return NextResponse.json({ cycles });
}
