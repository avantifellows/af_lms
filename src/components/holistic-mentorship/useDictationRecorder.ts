import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// What the server-rendered Student Phase page tells the client about
// Dictation (#500). The client never reads the HOLISTIC_DICTATION_* settings.
export type DictationAvailability = { enabled: boolean; remainingSeconds: number };

export const DICTATION_OFF: DictationAvailability = { enabled: false, remainingSeconds: 0 };

// The page's one count of today's remaining Dictation time. Every recorder on
// the page reads it and reports what the server says after each clip.
export type SharedDictationAvailability = DictationAvailability & {
  onRemainingSeconds: (seconds: number) => void;
};

// Post-Session Notes and the Follow-up Note form each own a recorder but spend
// the same daily limit, so the count lives above both. A new count from the
// server (the page refreshed) replaces what the recorders reported.
export function useSharedDictationAvailability(server: DictationAvailability): SharedDictationAvailability {
  const [serverSeconds, setServerSeconds] = useState(server.remainingSeconds);
  const [remainingSeconds, setRemainingSeconds] = useState(server.remainingSeconds);
  if (serverSeconds !== server.remainingSeconds) {
    setServerSeconds(server.remainingSeconds);
    setRemainingSeconds(server.remainingSeconds);
  }
  return useMemo(
    () => ({ enabled: server.enabled, remainingSeconds, onRemainingSeconds: setRemainingSeconds }),
    [server.enabled, remainingSeconds]
  );
}

// One recorder per form; `target` names the answer box being dictated into.
export type DictationState =
  | { kind: "idle" }
  | { kind: "requesting_mic"; target: string }
  | { kind: "recording"; target: string; startedAt: number; stopAtMs: number }
  | { kind: "transcribing"; target: string }
  | { kind: "failed"; target: string; clip: Blob; durationMs: number } // Retry resends clip
  | { kind: "notice"; target: string; message: string }               // mic blocked/missing, unsupported, nothing heard, auto-stopped, too long
  // Today's Dictation time is used up: every mic in the form stops accepting
  // recordings. `target` is the box whose clip found out (null at page load);
  // `note` is that clip's own message, shown before the limit message.
  | { kind: "unavailable"; reason: "daily_limit"; target: string | null; note: string | null };

export type DictationKind = "post_session" | "follow_up";

// Called with the transcribed words when the response arrives. Returns a
// message to show under the box when the words could not be added.
export type ApplyDictationText = (target: string, text: string) => string | null;

export type DictationRecorder = {
  state: DictationState;
  elapsedMs: number;
  toggle: (target: string) => void;
  /** Resends a failed clip, with its duration, without re-recording. */
  retry: () => void;
  /** Stops any recording, releases the mic, drops a failed clip, and ignores a transcription still in flight. */
  discard: () => void;
};

const MAX_CLIP_SECONDS = 120;
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];
const AUDIO_BITS_PER_SECOND = 32_000;
const FILE_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3",
};

function recorderOptions(): MediaRecorderOptions {
  const mimeType = PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
  return mimeType
    ? { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND }
    : { audioBitsPerSecond: AUDIO_BITS_PER_SECOND };
}

function clipFilename(clip: Blob) {
  return `dictation.${FILE_EXTENSIONS[clip.type.split(";")[0].trim()] ?? "webm"}`;
}

function autoStopNotice(stopAtSeconds: number) {
  return stopAtSeconds >= MAX_CLIP_SECONDS
    ? "Recording stopped at 2 minutes."
    : "Recording stopped: today's Dictation time ran out.";
}

type Stop = { durationMs: number; notice: string | null };

type DictationReply = {
  status: number;
  body: { outcome?: string; text?: string; remainingSeconds?: number; code?: string } | null;
};

async function postClip(
  request: { url: string; kind: DictationKind },
  clip: Blob,
  durationMs: number,
  signal: AbortSignal
): Promise<DictationReply> {
  const form = new FormData();
  form.append("audio", clip, clipFilename(clip));
  form.append("kind", request.kind);
  form.append("duration_ms", String(durationMs));
  try {
    const response = await fetch(request.url, { method: "POST", body: form, signal });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    // A network failure is treated the same as a 502.
    return { status: 0, body: null };
  }
}

