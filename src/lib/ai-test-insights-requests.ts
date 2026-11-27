// AI Test Insights (#550): the Insight Request module, the one place that
// reads and writes `ai_test_insight_requests`. Server-only (uses `@/lib/db`).
//
// The table is db-service's (#884); the LMS writes it directly through its
// Postgres boundary with `$n` placeholders (ADR 0015). No DB Service HTTP
// call. Times are written and compared with `now() AT TIME ZONE 'UTC'`, never
// a plain `now()`, which uses the connection's local time.
import { randomUUID } from "node:crypto";

import type { AiTestInsightsStudentContext } from "@/lib/ai-test-insights-access";
import { aiTestInsightsDeliverySettings, deliverInsightRequest } from "@/lib/ai-test-insights-delivery";
import {
  isInsightRequestInProgress,
  type AiTestInsightsRequestState,
  type InsightRequestView,
} from "@/lib/ai-test-insights-shared";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { query, withTransaction } from "@/lib/db";

const UTC_NOW = "(now() AT TIME ZONE 'UTC')";
/**
 * The UTC clock rounded to the second, as `requested_at` (`timestamp(0)`) is
 * stored. The stall rule compares with this, in the reads and in the guards,
 * so a request is never read as made in the future and both agree.
 */
const UTC_NOW_SECONDS = `${UTC_NOW}::timestamp(0)`;
/** A stored UTC timestamp as ISO 8601 with a `Z`, so no layer reads it as local time. */
const isoUtc = (column: string) => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
/** The unique index that allows one `queued` or `running` request per Student. */
const ACTIVE_STUDENT_INDEX = "ati_requests_active_student_unique";
/** Each delivery call's limit when a Teacher presses Generate. */
const GENERATE_DELIVERY_TIMEOUT_MS = 10_000;
/** Each delivery call's limit when a status poll re-delivers a request. */
const REDELIVERY_TIMEOUT_MS = 5_000;
/**
 * The stall limit: a `queued` or `running` request this old or older, counted
 * from `requested_at`, has stalled. Not a setting.
 */
const STALL_MINUTES = 20;
/** SQL: the request was made at least the stall limit ago. */
const STALLED = `requested_at <= ${UTC_NOW_SECONDS} - interval '${STALL_MINUTES} minutes'`;
/** The outcome code of a request shown, and at the next Generate closed, as stalled. */
const TIMED_OUT = "timed_out";

type RequestRow = {
  request_key: string;
  state: AiTestInsightsRequestState;
  outcome_code: string | null;
  selected_test_ids: string[];
  requested_at: string;
  requested_by_name: string | null;
  finished_at: string | null;
  /** The database's UTC clock at the read, which the stall rule compares with. */
  read_at: string;
};

/** The view columns of a request row `r` joined to its requester `u`. */
const VIEW_COLUMNS = `r.request_key,
       r.state,
       r.outcome_code,
       r.selected_test_ids,
       ${isoUtc("r.requested_at")} AS requested_at,
       COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', BTRIM(u.first_name), BTRIM(u.last_name))), ''), u.email) AS requested_by_name,
       ${isoUtc("r.finished_at")} AS finished_at,
       ${isoUtc(UTC_NOW_SECONDS)} AS read_at`;

/**
 * The stall rule, the one place that decides how a request is shown: a
 * `queued` or `running` request whose `requestedAt` is 20 minutes or more
 * before `nowUtc` reads `failed` with `timed_out`. Any other request is shown
 * as stored. Only the shown copy changes; the row is closed by the next
 * Generate (`createRequest`), and nothing else closes it.
 */
export function insightRequestAsShown(request: InsightRequestView, nowUtc: Date): InsightRequestView {
  if (request.state !== "queued" && request.state !== "running") return request;
  const age = nowUtc.getTime() - Date.parse(request.requestedAt);
  if (!(age >= STALL_MINUTES * 60_000)) return request;
  return { ...request, state: "failed", outcomeCode: TIMED_OUT };
}

/** A row as every read shows it: the stall rule applied against the database's UTC clock at the read. */
function toView(row: RequestRow): InsightRequestView {
  return insightRequestAsShown(
    {
      requestKey: row.request_key,
      state: row.state,
      outcomeCode: row.outcome_code,
      selectedTestIds: row.selected_test_ids,
      requestedAt: row.requested_at,
      requestedByName: row.requested_by_name ?? "",
      finishedAt: row.finished_at,
    },
    new Date(row.read_at),
  );
}

