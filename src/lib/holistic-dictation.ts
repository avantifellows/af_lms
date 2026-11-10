// Server-only: Holistic Mentorship Dictation (#500, ADR 0012). Turns one
// recorded clip into verbatim text through ElevenLabs Scribe, leaves one
// content-free Dictation Usage Record per provider attempt, and enforces the
// Mentor's daily limit from those records. Never import from client code.

import { query, withTransaction } from "./db";
import { ScribeTranscriptionError, transcribeSpeech } from "./elevenlabs-scribe";
import {
  checkHolisticMentorWriteScope,
  loadHolisticMentorWriteScope,
  type HolisticMentorWriteScopeInput,
} from "./holistic-mentor-write-scope";

export type HolisticDictationSettings = {
  enabled: boolean;
  apiKey: string | null;
  zeroRetention: boolean;
};

function envFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

// Dictation is on only when the flag is on and a key is set.
export function holisticDictationSettings(): HolisticDictationSettings {
  const apiKey = process.env.HOLISTIC_DICTATION_ELEVENLABS_API_KEY?.trim() || null;
  return {
    enabled: envFlag(process.env.HOLISTIC_DICTATION_ENABLED) && apiKey !== null,
    apiKey,
    zeroRetention: envFlag(process.env.HOLISTIC_DICTATION_ELEVENLABS_ZERO_RETENTION),
  };
}

export type HolisticDictationKind = "post_session" | "follow_up";

export type HolisticDictationScopeInput = HolisticMentorWriteScopeInput & {
  actorUserId: number;
  kind: HolisticDictationKind;
};

export type HolisticDictationRefusal = { ok: false; status: 404 | 422; error: string };

// The Mentor's write scope (Phase open and applicable, Student not a dropout,
// no privacy tombstone), plus submitted Notes for a Follow-up clip. Its own
// short transaction commits before any provider call, so no row lock is held
// while ElevenLabs transcribes.
export function checkHolisticDictationScope(
  input: HolisticDictationScopeInput
): Promise<HolisticDictationRefusal | null> {
  return withTransaction(async (client) => {
    const scope = await loadHolisticMentorWriteScope(client, input);
    const scopeError = checkHolisticMentorWriteScope(scope, input.actorUserId);
    if (scopeError) return scopeError;
    if (input.kind !== "follow_up") return null;
    const notes = await client.query<{ state: string }>(
      `SELECT state FROM holistic_mentorship_post_session_notes
       WHERE student_id = $1 AND phase_id = $2`,
      [input.studentId, input.phaseId]
    );
    return notes.rows[0]?.state === "submitted"
      ? null
      : { ok: false, status: 422, error: "Submit Post-Session Notes first" };
  });
}

export const HOLISTIC_DICTATION_DAILY_SECONDS = 1_800;
export const HOLISTIC_DICTATION_MAX_CLIP_SECONDS = 125;
// A clip may start with a few seconds left and run a little past the limit:
// the recorder stops at the remaining time, plus the same 5 s of timer slop.
const DAILY_LIMIT_SLOP_SECONDS = 5;
const PROVIDER_TIMEOUT_MS = 25_000;
const USAGE_TABLE = "holistic_mentorship_dictation_usage_records";

// The usage columns are naive UTC timestamps, so the India-time day is turned
// into a UTC window before comparing.
const INDIA_DAY_START = `((date_trunc('day', $2::timestamptz AT TIME ZONE 'Asia/Kolkata')
  AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC')`;

async function usedSecondsToday(mentorUserId: number, now: Date): Promise<number> {
  const [row] = await query<{ used_seconds: number | string | null }>(
    `SELECT COALESCE(SUM(audio_seconds), 0) AS used_seconds
     FROM ${USAGE_TABLE}
     WHERE mentor_user_id = $1
       AND inserted_at >= ${INDIA_DAY_START}
       AND inserted_at < ${INDIA_DAY_START} + interval '1 day'`,
    [mentorUserId, now.toISOString()]
  );
  return Number(row?.used_seconds ?? 0);
}

// 1,800 s minus what this Mentor recorded in today's India-time day, never below 0.
export async function getHolisticDictationRemainingSeconds(
  mentorUserId: number,
  now: Date
): Promise<number> {
  return Math.max(0, HOLISTIC_DICTATION_DAILY_SECONDS - await usedSecondsToday(mentorUserId, now));
}

