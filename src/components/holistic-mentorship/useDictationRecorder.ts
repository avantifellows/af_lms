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
  | { kind: "failed"; target: string; clip: Blob; durationMs: number } // Retry resends clip (#511)
  | { kind: "notice"; target: string; message: string }               // nothing heard, auto-stopped, limit, too long
  | { kind: "unavailable"; reason: "denied" | "no_mic" | "unsupported" | "daily_limit" };

export type DictationKind = "post_session" | "follow_up";

// Called with the transcribed words when the response arrives. Returns a
// message to show under the box when the words could not be added.
export type ApplyDictationText = (target: string, text: string) => string | null;

export type DictationRecorder = {
  state: DictationState;
  elapsedMs: number;
  toggle: (target: string) => void;
  /** Stops any recording, releases the mic, and ignores a transcription still in flight. */
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

export function useDictationRecorder(options: {
  url: string;
  kind: DictationKind;
  remainingSeconds: number;
  onText: ApplyDictationText;
}): DictationRecorder {
  const [state, setState] = useState<DictationState>({ kind: "idle" });
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
    let body: { outcome?: string; text?: string; remainingSeconds?: number } | null = null;
    try {
      const response = await fetch(optionsRef.current.url, { method: "POST", body: form, signal: controller.signal });
      body = await response.json().catch(() => null);
    } catch {
      body = null;
    }
    if (session !== sessionRef.current) return;
    uploadRef.current = null;
    if (typeof body?.remainingSeconds === "number") remainingRef.current = body.remainingSeconds;
    const message = body?.outcome === "ok" && typeof body.text === "string"
      ? optionsRef.current.onText(target, body.text)
      : null;
    // Couldn't transcribe, nothing heard and the daily limit get their own states in #511.
    const notice = message ?? stop.notice;
    setState(notice ? { kind: "notice", target, message: notice } : { kind: "idle" });
  }, []);

  const stop = useCallback((notice: string | null) => {
    clearAutoStop();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    stopRef.current = { durationMs: Math.max(1, Date.now() - startedAtRef.current), notice };
    recorder.stop();
  }, [clearAutoStop]);

  const start = useCallback(async (target: string) => {
    const session = sessionRef.current;
    setState({ kind: "requesting_mic", target });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, no mic and unsupported get their own messages in #511.
      if (session === sessionRef.current) setState({ kind: "idle" });
      return;
    }
    if (session !== sessionRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream, recorderOptions());
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
    if (dictationBusy(state)) return;
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
    discard,
  };
}

export function dictationBusy(state: DictationState) {
  return state.kind === "requesting_mic" || state.kind === "recording" || state.kind === "transcribing";
}