/** The Student's newest request by `requested_at`, then id; null when there is none. */
export async function latestRequest(studentId: number): Promise<InsightRequestView | null> {
  const rows = await query<RequestRow>(
    `SELECT ${VIEW_COLUMNS}
     FROM ai_test_insight_requests r
     JOIN "user" u ON u.id = r.requested_by_user_id
     WHERE r.student_id = $1
     ORDER BY r.requested_at DESC, r.id DESC
     LIMIT 1`,
    [studentId],
  );
  return rows[0] ? toView(rows[0]) : null;
}

/** One request, only if it belongs to that Student; null otherwise. */
export async function requestByKey(studentId: number, requestKey: string): Promise<InsightRequestView | null> {
  const rows = await query<RequestRow>(
    `SELECT ${VIEW_COLUMNS}
     FROM ai_test_insight_requests r
     JOIN "user" u ON u.id = r.requested_by_user_id
     WHERE r.student_id = $1 AND r.request_key = $2`,
    [studentId, requestKey],
  );
  return rows[0] ? toView(rows[0]) : null;
}

/** The Student's `queued` or `running` request, if any (at most one, by the unique index). */
async function inProgressRequest(studentId: number): Promise<InsightRequestView | null> {
  const rows = await query<RequestRow>(
    `SELECT ${VIEW_COLUMNS}
     FROM ai_test_insight_requests r
     JOIN "user" u ON u.id = r.requested_by_user_id
     WHERE r.student_id = $1 AND r.state IN ('queued', 'running')
     ORDER BY r.requested_at DESC, r.id DESC
     LIMIT 1`,
    [studentId],
  );
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * The Student's newest `completed` request of exactly these tests, in any
 * order, if any. Each array holds the other (jsonb `@>` both ways); the ids
 * are distinct (the route refuses repeats), so that is the same set. Order
 * is not compared: the picker lists tests by their newest sitting, so a
 * re-sat test moves up and the same tests can come in another order than the
 * stored newest-first one.
 */
async function completedRequestOfTests(studentId: number, selectedTestIds: string[]): Promise<InsightRequestView | null> {
  const rows = await query<RequestRow>(
    `SELECT ${VIEW_COLUMNS}
     FROM ai_test_insight_requests r
     JOIN "user" u ON u.id = r.requested_by_user_id
     WHERE r.student_id = $1 AND r.state = 'completed'
       AND r.selected_test_ids @> $2::jsonb AND r.selected_test_ids <@ $2::jsonb
     ORDER BY r.requested_at DESC, r.id DESC
     LIMIT 1`,
    [studentId, JSON.stringify(selectedTestIds)],
  );
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * The actor's User: the permission's linked User, otherwise the lowest-id
 * User with the same email (case-insensitive), as the existing actor lookup
 * does. Null when there is neither.
 */
export async function resolveActorUserId(actor: { email: string; linkedUserId: number | null }): Promise<number | null> {
  if (actor.linkedUserId !== null) return actor.linkedUserId;
  const rows = await query<{ id: number | string }>(
    `SELECT id FROM "user" WHERE LOWER(email) = LOWER($1) ORDER BY id LIMIT 1`,
    [actor.email],
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
}

export type CreateRequestResult =
  | { outcome: "created"; request: InsightRequestView }
  | { outcome: "already_running"; request: InsightRequestView }
  | { outcome: "existing"; request: InsightRequestView }
  | { outcome: "not_configured" };

function isActiveStudentConflict(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return pgError?.code === "23505" && pgError.constraint === ACTIVE_STUDENT_INDEX;
}

/**
 * Asks for an AI Summary of the Student's ticked tests. The PRD's steps, in
 * order:
 *
 * 1. A fresh (not stalled) `queued` or `running` request exists for the
 *    Student: `already_running` with it.
 * 2. A `completed` request of the Student with the same `selected_test_ids`
 *    (the same ids in any order) exists and `generateAgain` is not true: `existing` with
 *    the newest such request, and nothing is written. With `generateAgain` a
 *    new request is made and the earlier one is left as it is.
 * 3. Generation is not configured (`@/lib/ai-test-insights-delivery`):
 *    `not_configured`, and nothing is written.
 * 4. In one transaction, close the Student's stalled request (`failed`,
 *    `timed_out`; it still holds the one running slot), then insert the new
 *    row. This is the only place a stalled request is closed. A unique
 *    violation on the one-running-request index is not an error:
 *    `already_running` with the row that won.
 * 5. Deliver to AI Mentorship Guide, then return `created` with the row as it
 *    reads after delivery.
 */
export async function createRequest(params: {
  student: AiTestInsightsStudentContext;
  actorUserId: number;
  /** Newest first, as the picker sent them. */
  selectedTestIds: string[];
  /** Make a new request even when a completed one of the same tests exists. */
  generateAgain?: boolean;
}): Promise<CreateRequestResult> {
  const { student, actorUserId, selectedTestIds, generateAgain } = params;

  // 1. One running request per Student. A stalled one reads `failed`, so it
  //    does not count.
  const running = await inProgressRequest(student.studentId);
  if (running && isInsightRequestInProgress(running)) return { outcome: "already_running", request: running };

  // 2. The same tests already have an AI Summary: show it, unless asked again.
  if (generateAgain !== true) {
    const existing = await completedRequestOfTests(student.studentId, selectedTestIds);
    if (existing) return { outcome: "existing", request: existing };
  }

  // 3. Generation must be configured before anything is written.
  const delivery = aiTestInsightsDeliverySettings();
  if (!delivery) return { outcome: "not_configured" };

  // 4. Close a stalled request, then insert.
  const requestKey = randomUUID();
  let inserted: RequestRow;
  try {
    inserted = await withTransaction(async (client) => {
      await client.query(
        `UPDATE ai_test_insight_requests
         SET state = 'failed', outcome_code = '${TIMED_OUT}', finished_at = ${UTC_NOW}, updated_at = ${UTC_NOW}
         WHERE student_id = $1
           AND state IN ('queued', 'running')
           AND ${STALLED}`,
        [student.studentId],
      );
      const result = await client.query<RequestRow>(
        `WITH r AS (
           INSERT INTO ai_test_insight_requests
             (request_key, student_id, school_id, program_id, academic_year, requested_by_user_id,
              selected_test_ids, notes_snapshot, state, requested_at, inserted_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, '[]'::jsonb, 'queued', ${UTC_NOW}, ${UTC_NOW}, ${UTC_NOW})
           RETURNING *
         )
         SELECT ${VIEW_COLUMNS}
         FROM r
         JOIN "user" u ON u.id = r.requested_by_user_id`,
        [
          requestKey,
          student.studentId,
          student.school.id,
          student.programId,
          CURRENT_ACADEMIC_YEAR,
          actorUserId,
          JSON.stringify(selectedTestIds),
        ],
      );
      return result.rows[0];
    });
  } catch (error) {
    if (!isActiveStudentConflict(error)) throw error;
    const winner = await inProgressRequest(student.studentId);
    if (!winner) throw error;
    return { outcome: "already_running", request: winner };
  }

  // 5. Deliver. A rejected request will never run, so it ends `failed`.
  const outcome = await deliverInsightRequest(delivery, requestKey, GENERATE_DELIVERY_TIMEOUT_MS);
  if (outcome === "rejected") await markEnqueueRejected(requestKey);
  const current = await requestByKey(student.studentId, requestKey);
  return { outcome: "created", request: current ?? toView(inserted) };
}

/**
 * Ends a request the generator refused (`enqueue_rejected`). Guarded by
 * `state = 'queued'`, so a request the generator already claimed is left alone.
 */
async function markEnqueueRejected(requestKey: string): Promise<void> {
  await query(
    `UPDATE ai_test_insight_requests
     SET state = 'failed', outcome_code = 'enqueue_rejected', finished_at = ${UTC_NOW}, updated_at = ${UTC_NOW}
     WHERE request_key = $1 AND state = 'queued'`,
    [requestKey],
  );
}

/**
 * Repeats wake and enqueue for a request that is still `queued`, in case the
 * first enqueue call was missed while the generator booted. Called by the
 * status route for a caller with edit access, after it has checked that the
 * request belongs to the Student.
 *
 * At most once every 30 seconds per request: one conditional update stamps
 * `updated_at` where the request is `queued`, not stalled, and `updated_at`
 * is at least 30 seconds old, and only the caller whose update changed the
 * row delivers. A stalled request is never delivered again.
 * The outcome is handled as on Generate, each call limited to 5 seconds.
 * Returns whether this call delivered. Not configured: nothing happens.
 */
export async function redeliver(requestKey: string): Promise<boolean> {
  const delivery = aiTestInsightsDeliverySettings();
  if (!delivery) return false;

  const claimed = await query<{ request_key: string }>(
    `UPDATE ai_test_insight_requests
     SET updated_at = ${UTC_NOW}
     WHERE request_key = $1
       AND state = 'queued'
       AND NOT (${STALLED})
       AND updated_at <= ${UTC_NOW} - interval '30 seconds'
     RETURNING request_key`,
    [requestKey],
  );
  if (claimed.length === 0) return false;

  const outcome = await deliverInsightRequest(delivery, requestKey, REDELIVERY_TIMEOUT_MS);
  if (outcome === "rejected") await markEnqueueRejected(requestKey);
  return true;
}
