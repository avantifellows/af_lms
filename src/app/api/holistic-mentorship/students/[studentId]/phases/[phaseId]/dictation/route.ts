import { NextRequest, NextResponse } from "next/server";

import {
  checkHolisticDictationScope,
  holisticDictationSettings,
  transcribeHolisticDictation,
  type HolisticDictationKind,
} from "@/lib/holistic-dictation";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import { authenticatedTarget, type RouteParams } from "../student-phase-target";

const ACCESS_ACTION = {
  post_session: "notes_draft",
  follow_up: "follow_up_note_add",
} as const satisfies Record<HolisticDictationKind, string>;

async function readForm(request: NextRequest): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function dictationKind(value: FormDataEntryValue | null): HolisticDictationKind | null {
  return value === "post_session" || value === "follow_up" ? value : null;
}

const ALLOWED_AUDIO_TYPES = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg"]);
const MAX_CLIP_BYTES = 5 * 1024 * 1024;
// Two minutes plus 5 s of client timer slop.
const MAX_DURATION_MS = 125_000;
const FALLBACK_EXTENSION: Record<string, string> = {
  "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3",
};

type ValidClip = { audio: Blob; filename: string; contentType: string; durationMs: number };

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function validateClip(form: FormData): { ok: true; clip: ValidClip } | { ok: false; response: NextResponse } {
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return { ok: false, response: refuse("Attach one audio clip", 422) };
  // Ignore codec parameters: "audio/webm;codecs=opus" is "audio/webm".
  const contentType = audio.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
    return { ok: false, response: refuse("Unsupported audio type", 415) };
  }
  if (audio.size > MAX_CLIP_BYTES) return { ok: false, response: refuse("Audio clip is too large", 413) };
  const rawDuration = form.get("duration_ms");
  const durationMs = typeof rawDuration === "string" && /^\d+$/.test(rawDuration) ? Number(rawDuration) : 0;
  if (durationMs < 1 || durationMs > MAX_DURATION_MS) {
    return { ok: false, response: refuse("Invalid recording duration", 422) };
  }
  const name = audio instanceof File && audio.name ? audio.name : "";
  const filename = name || `dictation.${FALLBACK_EXTENSION[contentType]}`;
  return { ok: true, clip: { audio, filename, contentType, durationMs } };
}

// Dictation (#500): one recorded clip in, verbatim text out. The route only
// parses, gates and maps; the Holistic Dictation module does the work.
export async function POST(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const parsed = await authenticatedTarget(request, params);
  if (!parsed.ok) return parsed.response;
  const { session, target } = parsed;

  if (!holisticDictationSettings().enabled) {
    return refuse("Not found", 404);
  }

  // The kind picks the access action, so it is read before the access check.
  const form = await readForm(request);
  const kind = form ? dictationKind(form.get("kind")) : null;
  if (!form || !kind) return refuse("Invalid request body", 422);

  const access = await requireHolisticMentorshipAccess(session, ACCESS_ACTION[kind], {
    schoolCode: target.schoolCode,
    studentId: target.studentId,
    academicYear: target.academicYear,
    programId: target.programId,
  });
  if (!access.ok) return refuse(access.error, access.status);
  const mentorUserId = access.actorUserId!;
  const schoolId = access.school!.id;

  const refusal = await checkHolisticDictationScope({
    studentId: target.studentId,
    phaseId: target.phaseId,
    schoolId,
    programId: target.programId,
    academicYear: target.academicYear,
    actorUserId: mentorUserId,
    kind,
  });
  if (refusal) return refuse(refusal.error, refusal.status);

  const valid = validateClip(form);
  if (!valid.ok) return valid.response;
  const { durationMs, ...clip } = valid.clip;

  const result = await transcribeHolisticDictation({
    mentorUserId,
    schoolId,
    programId: target.programId,
    kind,
    clip,
    durationMs,
    now: new Date(),
  });
  // The refused clip leaves no usage record; remainingSeconds is the Mentor's
  // real time left, so a page with a stale count can correct it.
  if (result.outcome === "daily_limit") {
    return NextResponse.json(
      { error: "You've used today's Dictation time", code: "daily_limit", remainingSeconds: result.remainingSeconds },
      { status: 429 }
    );
  }
  return result.outcome === "failed"
    ? NextResponse.json(
      { error: "Couldn't transcribe. Try again", remainingSeconds: result.remainingSeconds },
      { status: 502 }
    )
    : NextResponse.json(result);
}
