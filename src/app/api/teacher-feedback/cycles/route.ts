import { NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/db";
import { getCentreConfinement } from "@/lib/permissions";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback, requireCentreScope } from "@/lib/teacher-feedback-access";

interface Row {
  setup_run_id: string;
  cycle_label: string;
  centre_name: string | null;
  batch_class_ids: string[];
  teacher_name: string;
  teacher_order: number;
  teacher_id: string | null;
  /** bigint — node-pg hands these back as strings, so always coerce before use. */
  session_pk: number | string | null;
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
  /** The Lambda reported a failed quiz build — not still in progress. */
  buildFailed: boolean;
}

interface Cycle {
  setupRunId: string;
  cycleLabel: string;
  centreName: string | null;
  batchClassIds: string[];
  /** Human-readable batch names (falls back to the id when a name is unknown). */
  batchClassNames: string[];
  startTime: string | null;
  endTime: string | null;
  createdBy: string;
  createdAt: string;
  teachers: TeacherEntry[];
}

/** Resolve class batch_id -> readable name for the given ids (id used as fallback). */
async function resolveBatchNames(
  batchIds: string[]
): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  if (batchIds.length === 0) return byId;
  const batchRows = await query<{ batch_id: string; name: string | null }>(
    `SELECT batch_id, name FROM batch WHERE batch_id = ANY($1::text[])`,
    [batchIds]
  );
  for (const b of batchRows) {
    if (b.name) byId.set(b.batch_id, b.name);
  }
  return byId;
}

interface SessionLinks {
  quizId: string | null;
  portalLink: string;
  adminTestingLink: string;
  /** sessionCreator's own outcome, written onto the session's meta_data. */
  buildStatus: string | null;
}

/**
 * Read the launch links the sessionCreator Lambda writes onto each session,
 * keyed by session pk. Absent until the Lambda has run (UI shows "Generating…").
 * Also reads its meta_data.status: the Lambda sets that to "failed" when the quiz
 * build breaks, which is the only signal it gives back — without it a broken build
 * is indistinguishable from one still in progress.
 * Both session.id and lms_teacher_feedback.session_pk are bigints, which node-pg
 * returns as strings — every key and lookup here goes through Number() so the
 * map can't miss on "18046" vs 18046.
 */
async function resolveSessionLinks(
  sessionPks: number[]
): Promise<Map<number, SessionLinks>> {
  const byPk = new Map<number, SessionLinks>();
  if (sessionPks.length === 0) return byPk;
  const sessionRows = await query<{
    id: number | string;
    platform_id: string | null;
    portal_link: string | null;
    meta_data: { admin_testing_link?: string; status?: string } | null;
  }>(
    `SELECT id, platform_id, portal_link, meta_data FROM session WHERE id = ANY($1::bigint[])`,
    [sessionPks]
  );
  for (const s of sessionRows) {
    byPk.set(Number(s.id), {
      quizId: s.platform_id || null,
      portalLink: s.portal_link ?? "",
      adminTestingLink: s.meta_data?.admin_testing_link ?? "",
      buildStatus: s.meta_data?.status ?? null,
    });
  }
  return byPk;
}

// GET /api/teacher-feedback/cycles?school_code=XXXXX[&centre_id=N]
// centre_id restricts the rounds to that centre, for the centre page — without
// it a centre page would list a sibling centre's feedback rounds.
export async function GET(request: NextRequest) {
  const access = await authenticateTeacherFeedback("view");
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

  const centreIdParam = request.nextUrl.searchParams.get("centre_id")?.trim();
  const centreId = centreIdParam ? Number(centreIdParam) : null;
  if (centreIdParam && !Number.isFinite(centreId)) {
    return NextResponse.json(
      { error: "centre_id must be a number" },
      { status: 400 }
    );
  }

  if (centreId !== null) {
    const centreScopeCheck = requireCentreScope(access.permission, centreId);
    if (!centreScopeCheck.ok) {
      return centreScopeCheck.response;
    }
  }

  // Same exposure by omission as the centres route: with no centre_id a confined
  // caller would read every round at the school, sibling centres included.
  const confinement = getCentreConfinement(access.permission);
  const allowedCentreIds = confinement.confined ? confinement.centreIds : null;

  const rows = await query<Row>(
    `
    SELECT tf.setup_run_id, tf.cycle_label, c.name AS centre_name,
           tf.batch_class_ids,
           tf.teacher_name, tf.teacher_order, tf.teacher_id, tf.session_pk,
           tf.status,
           tf.start_time::text AS start_time, tf.end_time::text AS end_time,
           tf.created_by, tf.inserted_at::text AS inserted_at
    FROM lms_teacher_feedback tf
    -- Centre name is resolved at read time rather than stored, so a renamed
    -- centre reads correctly on historical rounds instead of keeping a stale
    -- copy. LEFT JOIN: a round survives its centre being removed.
    LEFT JOIN centres c ON c.id = tf.centre_id
    WHERE tf.school_code = $1 AND tf.deleted_at IS NULL
      AND ($2::bigint IS NULL OR tf.centre_id = $2::bigint)
      AND ($3::int[] IS NULL OR tf.centre_id = ANY($3::int[]))
    ORDER BY tf.inserted_at DESC, tf.teacher_order ASC
    `,
    [schoolCode, centreId, allowedCentreIds]
  );

  // Resolve batch_id -> readable name for all class batches across these cycles.
  const batchNameById = await resolveBatchNames(
    Array.from(new Set(rows.flatMap((r) => r.batch_class_ids ?? [])))
  );

  // Links are written onto the db-service session by the sessionCreator Lambda
  // (async); absent until it has run, so the UI shows "Generating…".
  const linksByPk = await resolveSessionLinks(
    Array.from(
      new Set(
        rows
          .map((r) => (r.session_pk == null ? null : Number(r.session_pk)))
          .filter((pk): pk is number => pk != null && !Number.isNaN(pk))
      )
    )
  );

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
        startTime: r.start_time,
        endTime: r.end_time,
        createdBy: r.created_by,
        createdAt: r.inserted_at,
        teachers: [],
      };
      byRun.set(r.setup_run_id, cycle);
    }
    // Number(): session_pk is a bigint, so pg returns "18046" and a raw lookup
    // against this number-keyed map misses every time — every row then reads as
    // "Generating links…" even once the Lambda has filled them in.
    const links =
      r.session_pk != null ? linksByPk.get(Number(r.session_pk)) : undefined;
    cycle.teachers.push({
      teacherName: r.teacher_name,
      teacherOrder: r.teacher_order,
      teacherId: r.teacher_id,
      status: r.status,
      quizId: links?.quizId ?? null,
      portalLink: links?.portalLink ?? "",
      adminTestingLink: links?.adminTestingLink ?? "",
      buildFailed: links?.buildStatus === "failed",
    });
  }

  // Keep teachers ordered within each cycle.
  const cycles = Array.from(byRun.values()).map((c) => ({
    ...c,
    teachers: c.teachers.sort((a, b) => a.teacherOrder - b.teacherOrder),
  }));

  return NextResponse.json({ cycles });
}
