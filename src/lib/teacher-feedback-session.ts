/**
 * Teacher Feedback — db-service session creation.
 *
 * Builds the `/session` payload for one teacher's feedback form and attaches it
 * to the parent batch's group + a session occurrence so it surfaces on Gurukul.
 *
 * IMPORTANT: the direct quiz-backend path does NOT trigger the sessionCreator
 * Lambda (we must NOT publish an SNS `db_id` for these — that would rebuild the
 * quiz from cms_test_id and clobber ours). So the LMS pre-fills the launch fields
 * (`session_id`, `platform_id`, `platform_link`, `portal_link`) itself, exactly
 * as scripts/create_teacher_feedback_pilot.py did.
 *
 * meta_data uses CANONICAL quiz-creator values only (Options.ts): test_type
 * 'form', test_format 'questionnaire', test_purpose 'one_time'. There is no
 * feedback test_purpose, so feedback rows are identified by the quiz source_id
 * (= cms_test_id on every BigQuery row) plus the lms_teacher_feedback quiz_id list.
 */

import { utcToISTDate } from "./quiz-session-time";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

function dbBaseUrl(): string {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    throw new Error("DB service is not configured");
  }
  return DB_SERVICE_URL.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

export interface FeedbackSessionParams {
  /** quiz-backend quiz id this session points at (its platform_link/platform_id). */
  quizId: string;
  /** Program tag, e.g. "EnableStudents" — becomes meta_data.group + BQ `group`. */
  group: string;
  /** Parent (grade) batch id, e.g. "EnableStudents_11". */
  parentBatchId: string;
  /** Class (child) batch ids; comma-joined into meta_data.batch_id + BQ `batch`. */
  classBatchIds: string[];
  /** Grade as integer (11 or 12). */
  grade: number;
  /** Canonical stream matching the batch, or "" if unknown. */
  stream: string;
  /** Canonical course matching the batch, or "" if unknown. */
  course: string;
  /** Stable source identifier (= quiz source_id), stamped as cms_test_id. */
  sourceId: string;
  /** ISO UTC start/end of the response window. */
  startTimeUtc: string;
  endTimeUtc: string;
  /** Portal base URL, e.g. "https://auth.avantifellows.org/". */
  portalBaseUrl: string;
  /** Human-readable session name (e.g. "Student Feedback - Jun 2026 - JNV Palghar - Manjit Kumar"). */
  name: string;
  /** Email of the PM/admin creating this. */
  createdBy: string;
  /** Portal URL of the next teacher's session for chaining; "" for the last. */
  nextStepUrl?: string;
  nextStepText?: string;
  /** Our own traceability fields (not consumed by the ETL). */
  feedback: {
    teacherId: string | null;
    teacherName: string;
    teacherOrder: number;
    cycleLabel: string;
    schoolCode: string;
  };
}

/** Build the canonical `session_id` for a feedback session. */
export function buildFeedbackSessionId(group: string, quizId: string): string {
  return `${group}_${quizId}`;
}

/** Build the portal launch link for a session_id. */
export function buildPortalLink(portalBaseUrl: string, sessionId: string): string {
  const base = portalBaseUrl.endsWith("/") ? portalBaseUrl : `${portalBaseUrl}/`;
  return `${base}?sessionId=${sessionId}`;
}

/**
 * Build the db-service `/session` POST payload. Pure — no I/O — so it is unit
 * testable. Launch fields are pre-filled because the Lambda is not in the loop.
 */