function audioSecondsFor(durationMs: number, lastWordEndSeconds = 0): number {
  const seconds = Math.ceil(Math.max(durationMs / 1000, lastWordEndSeconds));
  return Math.min(HOLISTIC_DICTATION_MAX_CLIP_SECONDS, Math.max(1, seconds));
}

export type HolisticDictationClip = { audio: Blob; filename: string; contentType: string };

export type TranscribeHolisticDictationInput = {
  mentorUserId: number;
  schoolId: number;
  programId: number;
  kind: HolisticDictationKind;
  clip: HolisticDictationClip;
  durationMs: number;
  now: Date;
};

export type HolisticDictationOutcome =
  | { outcome: "ok"; text: string; remainingSeconds: number }
  | { outcome: "nothing_heard"; remainingSeconds: number }
  | { outcome: "failed"; remainingSeconds: number }
  | { outcome: "daily_limit"; remainingSeconds: number };

// Inserted as 'failed' with no completed_at before the provider call, so an
// attempt killed mid-request still counts toward cost and the daily limit.
async function insertUsageRecord(input: TranscribeHolisticDictationInput): Promise<number> {
  const [row] = await query<{ id: number | string }>(
    `INSERT INTO ${USAGE_TABLE}
       (mentor_user_id, school_id, program_id, note_kind, audio_seconds,
        characters_returned, outcome, completed_at, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 0, 'failed', NULL,
       $6::timestamptz AT TIME ZONE 'UTC', $6::timestamptz AT TIME ZONE 'UTC')
     RETURNING id`,
    [input.mentorUserId, input.schoolId, input.programId, input.kind,
      audioSecondsFor(input.durationMs), input.now.toISOString()]
  );
  return Number(row.id);
}

async function completeUsageRecord(
  id: number,
  outcome: HolisticDictationOutcome["outcome"],
  charactersReturned: number,
  audioSeconds: number
) {
  await query(
    `UPDATE ${USAGE_TABLE}
     SET outcome = $2, characters_returned = $3, audio_seconds = $4,
         completed_at = now() AT TIME ZONE 'UTC', updated_at = now() AT TIME ZONE 'UTC'
     WHERE id = $1`,
    [id, outcome, charactersReturned, audioSeconds]
  );
}

async function callScribe(clip: HolisticDictationClip, settings: HolisticDictationSettings) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await transcribeSpeech({
      audio: clip.audio,
      filename: clip.filename,
      contentType: clip.contentType,
      apiKey: settings.apiKey ?? "",
      zeroRetention: settings.zeroRetention,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// Logs only the failure class and HTTP status: never the clip, text, provider
// body, key, or Student/Question identifiers.
function logProviderFailure(error: unknown) {
  const failure = error instanceof ScribeTranscriptionError
    ? { failureClass: error.failureClass, status: error.status }
    : { failureClass: "unexpected" };
  console.error("Holistic Dictation transcription failed", failure);
}

async function providerResult(clip: HolisticDictationClip, settings: HolisticDictationSettings) {
  try {
    return await callScribe(clip, settings);
  } catch (error) {
    logProviderFailure(error);
    return { kind: "failed" as const };
  }
}

export async function transcribeHolisticDictation(
  input: TranscribeHolisticDictationInput
): Promise<HolisticDictationOutcome> {
  // Not atomic with the insert: two tabs racing at the cap can each overshoot
  // by one clip. Accepted (#500).
  const usedSeconds = await usedSecondsToday(input.mentorUserId, input.now);
  const clipSeconds = Math.ceil(input.durationMs / 1000);
  if (usedSeconds + clipSeconds > HOLISTIC_DICTATION_DAILY_SECONDS + DAILY_LIMIT_SLOP_SECONDS) {
    return {
      outcome: "daily_limit",
      remainingSeconds: Math.max(0, HOLISTIC_DICTATION_DAILY_SECONDS - usedSeconds),
    };
  }
  const settings = holisticDictationSettings();
  const recordId = await insertUsageRecord(input);
  const result = await providerResult(input.clip, settings);
  const remaining = () => getHolisticDictationRemainingSeconds(input.mentorUserId, input.now);
  if (result.kind === "text") {
    await completeUsageRecord(recordId, "ok", result.text.length,
      audioSecondsFor(input.durationMs, result.lastWordEndSeconds));
    return { outcome: "ok", text: result.text, remainingSeconds: await remaining() };
  }
  const outcome = result.kind === "empty" ? "nothing_heard" : "failed";
  await completeUsageRecord(recordId, outcome, 0, audioSecondsFor(input.durationMs));
  return { outcome, remainingSeconds: await remaining() };
}
