import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "./constants";
import { query, withTransaction } from "./db";

type RegenerationState = "queued" | "running" | "completed" | "failed";

export async function getHolisticProfileAdmin(studentId: number, academicYear: string): Promise<{
  summaries: Array<{ position: number; title: string; summary: string }>;
  regeneration: null | { requestKey: string; state: RegenerationState; requestedAt: string; errorCode: string | null };
}> {
  const [summaries, requests] = await Promise.all([
    query<{ position: number; title: string; summary: string }>(
      `SELECT summary.position, summary.question_set_title AS title, summary.summary
       FROM holistic_mentorship_profile_journeys journey
       JOIN holistic_mentorship_student_profiles profile ON profile.profile_journey_id = journey.id
       JOIN holistic_mentorship_prompt_configurations configuration
         ON configuration.id = profile.prompt_configuration_id AND configuration.state = 'active'
       JOIN holistic_mentorship_student_profile_summaries summary ON summary.student_profile_id = profile.id
       WHERE journey.student_id = $1
         AND EXISTS (SELECT 1 FROM holistic_mentorship_mentor_mentee_mappings mapping
                     WHERE mapping.student_id = journey.student_id AND mapping.program_id = $2
                       AND mapping.academic_year = $3
                       AND ($3 <> $4 OR mapping.ended_at IS NULL))
       ORDER BY summary.position`,
      [studentId, PROGRAM_IDS.COE, academicYear, CURRENT_ACADEMIC_YEAR]
    ),
    query<{ request_key: string; state: RegenerationState; inserted_at: string; error_code: string | null }>(
      `SELECT request.request_key, request.state, request.inserted_at, request.error_code
       FROM holistic_mentorship_regeneration_requests request
       JOIN holistic_mentorship_prompt_configurations configuration
         ON configuration.id = request.prompt_configuration_id AND configuration.state = 'active'
       WHERE request.student_id = $1
         AND EXISTS (SELECT 1 FROM holistic_mentorship_mentor_mentee_mappings mapping
                     WHERE mapping.student_id = $1 AND mapping.program_id = $2
                       AND mapping.academic_year = $3
                       AND ($3 <> $4 OR mapping.ended_at IS NULL))
       ORDER BY request.inserted_at DESC, request.id DESC LIMIT 1`,
      [studentId, PROGRAM_IDS.COE, academicYear, CURRENT_ACADEMIC_YEAR]
    ),
  ]);
  return {
    summaries,
    regeneration: requests[0] ? {
      requestKey: requests[0].request_key,
      state: requests[0].state,
      requestedAt: requests[0].inserted_at,
      errorCode: requests[0].error_code,
    } : null,
  };
}

export async function requestHolisticProfileRegeneration(params: {
  email: string;
  studentId: number;
  requestKey: string;
  force: true;
}): Promise<
  | { ok: true; requestKey: string; state: RegenerationState; delivery?: "ambiguous" }
  | { ok: false; status: 404 | 409 | 500 | 502; error: string }
