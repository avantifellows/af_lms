// Server-only: Holistic Mentorship Dictation (#500, ADR 0012). Turns one
// recorded clip into English text: ElevenLabs Scribe transcribes it, and a
// transcript that is not already English is translated in full through
// OpenRouter. Leaves one content-free Dictation Usage Record per provider
// attempt, and enforces the Mentor's daily limit from those records. Never
// import from client code.

import { query, withTransaction } from "./db";
import { ScribeTranscriptionError, transcribeSpeech, type SpokenLanguage } from "./elevenlabs-scribe";
import {
  DEFAULT_DICTATION_TRANSLATION_MODEL,
  TranslationError,
  translateToEnglish,
} from "./openrouter-translate";
import { isAlreadyEnglishTranscript } from "./transcript-language";
import {
  checkHolisticMentorWriteScope,
  loadHolisticMentorWriteScope,
  type HolisticMentorWriteScopeInput,
} from "./holistic-mentor-write-scope";
import { HOLISTIC_DICTATION_MAX_CLIP_SECONDS } from "./holistic-dictation-limits";

export type HolisticDictationSettings = {
  enabled: boolean;
  /** ElevenLabs key. */
  apiKey: string | null;
  zeroRetention: boolean;
  /** OpenRouter key for the translation into English. */
  translationApiKey: string | null;
  translationModel: string;
};

function envFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function envValue(value: string | undefined): string | null {
  return value?.trim() || null;
}

// Dictation is on only when the flag is on and both keys are set: without the
// OpenRouter key a Hindi clip could not be turned into English, so no mic shows.
export function holisticDictationSettings(): HolisticDictationSettings {
  const apiKey = envValue(process.env.HOLISTIC_DICTATION_ELEVENLABS_API_KEY);
  const translationApiKey = envValue(process.env.HOLISTIC_DICTATION_OPENROUTER_API_KEY);
  return {
    enabled: envFlag(process.env.HOLISTIC_DICTATION_ENABLED) && apiKey !== null && translationApiKey !== null,
    apiKey,
    zeroRetention: envFlag(process.env.HOLISTIC_DICTATION_ELEVENLABS_ZERO_RETENTION),
    translationApiKey,
    translationModel: envValue(process.env.HOLISTIC_DICTATION_TRANSLATION_MODEL)
      ?? DEFAULT_DICTATION_TRANSLATION_MODEL,
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

const HOLISTIC_DICTATION_DAILY_SECONDS = 1_800;
// A clip may start with a few seconds left and run a little past the limit:
// the recorder stops at the remaining time, plus the same 5 s of timer slop.
const DAILY_LIMIT_SLOP_SECONDS = 5;
// All provider work for a clip (Scribe, then any translation) runs against one
// deadline, 27 s after Scribe is called, so the request answers inside
// Amplify's ~30 s limit. Scribe keeps its own 25 s cap, which always leaves the
// first translation attempt at least 2 s. Each translation attempt gets
// min(15 s, time left). A failed first attempt is retried once only when at
// least 5 s are left (translation measured 3-5 s); otherwise the clip fails.
// None of this is tied to the request's signal (see ADR 0012: an abandoned clip
// still finishes and counts).
const PROVIDER_DEADLINE_MS = 27_000;
const SCRIBE_TIMEOUT_MS = 25_000;
const TRANSLATION_ATTEMPT_TIMEOUT_MS = 15_000;
const MIN_TRANSLATION_RETRY_MS = 5_000;
const TRANSLATION_ATTEMPTS = 2;
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

export type HolisticDictationClip = { audio: Blob; filename: string };

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

// not_run: transcription failed or nothing was heard; skipped: already
// English; ok: translated; failed: translation failed.
type TranslationStatus = "not_run" | "skipped" | "ok" | "failed";

type UsageCompletion = {
  outcome: "ok" | "nothing_heard" | "failed";
  charactersReturned: number;
  audioSeconds: number;
  detectedLanguage: string | null;
  translation: TranslationStatus;
};

// Inserted as 'failed' with no completed_at before the provider call, so an
// attempt killed mid-request still counts toward cost and the daily limit.
async function insertUsageRecord(input: TranscribeHolisticDictationInput): Promise<number> {
  const [row] = await query<{ id: number | string }>(
    `INSERT INTO ${USAGE_TABLE}
       (mentor_user_id, school_id, program_id, note_kind, audio_seconds,
        characters_returned, outcome, detected_language, translation,
        completed_at, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 0, 'failed', NULL, 'not_run', NULL,
       $6::timestamptz AT TIME ZONE 'UTC', $6::timestamptz AT TIME ZONE 'UTC')
     RETURNING id`,
    [input.mentorUserId, input.schoolId, input.programId, input.kind,
      audioSecondsFor(input.durationMs), input.now.toISOString()]
  );
  return Number(row.id);
}

async function completeUsageRecord(id: number, usage: UsageCompletion) {
  await query(
    `UPDATE ${USAGE_TABLE}
     SET outcome = $2, characters_returned = $3, audio_seconds = $4,
         detected_language = $5, translation = $6,
         completed_at = now() AT TIME ZONE 'UTC', updated_at = now() AT TIME ZONE 'UTC'
     WHERE id = $1`,
    [id, usage.outcome, usage.charactersReturned, usage.audioSeconds, usage.detectedLanguage, usage.translation]
  );
}

// Logs only which step failed, the failure class and HTTP status (and the
// translation attempt): never the clip, transcript, reply, provider body, key,
// or Student/Question identifiers.
function logProviderFailure(step: "transcription" | "translation", error: unknown, attempt?: number) {
  const failure = error instanceof ScribeTranscriptionError || error instanceof TranslationError
    ? { failureClass: error.failureClass, status: error.status }
    : { failureClass: "unexpected" };
  console.error(`Holistic Dictation ${step} failed`, attempt ? { ...failure, attempt } : failure);
}

// One Scribe call with its own 25 s abort (independent of the request's
// signal); any error is logged and becomes "failed".
async function scribeResult(clip: HolisticDictationClip, settings: HolisticDictationSettings) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRIBE_TIMEOUT_MS);
  try {
    return await transcribeSpeech({
      audio: clip.audio,
      filename: clip.filename,
      apiKey: settings.apiKey ?? "",
      zeroRetention: settings.zeroRetention,
      signal: controller.signal,
    });
  } catch (error) {
    logProviderFailure("transcription", error);
    return { kind: "failed" as const };
  } finally {
    clearTimeout(timeout);
  }
}

