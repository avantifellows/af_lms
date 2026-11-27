// AI Test Insights (#550): the Insight Request module, the one place that
// reads and writes `ai_test_insight_requests`. Server-only (uses `@/lib/db`).
//
// The table is db-service's (#884); the LMS writes it directly through its
// Postgres boundary with `$n` placeholders (ADR 0015). No DB Service HTTP
// call. Times are written and compared with `now() AT TIME ZONE 'UTC'`, never
// a plain `now()`, which uses the connection's local time.
import { randomUUID } from "node:crypto";

import type { AiTestInsightsStudentContext } from "@/lib/ai-test-insights-access";
import type { AiTestInsightsRequestState, InsightRequestView } from "@/lib/ai-test-insights-shared";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { query, withTransaction } from "@/lib/db";

const UTC_NOW = "(now() AT TIME ZONE 'UTC')";
/** A stored UTC timestamp as ISO 8601 with a `Z`, so no layer reads it as local time. */
const isoUtc = (column: string) => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
/** The unique index that allows one `queued` or `running` request per Student. */
const ACTIVE_STUDENT_INDEX = "ati_requests_active_student_unique";

type RequestRow = {
  request_key: string;
  state: AiTestInsightsRequestState;
  outcome_code: string | null;
  selected_test_ids: string[];
  requested_at: string;
  requested_by_name: string | null;
  finished_at: string | null;
};

/** The view columns of a request row `r` joined to its requester `u`. */
const VIEW_COLUMNS = `r.request_key,
       r.state,
       r.outcome_code,
       r.selected_test_ids,
       ${isoUtc("r.requested_at")} AS requested_at,
       COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', BTRIM(u.first_name), BTRIM(u.last_name))), ''), u.email) AS requested_by_name,
       ${isoUtc("r.finished_at")} AS finished_at`;

function toView(row: RequestRow): InsightRequestView {
  return {
    requestKey: row.request_key,
    state: row.state,
    outcomeCode: row.outcome_code,
    selectedTestIds: row.selected_test_ids,
    requestedAt: row.requested_at,
    requestedByName: row.requested_by_name ?? "",
    finishedAt: row.finished_at,
  };
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
  | { outcome: "already_running"; request: InsightRequestView };

function isActiveStudentConflict(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return pgError?.code === "23505" && pgError.constraint === ACTIVE_STUDENT_INDEX;
}

/**
 * Asks for an AI Summary of the Student's ticked tests. The PRD's steps, in
 * order; this slice has steps 1 and 4 (later slices fill in the rest):
 *
 * 1. A `queued` or `running` request exists for the Student: `already_running`
 *    with it.
 * 2. (Later: a `completed` request with the same tests and no `generateAgain`
 *    returns `existing`.)
 * 3. (Later: generation not configured returns `not_configured`.)
 * 4. In one transaction, (later: close a stalled request, then) insert the new
 *    row. A unique violation on the one-running-request index is not an
 *    error: `already_running` with the row that won.
 * 5. (Later: deliver to AI Mentorship Guide.) Return `created`.
 */
export async function createRequest(params: {
  student: AiTestInsightsStudentContext;
  actorUserId: number;
  /** Newest first, as the picker sent them. */
  selectedTestIds: string[];
  /** Accepted; has no effect until the "same tests" step exists. */
  generateAgain?: boolean;
}): Promise<CreateRequestResult> {
  const { student, actorUserId, selectedTestIds } = params;

  // 1. One running request per Student.
  const running = await inProgressRequest(student.studentId);
  if (running) return { outcome: "already_running", request: running };

  // 4. Insert.
  const requestKey = randomUUID();
  try {
    const inserted = await withTransaction(async (client) => {
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
    return { outcome: "created", request: toView(inserted) };
  } catch (error) {
    if (!isActiveStudentConflict(error)) throw error;
    const winner = await inProgressRequest(student.studentId);
    if (!winner) throw error;
    return { outcome: "already_running", request: winner };
  }
}