> {
  const endpoint = process.env.HOLISTIC_PROFILE_ETL_URL?.replace(/\/+$/, "");
  const token = process.env.HOLISTIC_PROFILE_ETL_TOKEN;
  const environment = process.env.APP_ENV;
  if (!endpoint || !token || (environment !== "staging" && environment !== "production")) {
    return { ok: false, status: 500, error: "Profile regeneration is not configured" };
  }
  const request = await withTransaction(async (client) => {
    const scope = await client.query<{
      actor_user_id: number | string;
      student_id: number | string;
      prompt_configuration_id: number | string;
    }>(
      `SELECT actor.id AS actor_user_id, student.id AS student_id,
              configuration.id AS prompt_configuration_id
       FROM user_permission permission
       JOIN "user" actor ON actor.id = permission.user_id OR LOWER(actor.email) = LOWER(permission.email)
       JOIN student ON student.id = $2 AND student.status IS DISTINCT FROM 'dropout'
       JOIN "user" student_user ON student_user.id = student.user_id
       JOIN enrollment_record batch_enrollment ON batch_enrollment.user_id = student_user.id
         AND batch_enrollment.group_type = 'batch' AND batch_enrollment.is_current IS TRUE
       JOIN "group" batch_group ON batch_group.id = batch_enrollment.group_id AND batch_group.type = 'batch'
       JOIN batch ON batch.id = batch_group.child_id AND batch.program_id = $3
       JOIN enrollment_record grade_enrollment ON grade_enrollment.user_id = student_user.id
         AND grade_enrollment.group_type = 'grade' AND grade_enrollment.is_current IS TRUE
       JOIN grade ON grade.id = grade_enrollment.group_id AND grade.number IN (11, 12)
       JOIN holistic_mentorship_prompt_configurations configuration ON configuration.state = 'active'
       WHERE LOWER(permission.email) = LOWER($1) AND permission.revoked_at IS NULL
         AND permission.read_only IS NOT TRUE
         AND permission.role IN ('admin', 'holistic_mentorship_admin')
         AND NOT EXISTS (
           SELECT 1 FROM holistic_mentorship_privacy_deletions deletion
           WHERE deletion.student_id = student.id
         )
       LIMIT 1 FOR UPDATE OF permission, student, configuration`,
      [params.email, params.studentId, PROGRAM_IDS.COE]
    );
    const row = scope.rows[0];
    if (!row) return null;
    const actorUserId = Number(row.actor_user_id);
    const configurationId = Number(row.prompt_configuration_id);
    const inserted = await client.query<{ request_key: string; state: RegenerationState }>(
      `WITH inserted AS (
         INSERT INTO holistic_mentorship_regeneration_requests
           (request_key, requested_by_user_id, student_id, prompt_configuration_id, force, state, inserted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'queued', NOW(), NOW())
         ON CONFLICT (request_key) DO NOTHING
         RETURNING request_key, state
       )
       SELECT request_key, state FROM inserted
       UNION ALL
       SELECT request_key, state FROM holistic_mentorship_regeneration_requests
       WHERE request_key = $1 AND requested_by_user_id = $2 AND student_id = $3
         AND prompt_configuration_id = $4 AND force = $5
       LIMIT 1`,
      [params.requestKey, actorUserId, params.studentId, configurationId, params.force]
    );
    return inserted.rows[0] ?? { conflict: true as const };
  });
  if (!request) return { ok: false, status: 404, error: "Student or Active Profile configuration not found" };
  if ("conflict" in request) return { ok: false, status: 409, error: "Idempotency key conflict" };
  if (request.state !== "queued") return { ok: true, requestKey: request.request_key, state: request.state };

  let response: Response;
  try {
    response = await fetch(`${endpoint}/${encodeURIComponent(request.request_key)}/enqueue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ environment }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: true, requestKey: request.request_key, state: "queued", delivery: "ambiguous" };
  }
  if (response.ok) return { ok: true, requestKey: request.request_key, state: "queued" };

  const failed = await query<{ request_key: string; state: RegenerationState }>(
    `UPDATE holistic_mentorship_regeneration_requests
     SET state = 'failed', etl_run_id = $2, error_code = 'enqueue_rejected',
         error_message = 'ETL rejected the regeneration request', updated_at = NOW()
     WHERE request_key = $1 AND state = 'queued' AND etl_run_id IS NULL
     RETURNING request_key, state`,
    [request.request_key, `rejected-${request.request_key}`]
  );
  if (failed.length > 0) {
    return { ok: false, status: 502, error: "Profile regeneration was rejected" };
  }

  const current = await query<{ request_key: string; state: RegenerationState }>(
    `SELECT request_key, state FROM holistic_mentorship_regeneration_requests
     WHERE request_key = $1 LIMIT 1`,
    [request.request_key]
  );
  const state = current[0]?.state ?? "queued";
  return state === "queued"
    ? { ok: true, requestKey: request.request_key, state, delivery: "ambiguous" }
    : { ok: true, requestKey: request.request_key, state };
}