// One translation call, aborted at min(15 s, time left before the deadline).
// Returns null (after logging) when it fails any check.
async function translationAttempt(
  text: string,
  settings: HolisticDictationSettings,
  deadline: number,
  attempt: number
): Promise<string | null> {
  const controller = new AbortController();
  const timeLeft = Math.max(0, deadline - Date.now());
  const timeout = setTimeout(() => controller.abort(), Math.min(TRANSLATION_ATTEMPT_TIMEOUT_MS, timeLeft));
  try {
    return await translateToEnglish({
      text,
      apiKey: settings.translationApiKey ?? "",
      model: settings.translationModel,
      signal: controller.signal,
    });
  } catch (error) {
    logProviderFailure("translation", error, attempt);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type HeardText = { text: string } & SpokenLanguage;

// Scribe's language code, lower-cased, for the usage record; null when it is
// missing or longer than the column allows (1-16 characters), so an odd code
// can never stop the record from completing.
function detectedLanguage(languageCode: string | null): string | null {
  const code = languageCode?.toLowerCase() ?? "";
  return code.length >= 1 && code.length <= 16 ? code : null;
}

type EnglishText = { kind: "skipped" | "ok"; text: string } | { kind: "failed" };

// The clip's words in English: unchanged when already English, otherwise a
// translation (retried once if time allows). Never the untranslated text.
async function englishText(
  heard: HeardText,
  settings: HolisticDictationSettings,
  deadline: number
): Promise<EnglishText> {
  if (isAlreadyEnglishTranscript(heard.languageCode, heard.text)) return { kind: "skipped", text: heard.text };
  for (let attempt = 1; attempt <= TRANSLATION_ATTEMPTS; attempt += 1) {
    if (attempt > 1 && deadline - Date.now() < MIN_TRANSLATION_RETRY_MS) break;
    const english = await translationAttempt(heard.text, settings, deadline, attempt);
    if (english !== null) return { kind: "ok", text: english };
  }
  return { kind: "failed" };
}

type ProviderWork = { usage: UsageCompletion; text?: string };

// Scribe, then the translation step, all inside one deadline; what to return
// and what to record.
async function providerWork(
  input: TranscribeHolisticDictationInput,
  settings: HolisticDictationSettings
): Promise<ProviderWork> {
  const deadline = Date.now() + PROVIDER_DEADLINE_MS;
  const heard = await scribeResult(input.clip, settings);
  if (heard.kind !== "text") {
    return {
      usage: {
        outcome: heard.kind === "empty" ? "nothing_heard" : "failed",
        charactersReturned: 0,
        audioSeconds: audioSecondsFor(input.durationMs),
        detectedLanguage: null,
        translation: "not_run",
      },
    };
  }
  const english = await englishText(heard, settings, deadline);
  const heardUsage = {
    audioSeconds: audioSecondsFor(input.durationMs, heard.lastWordEndSeconds),
    detectedLanguage: detectedLanguage(heard.languageCode),
  };
  if (english.kind === "failed") {
    return { usage: { ...heardUsage, outcome: "failed", charactersReturned: 0, translation: "failed" } };
  }
  return {
    text: english.text,
    usage: { ...heardUsage, outcome: "ok", charactersReturned: english.text.length, translation: english.kind },
  };
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
  const { usage, text } = await providerWork(input, settings);
  await completeUsageRecord(recordId, usage);
  const remainingSeconds = await getHolisticDictationRemainingSeconds(input.mentorUserId, input.now);
  // Text is set only for an ok clip; anything else returns no words at all.
  if (text !== undefined) return { outcome: "ok", text, remainingSeconds };
  return { outcome: usage.outcome === "nothing_heard" ? "nothing_heard" : "failed", remainingSeconds };
}
