import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, withTransaction } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  activeBlendedMappingSql,
  canAccessBlendedStudent,
  canBlendedLearning,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import { blendedLearningRecordingPrefix, headObject, presignUpload } from "./s3";

// Call Recording upload and Conversation Draft use cases (server-only). The
// browser PUTs a recording straight to S3 with a presigned URL, then asks for
// a draft; etl-next transcribes and drafts it (ADR 0009). Drafts never touch
// Last Contact, Talk to First, counts or flags: those read Conversations only.

const MAX_RECORDING_BYTES = 200 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const RECORDING_TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };

type Failure = { ok: false; status: 403 | 404 | 409 | 422; error: string; fieldErrors?: Record<string, string> };

type RecordingUpload = { uploadUrl: string; s3Key: string; contentType: string };

function recordingExtension(fileName: unknown): string | null {
  if (typeof fileName !== "string") return null;
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  const extension = match?.[1].toLowerCase();
  return extension && RECORDING_TYPES[extension] ? extension : null;
}

async function openDraftId(studentId: number): Promise<number | null> {
  const rows = await query<{ id: number | string }>(
    `SELECT draft.id
     FROM blended_learning_conversation_drafts draft
     WHERE draft.student_id = $1 AND draft.state IN ('transcribing', 'ready', 'failed')
     LIMIT 1`,
    [studentId]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

// Issue a presigned PUT for one Call Recording. The type comes from the file
// extension, because phones often send an empty or odd MIME type.
export async function issueRecordingUpload(
  access: BlendedLearningAccess,
  studentId: number,
  raw: unknown
): Promise<{ ok: true; upload: RecordingUpload } | Failure> {
  if (!canBlendedLearning(access, "upload")) return { ok: false, status: 403, error: "Forbidden" };
  if (!(await canAccessBlendedStudent(access, studentId))) return { ok: false, status: 404, error: "Not found" };

  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const extension = recordingExtension(body.fileName);
  if (!extension) return { ok: false, status: 422, error: "Choose an MP3, M4A or WAV recording." };
  const size = body.byteSize;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_RECORDING_BYTES) {
    return { ok: false, status: 422, error: "A recording must be 200 MB or smaller." };
  }
  if ((await openDraftId(studentId)) !== null) {
    return { ok: false, status: 409, error: "This Mentee already has a Conversation Draft." };
  }

  const contentType = RECORDING_TYPES[extension];
  const s3Key = `${blendedLearningRecordingPrefix(studentId)}${randomUUID()}.${extension}`;
  const uploadUrl = await presignUpload({ s3Key, contentType, ttlSeconds: UPLOAD_URL_TTL_SECONDS });
  return { ok: true, upload: { uploadUrl, s3Key, contentType } };
}

// --- Draft creation ----------------------------------------------------------

// The part of a recording key after the Student's prefix: `{uuid}.{ext}`.
const RECORDING_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|m4a|wav)$/;
const MODES = ["call", "in_person"] as const;
const SPOKE_WITH = ["student", "parent_or_sibling", "both"] as const;

// Optional session details the Mentor had entered before uploading.
type SessionDetails = {
  occurredOn: string | null;
  mode: (typeof MODES)[number] | null;
  spokeWith: (typeof SPOKE_WITH)[number] | null;
  durationMinutes: number | null;
};

export type WakeDelivery = "sent" | "skipped" | "ambiguous" | "rejected";

function absent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

// The content type a recording was uploaded with, or null for a key that is
// not under this Student's recordings prefix.
function recordingKeyContentType(studentId: number, key: unknown): string | null {
  const prefix = blendedLearningRecordingPrefix(studentId);
  if (typeof key !== "string" || !key.startsWith(prefix)) return null;
  const match = RECORDING_FILE.exec(key.slice(prefix.length));
  return match ? RECORDING_TYPES[match[1]] : null;
}