// Today's remaining time as the server reports it, or null when it didn't say.
function remainingAfter({ status, body }: DictationReply): number | null {
  if (status === 429 && body?.code === "daily_limit") return 0;
  return typeof body?.remainingSeconds === "number" ? body.remainingSeconds : null;
}

function replyText({ status, body }: DictationReply): string | null {
  const ok = status === 200 && body?.outcome === "ok";
  return ok && typeof body.text === "string" ? body.text : null;
}

function heardNothing({ status, body }: DictationReply) {
  return status === 200 && body?.outcome === "nothing_heard";
}

// Messages shown under the box when Dictation can't produce text. They live
// here so every form that dictates (Post-Session and Follow-up) shows the same words.
export const DICTATION_MESSAGES = {
  denied: "Microphone is blocked. Allow microphone access for this site in your browser settings, "
    + "then try again. You can keep typing.",
  noMic: "No microphone found. You can keep typing.",
  unsupported: "This browser can't record audio. You can keep typing.",
  micFailed: "Couldn't start the microphone. Try again, or keep typing.",
  failed: "Couldn't transcribe. Try again",
  nothingHeard: "Didn't catch anything. Try speaking closer to the mic or a little louder.",
  dailyLimit: "You've used today's 30 minutes of Dictation. You can keep typing.",
} as const;

function micErrorMessage(error: unknown) {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return DICTATION_MESSAGES.denied;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return DICTATION_MESSAGES.noMic;
  }
  return DICTATION_MESSAGES.micFailed;
}

function limitState(target: string | null, note: string | null): DictationState {
  return { kind: "unavailable", reason: "daily_limit", target, note };
}

// The state the form shows. With no time left today a resting form is locked,
// whichever recorder on the page used the time up; it unlocks when a fresh
// count from the server has time again.
function shownState(state: DictationState, remainingSeconds: number): DictationState {
  if (remainingSeconds > 0) return state.kind === "unavailable" ? { kind: "idle" } : state;
  if (state.kind === "idle") return limitState(null, null);
  if (state.kind === "notice") return limitState(state.target, state.message);
  return state;
}

// What the form shows once the reply is in. A clip that produced nothing
// stays in memory only, so Retry can resend it without re-recording.
function stateAfterReply(reply: DictationReply, attempt: {
  target: string;
  clip: Blob;
  stop: Stop;
  limitReached: boolean;
  onText: ApplyDictationText;
}): DictationState {
  const { target, clip, stop, limitReached } = attempt;
  const text = replyText(reply);
  const nothingHeard = heardNothing(reply);
  if (text === null && !nothingHeard && !limitReached) {
    return { kind: "failed", target, clip, durationMs: stop.durationMs };
  }
  const heard = nothingHeard ? DICTATION_MESSAGES.nothingHeard : null;
  const message = text === null ? heard : attempt.onText(target, text);
  const notice = message ?? stop.notice;
  if (limitReached) return limitState(target, notice);
  return notice ? { kind: "notice", target, message: notice } : { kind: "idle" };
}

