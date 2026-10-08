import { query } from "./db";
import { getTeacherFeedbackSummaries, type Gender, type ScoreSummary } from "./teacher-feedback-bq";

export interface RoundContext {
  setupRunId: string;
  cycleLabel: string;
  centreName: string | null;
  batchNames: string[];
  startTime: string | null;
  endTime: string | null;
}

export interface HistoryEntry extends ScoreSummary {
  quizId: string;
  setupRunId: string;
  cycleLabel: string;
  startTime: string | null;
  batchNames: string[];
}

interface FeedbackRow {
  setup_run_id: string;
  cycle_label: string;
  centre_name: string | null;
  batch_class_ids: string[];
  start_time: string | null;
  end_time: string | null;
  quiz_id: string;
}

const ROUND_COLUMNS = `
  tf.setup_run_id::text AS setup_run_id, tf.cycle_label, c.name AS centre_name,
  tf.batch_class_ids, tf.start_time::text AS start_time, tf.end_time::text AS end_time,
  s.platform_id AS quiz_id`;

async function batchNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await query<{ batch_id: string; name: string | null }>(
    `SELECT batch_id, name FROM batch WHERE batch_id = ANY($1::text[])`,
    [ids]
  );
  return new Map(rows.filter((r) => r.name).map((r) => [r.batch_id, r.name as string]));
}

/** Month, centre and batches of the round a feedback quiz belongs to. */
export async function getRoundContext(quizId: string): Promise<RoundContext | null> {
  const [row] = await query<FeedbackRow>(
    `SELECT ${ROUND_COLUMNS}
     FROM session s
     JOIN lms_teacher_feedback tf ON tf.session_pk = s.id AND tf.deleted_at IS NULL
     LEFT JOIN centres c ON c.id = tf.centre_id
     WHERE s.platform_id = $1
     LIMIT 1`,
    [quizId]
  );
  if (!row) return null;
  const names = await batchNames(row.batch_class_ids);
  return {
    setupRunId: row.setup_run_id,
    cycleLabel: row.cycle_label,
    centreName: row.centre_name,
    batchNames: row.batch_class_ids.map((id) => names.get(id) ?? id),
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

/**
 * Every round this teacher was rated in at the same centre, oldest first, with
 * headline scores. Matched by teacher_id; rows saved without one match by name.
 * Rounds nobody answered (abandoned or duplicate set-ups) are left out.
 */
export async function getTeacherHistory(params: {
  schoolCode: string;
  centreId: number | null;
  teacherId: string | null;
  teacherName: string;
}): Promise<HistoryEntry[]> {
  const rows = await query<FeedbackRow>(
    `SELECT ${ROUND_COLUMNS}
     FROM lms_teacher_feedback tf
     JOIN session s ON s.id = tf.session_pk AND s.platform_id IS NOT NULL
     LEFT JOIN centres c ON c.id = tf.centre_id
     WHERE tf.deleted_at IS NULL
       AND tf.school_code = $1
       AND tf.centre_id IS NOT DISTINCT FROM $2
       AND (tf.teacher_id = $3
            OR ((tf.teacher_id IS NULL OR $3::text IS NULL)
                AND lower(trim(tf.teacher_name)) = lower(trim($4))))
     ORDER BY tf.start_time`,
    [params.schoolCode, params.centreId, params.teacherId, params.teacherName]
  );
  if (rows.length === 0) return [];
  const [scores, names] = await Promise.all([
    getTeacherFeedbackSummaries(rows.map((r) => r.quiz_id)),
    batchNames([...new Set(rows.flatMap((r) => r.batch_class_ids))]),
  ]);
  return rows.flatMap((r) => {
    const score = scores.get(r.quiz_id);
    if (!score || score.responseCount === 0) return [];
    return [{
      ...score,
      quizId: r.quiz_id,
      setupRunId: r.setup_run_id,
      cycleLabel: r.cycle_label,
      startTime: r.start_time,
      batchNames: r.batch_class_ids.map((id) => names.get(id) ?? id),
    }];
  });
}

/** LMS user id → gender, for the split. Anything but male/female is left out. */
export async function getGenders(userIds: string[]): Promise<Map<string, Gender>> {
  const ids = userIds.filter((id) => /^\d+$/.test(id));
  if (ids.length === 0) return new Map();
  const rows = await query<{ id: string; gender: string | null }>(
    `SELECT id::text AS id, lower(trim(gender)) AS gender FROM "user" WHERE id = ANY($1::bigint[])`,
    [ids]
  );
  return new Map(
    rows
      .filter((r): r is { id: string; gender: Gender } => r.gender === "female" || r.gender === "male")
      .map((r) => [r.id, r.gender])
  );
}