// `today` is the IST calendar date; a session can be dated today or earlier.
function validateSessionDetails(
  body: Record<string, unknown>,
  today: string
): { ok: true; details: SessionDetails } | { ok: false; fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const { occurredOn, mode, spokeWith, durationMinutes } = body;
  if (!absent(occurredOn) && !isCalendarDate(occurredOn)) errors.occurredOn = "Enter a valid date.";
  else if (isCalendarDate(occurredOn) && occurredOn > today) errors.occurredOn = "The date can't be in the future.";
  if (!absent(mode) && !oneOf(MODES, mode)) errors.mode = "Choose call or in person.";
  if (!absent(spokeWith) && !oneOf(SPOKE_WITH, spokeWith)) errors.spokeWith = "Choose who you spoke with.";
  if (
    !absent(durationMinutes) &&
    (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 240)
  ) {
    errors.durationMinutes = "Duration must be between 1 and 240 minutes.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    details: {
      occurredOn: absent(occurredOn) ? null : (occurredOn as string),
      mode: absent(mode) ? null : (mode as SessionDetails["mode"]),
      spokeWith: absent(spokeWith) ? null : (spokeWith as SessionDetails["spokeWith"]),
      durationMinutes: absent(durationMinutes) ? null : (durationMinutes as number),
    },
  };
}

type MappingSnapshot = { mentor_user_id: number | string; program_id: number | string; academic_year: string };

// The active current-year Mapping, re-read and locked inside the transaction.
async function lockActiveMapping(client: PoolClient, studentId: number): Promise<MappingSnapshot | null> {
  const result = await client.query<MappingSnapshot>(
    `SELECT mapping.mentor_user_id, mapping.program_id, mapping.academic_year
     FROM blended_learning_mentor_mentee_mappings mapping
     WHERE mapping.student_id = $1 AND ${activeBlendedMappingSql("mapping", "$2")}
     LIMIT 1
     FOR SHARE`,
    [studentId, CURRENT_ACADEMIC_YEAR]
  );
  return result.rows[0] ?? null;
}

class OutOfScope extends Error {}

function invalid(fieldErrors: Record<string, string>): Failure {
  const [first] = Object.values(fieldErrors);
  return { ok: false, status: 422, error: first, fieldErrors };
}

// Create the Conversation Draft for an uploaded Call Recording, with its
// queued Transcription Request, then wake etl-next.
export async function createDraft(
  access: BlendedLearningAccess,
  studentId: number,
  raw: unknown,
  today: string
): Promise<{ ok: true; draftId: number; delivery: WakeDelivery } | Failure> {
  if (!canBlendedLearning(access, "upload")) return { ok: false, status: 403, error: "Forbidden" };
  if (!(await canAccessBlendedStudent(access, studentId))) return { ok: false, status: 404, error: "Not found" };

  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const contentType = recordingKeyContentType(studentId, body.s3Key);
  if (!contentType) return invalid({ s3Key: "This recording isn't this Mentee's. Upload it again." });
  const s3Key = body.s3Key as string;
  const session = validateSessionDetails(body, today);
  if (!session.ok) return invalid(session.fieldErrors);
  const stored = await headObject(s3Key);
  if (!stored || stored.byteSize !== body.byteSize) {
    return invalid({ s3Key: "The recording didn't finish uploading. Upload it again." });
  }

  let created: { draftId: number; requestKey: string };
  try {
    created = await withTransaction(async (client) => {
      const mapping = await lockActiveMapping(client, studentId);
      if (!mapping) throw new OutOfScope();
      if (access.kind === "mentor" && Number(mapping.mentor_user_id) !== access.mentorUserId) throw new OutOfScope();
      const { details } = session;
      const draft = await client.query<{ id: number | string }>(
        `INSERT INTO blended_learning_conversation_drafts (student_id, program_id, academic_year, mentor_user_id, created_by_user_id, created_by_email, state, occurred_on, mode, spoke_with, duration_minutes, call_recording_s3_key, recording_content_type, recording_byte_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          studentId,
          Number(mapping.program_id),
          mapping.academic_year,
          Number(mapping.mentor_user_id),
          access.actorUserId,
          access.actorEmail,
          "transcribing",
          details.occurredOn,
          details.mode,
          details.spokeWith,
          details.durationMinutes,
          s3Key,
          contentType,
          stored.byteSize,
        ]
      );
      const draftId = Number(draft.rows[0].id);
      const requestKey = randomUUID();
      await client.query(
        `INSERT INTO blended_learning_transcription_requests (request_key, draft_id, student_id, requested_by_user_id, requested_by_email, state)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [requestKey, draftId, studentId, access.actorUserId, access.actorEmail, "queued"]
      );
      return { draftId, requestKey };
    });
  } catch (error) {
    if (error instanceof OutOfScope) return { ok: false, status: 404, error: "Not found" };
    if ((error as { code?: unknown } | null)?.code === "23505") {
      return { ok: false, status: 409, error: "This Mentee already has a Conversation Draft." };
    }
    throw error;
  }

  const delivery = await wakeTranscription(created.requestKey);
  return { ok: true, draftId: created.draftId, delivery };
}