function micUnsupported() {
  return typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia;
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useDictationRecorder(options: {
  url: string;
  kind: DictationKind;
  remainingSeconds: number;
  onRemainingSeconds: (seconds: number) => void;
  onText: ApplyDictationText;
}): DictationRecorder {
  const [state, setState] = useState<DictationState>({ kind: "idle" });
  const [now, setNow] = useState(0);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });
  // Mirrors the page's count so a recording started right after a reply, or
  // after the other form dictated, stops at what is really left.
  const remainingRef = useRef(options.remainingSeconds);
  useEffect(() => { remainingRef.current = options.remainingSeconds; }, [options.remainingSeconds]);
  // Bumped by discard(): anything started under an older session is ignored.
  const sessionRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const autoStopRef = useRef<number | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const stopRef = useRef<Stop | null>(null);
  const startedAtRef = useRef(0);

  const releaseMic = useCallback(() => {
    stopTracks(streamRef.current);
    streamRef.current = null;
  }, []);

  const clearAutoStop = useCallback(() => {
    if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
    autoStopRef.current = null;
  }, []);

  const upload = useCallback(async (target: string, clip: Blob, stop: Stop, session: number) => {
    setState({ kind: "transcribing", target });
    const controller = new AbortController();
    uploadRef.current = controller;
    const reply = await postClip(optionsRef.current, clip, stop.durationMs, controller.signal);
    if (session !== sessionRef.current) return;
    uploadRef.current = null;
    const remaining = remainingAfter(reply);
    if (remaining !== null) {
      remainingRef.current = remaining;
      optionsRef.current.onRemainingSeconds(remaining);
    }
    setState(stateAfterReply(reply, {
      target, clip, stop, limitReached: remainingRef.current <= 0, onText: optionsRef.current.onText,
    }));
  }, []);

  const retry = useCallback(() => {
    if (state.kind !== "failed") return;
    void upload(state.target, state.clip, { durationMs: state.durationMs, notice: null }, sessionRef.current);
  }, [state, upload]);

  const stop = useCallback((notice: string | null) => {
    clearAutoStop();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    stopRef.current = { durationMs: Math.max(1, Date.now() - startedAtRef.current), notice };
    recorder.stop();
  }, [clearAutoStop]);

  const start = useCallback(async (target: string) => {
    const session = sessionRef.current;
    if (micUnsupported()) {
      setState({ kind: "notice", target, message: DICTATION_MESSAGES.unsupported });
      return;
    }
    setState({ kind: "requesting_mic", target });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (session === sessionRef.current) setState({ kind: "notice", target, message: micErrorMessage(error) });
      return;
    }
    if (session !== sessionRef.current) {
      stopTracks(stream);
      return;
    }
    streamRef.current = stream;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, recorderOptions());
    } catch {
      releaseMic();
      setState({ kind: "notice", target, message: DICTATION_MESSAGES.unsupported });
      return;
    }
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => {
      releaseMic();
      recorderRef.current = null;
      const finished = stopRef.current;
      stopRef.current = null;
      if (session !== sessionRef.current || !finished) return;
      const clip = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "" });
      void upload(target, clip, finished, session);
    };
    recorder.start();
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    const stopAtSeconds = Math.min(MAX_CLIP_SECONDS, remainingRef.current);
    const stopAtMs = stopAtSeconds * 1000;
    autoStopRef.current = window.setTimeout(() => stop(autoStopNotice(stopAtSeconds)), stopAtMs);
    setNow(startedAt);
    setState({ kind: "recording", target, startedAt, stopAtMs });
  }, [releaseMic, stop, upload]);

  const discard = useCallback(() => {
    sessionRef.current += 1;
    clearAutoStop();
    uploadRef.current?.abort();
    uploadRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    stopRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    releaseMic();
    setState({ kind: "idle" });
  }, [clearAutoStop, releaseMic]);

  const toggle = useCallback((target: string) => {
    if (state.kind === "recording" && state.target === target) {
      stop(null);
      return;
    }
    if (dictationBusy(state) || remainingRef.current <= 0) return;
    void start(target);
  }, [start, state, stop]);

  const recording = state.kind === "recording";
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  // Leaving the page or unmounting the form drops the recording and any late text.
  useEffect(() => {
    window.addEventListener("pagehide", discard);
    return () => {
      window.removeEventListener("pagehide", discard);
      discard();
    };
  }, [discard]);

  return {
    state: shownState(state, options.remainingSeconds),
    elapsedMs: state.kind === "recording" ? Math.max(0, now - state.startedAt) : 0,
    toggle,
    retry,
    discard,
  };
}

export function dictationBusy(state: DictationState) {
  return state.kind === "requesting_mic" || state.kind === "recording" || state.kind === "transcribing";
}
