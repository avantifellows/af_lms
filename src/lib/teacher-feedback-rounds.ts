import { NextResponse } from "next/server";

import { query } from "./db";
import type { UserPermission } from "./permissions";
import { canAccessQuizSessionSchool } from "./quiz-session-access";
import { requireCentreScope } from "./teacher-feedback-access";

export interface RoundRow {
  teacher_name: string;
  teacher_order: number;
  status: string;
  /** bigints come back from pg as strings — coerce before use. */
  session_pk: number | string | null;
  session_id: string | null;
  quiz_id: string | null;
  school_code: string;
  school_id: number | null;
  centre_id: number | string | null;
  batch_class_ids: string[];
  start_time: string | null;
  end_time: string | null;
  /** LLM summary (etl-next), null until the round has closed and been summarised. */
  summary: { concerns?: { serious?: boolean }[] } | null;
}

/**
 * Load a feedback round (one setup run) and check the caller may act on it:
 * school access plus centre scope, as the other feedback routes do.
 */
export async function loadAuthorizedRound(
  setupRunId: string,
  permission: UserPermission
): Promise<{ ok: true; rows: RoundRow[] } | { ok: false; response: NextResponse }> {
  const rows = await query<RoundRow>(
    `
    SELECT tf.teacher_name, tf.teacher_order, tf.status, tf.session_pk,
           s.session_id, s.platform_id AS quiz_id,
           tf.school_code, sch.id AS school_id, tf.centre_id, tf.batch_class_ids,
           tf.start_time::text AS start_time, tf.end_time::text AS end_time,
           to_jsonb(tf) -> 'summary' AS summary
    FROM lms_teacher_feedback tf
    LEFT JOIN session s ON s.id = tf.session_pk
    LEFT JOIN school sch ON sch.code = tf.school_code
    WHERE tf.setup_run_id = $1 AND tf.deleted_at IS NULL
    ORDER BY tf.teacher_order
    `,
    [setupRunId]
  );
  const first = rows[0];
  if (!first) {
    return { ok: false, response: NextResponse.json({ error: "Feedback round not found" }, { status: 404 }) };
  }
  if (first.school_id == null || !(await canAccessQuizSessionSchool(permission, first.school_id))) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (first.centre_id != null) {
    const scope = requireCentreScope(permission, Number(first.centre_id));
    if (!scope.ok) return { ok: false, response: scope.response };
  }
  return { ok: true, rows };
}

export interface RosterStudent {
  user_id: string;
  student_id: string | null;
  name: string;
  batch_id: string;
}

/** Current, non-dropout students of the round's class batches. */
export async function getRoundRoster(batchClassIds: string[]): Promise<RosterStudent[]> {
  if (batchClassIds.length === 0) return [];
  return query<RosterStudent>(
    `
    SELECT DISTINCT ON (u.id)
           u.id::text AS user_id, s.student_id,
           trim(concat_ws(' ', u.first_name, u.last_name)) AS name, b.batch_id
    FROM enrollment_record er
    JOIN batch b ON b.id = er.group_id AND b.batch_id = ANY($1::text[])
    JOIN "user" u ON u.id = er.user_id
    LEFT JOIN student s ON s.user_id = u.id
    WHERE er.group_type = 'batch' AND er.is_current = true
      AND s.status IS DISTINCT FROM 'dropout'
    ORDER BY u.id
    `,
    [batchClassIds]
  );
}