// --- Waking etl-next ---------------------------------------------------------

// Ask etl-next to drain one queued Transcription Request, the way Holistic
// Profile regeneration does. Never throws on delivery problems.
export async function wakeTranscription(requestKey: string): Promise<WakeDelivery> {
  const base = process.env.BLENDED_LEARNING_ETL_URL?.trim().replace(/\/+$/, "");
  const token = process.env.BLENDED_LEARNING_ETL_TOKEN?.trim();
  const environment = process.env.APP_ENV;
  if (!base || !token || (environment !== "staging" && environment !== "production")) return "skipped";

  let response: Response;
  try {
    response = await fetch(
      `${base}/api/internal/blended-learning/transcription-requests/${encodeURIComponent(requestKey)}/enqueue`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ environment }),
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch {
    // It may or may not have arrived; the request stays queued for a retry.
    return "ambiguous";
  }
  if (response.ok) return "sent";
  const permanentRejection = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
  if (!permanentRejection) return "ambiguous";

  // ETL refused it for good: fail the request, and the draft if nothing has
  // moved it on, so the Mentor sees "Drafting failed" and can retry.
  await withTransaction(async (client) => {
    const failed = await client.query<{ draft_id: number | string }>(
      `UPDATE blended_learning_transcription_requests
       SET state = $2, etl_run_id = $3, error_code = $4, error_message = $5, updated_at = now()
       WHERE request_key = $1 AND state = 'queued' AND etl_run_id IS NULL
       RETURNING draft_id`,
      [requestKey, "failed", `rejected-${requestKey}`, "enqueue_rejected", "ETL rejected the transcription request"]
    );
    for (const row of failed.rows) {
      await client.query(
        `UPDATE blended_learning_conversation_drafts
         SET state = $2, updated_at = now()
         WHERE id = $1 AND state = 'transcribing'`,
        [Number(row.draft_id), "failed"]
      );
    }
  });
  return "rejected";
}

// --- Draft status, retry and discard ---------------------------------------

export type DraftState = "transcribing" | "ready" | "failed" | "discarded" | "saved";
type DraftStatus = { id: number; state: DraftState; retryOffered: boolean };

type DraftRow = {
  id: number | string;
  student_id: number | string;
  state: DraftState;
  request_key: string | null;
  request_state: string | null;
  etl_run_id: string | null;
};

// One draft with its active (queued or running) Transcription Request, if
// any. Null when there is no such draft or it is out of scope.
async function readDraft(access: BlendedLearningAccess, draftId: number): Promise<DraftRow | null> {
  if (!Number.isSafeInteger(draftId) || draftId <= 0) return null;
  const rows = await query<DraftRow>(
    `SELECT draft.id, draft.student_id, draft.state,
            request.request_key, request.state AS request_state, request.etl_run_id
     FROM blended_learning_conversation_drafts draft
     LEFT JOIN blended_learning_transcription_requests request
       ON request.draft_id = draft.id AND request.state IN ('queued', 'running')
     WHERE draft.id = $1
     LIMIT 1`,
    [draftId]
  );
  const draft = rows[0];
  if (!draft || !(await canAccessBlendedStudent(access, Number(draft.student_id)))) return null;
  return draft;
}