export function buildFeedbackSessionPayload(
  params: FeedbackSessionParams
): Record<string, unknown> {
  const sessionId = buildFeedbackSessionId(params.group, params.quizId);
  const portalLink = buildPortalLink(params.portalBaseUrl, sessionId);
  const nextStepUrl = params.nextStepUrl ?? "";
  const nextStepText = params.nextStepText ?? "";

  const metaData = {
    group: params.group,
    parent_id: params.parentBatchId,
    batch_id: params.classBatchIds.join(","),
    grade: params.grade,
    course: params.course,
    stream: params.stream,
    // Canonical quiz-creator values (Options.ts). No feedback-specific values.
    test_type: "form",
    test_format: "questionnaire",
    test_purpose: "one_time",
    gurukul_format_type: "qa",
    marking_scheme: "0,0",
    cms_test_id: params.sourceId,
    optional_limits: "N/A",
    has_synced_to_bq: false,
    infinite_session: false,
    report_link: "",
    shortened_link: portalLink,
    shortened_omr_link: "",
    admin_testing_link: "",
    number_of_fields_in_popup_form: "",
    show_answers: true,
    show_scores: false,
    shuffle: false,
    single_page_mode: true,
    single_page_header_text: "Please fill the answers carefully.",
    next_step_url: nextStepUrl,
    next_step_text: nextStepText,
    next_step_autostart: false,
    test_takers_count: 100,
    status: "success",
    date_created: utcToISTDate(new Date().toISOString()),
    created_by: params.createdBy,
    created_from: "lms",
    // Our own traceability namespace (ignored by the ETL).
    feedback_teacher_id: params.feedback.teacherId,
    feedback_teacher_name: params.feedback.teacherName,
    feedback_teacher_order: params.feedback.teacherOrder,
    feedback_cycle_label: params.feedback.cycleLabel,
    feedback_school_code: params.feedback.schoolCode,
  };

  return {
    name: params.name.slice(0, 255),
    platform: "quiz",
    type: "sign-in",
    auth_type: "ID",
    redirection: true,
    id_generation: false,
    signup_form: false,
    popup_form: false,
    signup_form_id: null,
    popup_form_id: null,
    // Pre-filled launch fields (Lambda not in the loop).
    session_id: sessionId,
    platform_id: params.quizId,
    platform_link: params.quizId,
    portal_link: portalLink,
    start_time: utcToISTDate(params.startTimeUtc),
    end_time: utcToISTDate(params.endTimeUtc),
    repeat_schedule: { type: "continuous", params: [1, 2, 3, 4, 5, 6, 7] },
    is_active: true,
    purpose: { type: "attendance", "sub-type": "quiz" },
    meta_data: metaData,
  };
}

export interface CreatedFeedbackSession {
  /** db-service session primary key. */
  sessionPk: number;
  /** The session_id string (group_quizId). */
  sessionId: string;
  /** The student launch URL. */
  portalLink: string;
}

/**
 * Resolve the group id for a batch (POST target for group-session). Mirrors the
 * prototype get_group_id: GET /batch?batch_id=, then GET /group/?child_id=&type=batch.
 */
async function getBatchGroupId(batchId: string): Promise<number> {
  const base = dbBaseUrl();

  const batchResp = await fetch(
    `${base}/batch?batch_id=${encodeURIComponent(batchId)}`,
    { headers: authHeaders(), cache: "no-store" }
  );
  if (!batchResp.ok) {
    throw new Error(`Failed to look up batch ${batchId} (status ${batchResp.status})`);
  }
  const batches = (await batchResp.json()) as Array<{ id: number }>;
  const batch = batches?.[0];
  if (!batch?.id) {
    throw new Error(`Batch ${batchId} not found`);
  }

  const groupResp = await fetch(
    `${base}/group/?child_id=${batch.id}&type=batch`,
    { headers: authHeaders(), cache: "no-store" }
  );
  if (!groupResp.ok) {
    throw new Error(`Failed to look up group for batch ${batchId} (status ${groupResp.status})`);
  }
  const groups = (await groupResp.json()) as Array<{ id: number }>;
  const group = groups?.[0];
  if (!group?.id) {
    throw new Error(`Group for batch ${batchId} not found`);
  }
  return group.id;
}

/**
 * Create one feedback session end-to-end: POST /session, attach to the parent
 * batch's group, and create a session occurrence for the window.
 */
export async function createFeedbackSession(
  params: FeedbackSessionParams
): Promise<CreatedFeedbackSession> {
  const base = dbBaseUrl();
  const payload = buildFeedbackSessionPayload(params);
  const sessionId = payload.session_id as string;
  const portalLink = payload.portal_link as string;

  const sessionResp = await fetch(`${base}/session`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!sessionResp.ok) {
    const errorText = await sessionResp.text();
    console.error("db-service session create error:", sessionResp.status, errorText);
    throw new Error(`Failed to create session (status ${sessionResp.status})`);
  }
  const written = (await sessionResp.json()) as { id: number };
  if (!written?.id) {
    throw new Error("db-service session create returned no id");
  }

  const groupId = await getBatchGroupId(params.parentBatchId);
  const groupSessionResp = await fetch(`${base}/group-session`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ session_id: written.id, group_id: groupId }),
  });
  if (!groupSessionResp.ok) {
    const errorText = await groupSessionResp.text();
    console.error("db-service group-session error:", groupSessionResp.status, errorText);
    throw new Error(`Failed to attach session to group (status ${groupSessionResp.status})`);
  }

  const occurrenceResp = await fetch(`${base}/session-occurrence`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      start_time: utcToISTDate(params.startTimeUtc),
      end_time: utcToISTDate(params.endTimeUtc),
      session_fk: written.id,
      session_id: sessionId,
    }),
  });
  if (!occurrenceResp.ok) {
    const errorText = await occurrenceResp.text();
    console.error("db-service session-occurrence error:", occurrenceResp.status, errorText);
    throw new Error(`Failed to create session occurrence (status ${occurrenceResp.status})`);
  }

  return { sessionPk: written.id, sessionId, portalLink };
}
