/**
 * Teacher Feedback — db-service session creation.
 *
 * The LMS records the *intent* (a feedback session per teacher) and lets the
 * sessionCreator Lambda do the rest. The LMS:
 *   1. POSTs a db-service /session with meta_data (test_type 'form',
 *      cms_test_id 'teacher-feedback:v2:...', batch/group/teacher), launch fields
 *      left blank; and
 *   2. publishes an SNS `db_id` message (done by the caller via @/lib/sns).
 * The Lambda then builds the quiz in Mongo from its bundled Teacher Feedback form
 * and fills in session_id / platform_id / portal_link / admin testing link /
 * Firestore. So the LMS no longer needs quiz-backend or portal URLs, and there is
 * no per-teacher chaining (each feedback session stands alone).
 *
 * meta_data uses CANONICAL quiz-creator values only (Options.ts): test_type
 * 'form', test_format 'questionnaire', test_purpose 'one_time'. Feedback rows are
 * identified by cms_test_id (= the source_id, lands on every BigQuery row) plus
 * the lms_teacher_feedback quiz_id list.
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
  /** Program tag, e.g. "EnableStudents" — becomes meta_data.group + BQ `group`. */
  group: string;
  /** Parent (grade) batch id; meta_data.parent_id (best-effort, group attach). */
  parentBatchId: string;
  /** Class (child) batch ids; comma-joined into meta_data.batch_id + BQ `batch`. */
  classBatchIds: string[];
  /** Grade as integer (informational form metadata only). */
  grade: number;
  /** Canonical stream matching the batch, or "" if unknown. */
  stream: string;
  /** Canonical course matching the batch, or "" if unknown. */
  course: string;
  /**
   * Stable source identifier, "teacher-feedback:v2:<school>:<cycle>". Stamped as
   * meta_data.cms_test_id — this is what the sessionCreator Lambda matches to
   * build the bundled Teacher Feedback quiz, and what lands on every BigQuery row.
   */
  sourceId: string;
  /** ISO UTC start/end of the response window. */
  startTimeUtc: string;
  endTimeUtc: string;
  /** Human-readable session name (e.g. "Student Feedback - Jun 2026 - JNV Palghar - Manjit Kumar"). */
  name: string;
  /** Email of the PM/admin creating this. */
  createdBy: string;
  /** Our own traceability fields (not consumed by the ETL). */
  feedback: {
    teacherId: string | null;
    teacherName: string;
    teacherOrder: number;
    cycleLabel: string;
    schoolCode: string;
  };
}

/**
 * Build the db-service `/session` POST payload. Pure — no I/O — so it is unit
 * testable. Launch fields (session_id/platform_id/portal_link) are left blank;
 * the sessionCreator Lambda fills them after building the quiz.
 */
export function buildFeedbackSessionPayload(
  params: FeedbackSessionParams
): Record<string, unknown> {
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
    // The Lambda matches this prefix to build the bundled Teacher Feedback quiz.
    cms_test_id: params.sourceId,
    optional_limits: "N/A",
    has_synced_to_bq: false,
    infinite_session: false,
    report_link: "",
    shortened_link: "",
    shortened_omr_link: "",
    admin_testing_link: "",
    number_of_fields_in_popup_form: "",
    show_answers: true,
    show_scores: false,
    shuffle: false,
    single_page_mode: true,
    single_page_header_text: "Please fill the answers carefully.",
    next_step_url: "",
    next_step_text: "",
    next_step_autostart: false,
    test_takers_count: 100,
    status: "pending",
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
    // Launch fields filled by the Lambda after it builds the quiz.
    session_id: "",
    platform_id: "",
    platform_link: "",
    portal_link: "",
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
}

/**
 * Create one feedback session row in db-service. Returns its primary key. The
 * quiz, links, and Firestore are built asynchronously by the sessionCreator
 * Lambda once the caller publishes an SNS `db_id` for this session pk.
 */
export async function createFeedbackSession(
  params: FeedbackSessionParams
): Promise<CreatedFeedbackSession> {
  const base = dbBaseUrl();
  const payload = buildFeedbackSessionPayload(params);

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

  return { sessionPk: written.id };
}