// Transcribing, but its request is still queued with no ETL run: the wake
// never reached ETL.
function wakeNeverArrived(draft: DraftRow): boolean {
  return draft.state === "transcribing" && draft.request_state === "queued" && draft.etl_run_id === null;
}

function draftStatus(access: BlendedLearningAccess, draft: DraftRow): DraftStatus {
  const retryable = draft.state === "failed" || wakeNeverArrived(draft);
  return { id: Number(draft.id), state: draft.state, retryOffered: retryable && canBlendedLearning(access, "manage_draft") };
}

// One draft's state, for the detail page's polling. "Retry drafting" is
// offered to those who can manage drafts when the draft failed, or when the
// wake never reached ETL. Null when the draft is out of scope.
export async function getDraftStatus(access: BlendedLearningAccess, draftId: number): Promise<DraftStatus | null> {
  const draft = await readDraft(access, draftId);
  return draft ? draftStatus(access, draft) : null;
}

class Conflict extends Error {}

const NOT_RETRYABLE: Failure = { ok: false, status: 409, error: "This draft can't be retried now." };

// "Retry drafting". A wake that never reached ETL is sent again with the same
// request key. A failed draft gets a new Transcription Request and moves back
// to transcribing in one transaction, then ETL is woken. Anything else is 409.
export async function retryDrafting(
  access: BlendedLearningAccess,
  draftId: number
): Promise<{ ok: true; draft: DraftStatus; delivery: WakeDelivery } | Failure> {
  if (!canBlendedLearning(access, "manage_draft")) return { ok: false, status: 403, error: "Forbidden" };
  const draft = await readDraft(access, draftId);
  if (!draft) return { ok: false, status: 404, error: "Not found" };

  let requestKey: string;
  if (wakeNeverArrived(draft) && draft.request_key) {
    requestKey = draft.request_key;
  } else if (draft.state === "failed") {
    try {
      requestKey = await withTransaction(async (client) => {
        const moved = await client.query(
          `UPDATE blended_learning_conversation_drafts
           SET state = $2, updated_at = now()
           WHERE id = $1 AND state = 'failed'
           RETURNING id`,
          [draftId, "transcribing"]
        );
        if (moved.rows.length === 0) throw new Conflict();
        const key = randomUUID();
        await client.query(
          `INSERT INTO blended_learning_transcription_requests (request_key, draft_id, student_id, requested_by_user_id, requested_by_email, state)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [key, draftId, Number(draft.student_id), access.actorUserId, access.actorEmail, "queued"]
        );
        return key;
      });
    } catch (error) {
      if (error instanceof Conflict || (error as { code?: unknown } | null)?.code === "23505") return NOT_RETRYABLE;
      throw error;
    }
  } else {
    return NOT_RETRYABLE;
  }

  const delivery = await wakeTranscription(requestKey);
  const status = await getDraftStatus(access, draftId);
  if (!status) return { ok: false, status: 404, error: "Not found" };
  return { ok: true, draft: status, delivery };
}

// Discard an open draft (transcribing, ready or failed). That frees the Mentee
// for a new upload or a hand-logged Conversation. If ETL finishes later,
// db-service leaves a discarded draft alone. Anything else is 409.
export async function discardDraft(
  access: BlendedLearningAccess,
  draftId: number
): Promise<{ ok: true; draft: { id: number; state: "discarded" } } | Failure> {
  if (!canBlendedLearning(access, "manage_draft")) return { ok: false, status: 403, error: "Forbidden" };
  if (!(await readDraft(access, draftId))) return { ok: false, status: 404, error: "Not found" };

  const discarded = await query<{ id: number | string }>(
    `UPDATE blended_learning_conversation_drafts
     SET state = $2, discarded_at = now(), updated_at = now()
     WHERE id = $1 AND state IN ('transcribing', 'ready', 'failed')
     RETURNING id`,
    [draftId, "discarded"]
  );
  if (discarded.length === 0) return { ok: false, status: 409, error: "This draft can't be discarded now." };
  return { ok: true, draft: { id: draftId, state: "discarded" } };
}
