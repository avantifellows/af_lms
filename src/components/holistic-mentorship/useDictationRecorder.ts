import { useCallback, useEffect, useRef, useState } from "react";

// What the server-rendered Student Phase page tells the client about
// Dictation (#500). The client never reads the HOLISTIC_DICTATION_* settings.
export type DictationAvailability = { enabled: boolean; remainingSeconds: number };

export const DICTATION_OFF: DictationAvailability = { enabled: false, remainingSeconds: 0 };

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

// With no time left today, the form rests in the limit state, not idle.
function restingState(remainingSeconds: number): DictationState {
  return remainingSeconds > 0
    ? { kind: "idle" }
    : { kind: "unavailable", reason: "daily_limit", target: null, note: null };
}

export function useDictationRecorder(options: {
  url: string;
  kind: DictationKind;
  remainingSeconds: number;
  onText: ApplyDictationText;
}): DictationRecorder {
  const [state, setState] = useState<DictationState>(() => restingState(options.remainingSeconds));
  const [now, setNow] = useState(0);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });
  const remainingRef = useRef(options.remainingSeconds);
  // Bumped by discard(): anything started under an older session is ignored.
  const sessionRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const autoStopRef = useRef<number | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const stopRef = useRef<Stop | null>(null);
  const startedAtRef = useRef(0);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
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
    const form = new FormData();
    form.append("audio", clip, clipFilename(clip));
    form.append("kind", optionsRef.current.kind);
    form.append("duration_ms", String(stop.durationMs));
    let status = 0;
    let body: { outcome?: string; text?: string; remainingSeconds?: number; code?: string } | null = null;
    try {
      const response = await fetch(optionsRef.current.url, { method: "POST", body: form, signal: controller.signal });
      status = response.status;
      body = await response.json().catch(() => null);
    } catch {
      // A network failure is treated the same as a 502.
    }
    if (session !== sessionRef.current) return;
    uploadRef.current = null;
    if (typeof body?.remainingSeconds === "number") remainingRef.current = body.remainingSeconds;
    if (status === 429 && body?.code === "daily_limit") remainingRef.current = 0;
    const ok = status === 200 && body?.outcome === "ok" && typeof body.text === "string";
    const nothingHeard = status === 200 && body?.outcome === "nothing_heard";
    const limitReached = remainingRef.current <= 0;
    if (!ok && !nothingHeard && !limitReached) {
      // The clip stays in memory only, so Retry can resend it without re-recording.
      setState({ kind: "failed", target, clip, durationMs: stop.durationMs });
      return;
    }
    const message = ok
      ? optionsRef.current.onText(target, body!.text!)
      : nothingHeard ? DICTATION_MESSAGES.nothingHeard : null;
    const notice = message ?? stop.notice;
    if (limitReached) setState({ kind: "unavailable", reason: "daily_limit", target, note: notice });
    else setState(notice ? { kind: "notice", target, message: notice } : { kind: "idle" });
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
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
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
      stream.getTracks().forEach((track) => track.stop());
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
    setState(restingState(remainingRef.current));
  }, [clearAutoStop, releaseMic]);

  const toggle = useCallback((target: string) => {
    if (state.kind === "recording" && state.target === target) {
      stop(null);
      return;
    }
    if (dictationBusy(state) || state.kind === "unavailable") return;
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
    state,
    elapsedMs: state.kind === "recording" ? Math.max(0, now - state.startedAt) : 0,
    toggle,
    retry,
    discard,
  };
}

export function dictationBusy(state: DictationState) {
  return state.kind === "requesting_mic" || state.kind === "recording" || state.kind === "transcribing";
}
