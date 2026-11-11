import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// What the server-rendered Student Phase page tells the client about
// Dictation (#500). The client never reads the HOLISTIC_DICTATION_* settings.
export type DictationAvailability = { enabled: boolean; remainingSeconds: number };

export const DICTATION_OFF: DictationAvailability = { enabled: false, remainingSeconds: 0 };

// The page's one count of today's remaining Dictation time. Every recorder on
// the page reads it and reports what the server says after each clip.
export type SharedDictationAvailability = DictationAvailability & {
  onRemainingSeconds: (seconds: number) => void;
  /** The form whose recorder is busy (see dictationBusy), or null. One recording at a time on the page. */
  busyKind: DictationKind | null;
  onBusy: (kind: DictationKind, busy: boolean) => void;
};

// Post-Session Notes and the Follow-up Note form each own a recorder but spend
// the same daily limit, so the count lives above both. A new count from the
// server (the page refreshed) replaces what the recorders reported, even when
// it is the same number as before (a new India-time day). Each server render
// sends a new `server` object; client re-renders pass the same one through.
export function useSharedDictationAvailability(server: DictationAvailability): SharedDictationAvailability {
  const [serverSnapshot, setServerSnapshot] = useState(server);
  const [remainingSeconds, setRemainingSeconds] = useState(server.remainingSeconds);
  const [busyKind, setBusyKind] = useState<DictationKind | null>(null);
  if (serverSnapshot !== server) {
    setServerSnapshot(server);
    setRemainingSeconds(server.remainingSeconds);
  }
  const onBusy = useCallback((kind: DictationKind, busy: boolean) => {
    setBusyKind((current) => (busy ? kind : current === kind ? null : current));
  }, []);
  return useMemo(
    () => ({ enabled: server.enabled, remainingSeconds, onRemainingSeconds: setRemainingSeconds, busyKind, onBusy }),
    [server.enabled, remainingSeconds, busyKind, onBusy]
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
  /** The other form on the page is recording or transcribing, so this form's mics wait. */
  busyElsewhere: boolean;
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

type Stop = {
  durationMs: number;
  notice: string | null;
  /** The browser ended the recording (mic unplugged, permission removed), not the Mentor or the timer. */
  byBrowser?: boolean;
};

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

function dailyLimitReply({ status, body }: DictationReply) {
  return status === 429 && body?.code === "daily_limit";
}

// Today's remaining time as the server reports it, or null when it didn't say.
// A daily-limit refusal without a count (an older server) means none is left.
function remainingAfter(reply: DictationReply): number | null {
  const reported = typeof reply.body?.remainingSeconds === "number" ? reply.body.remainingSeconds : null;
  return dailyLimitReply(reply) ? reported ?? 0 : reported;
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
  overTimeLeft: "That recording is longer than the time you have left today.",
  notSent: "Couldn't send that recording. Reload the page and try again.",
  micStopped: "Recording stopped. Check your microphone.",
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

// What to show when a clip held no words (empty, or the server heard nothing).
// After the browser stopped the recording, the microphone is the likelier cause.
function nothingHeardNotice(stop: Stop) {
  return stop.byBrowser ? DICTATION_MESSAGES.micStopped : DICTATION_MESSAGES.nothingHeard;
}

// Why a reply brought no words, when that is not a failure to retry. A clip
// refused by the daily limit while time is left can never fit, so it is dropped.
function replyNotice(reply: DictationReply, stop: Stop): string | null {
  if (heardNothing(reply)) return nothingHeardNotice(stop);
  // Signed out, no access, or a clip the server won't take: resending can't help.
  if (reply.status >= 400 && reply.status < 500 && reply.status !== 429) return DICTATION_MESSAGES.notSent;
  const timeLeft = (remainingAfter(reply) ?? 0) > 0;
  return dailyLimitReply(reply) && timeLeft ? DICTATION_MESSAGES.overTimeLeft : null;
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
  const replyMessage = replyNotice(reply, stop);
  if (text === null && !replyMessage && !limitReached) {
    return { kind: "failed", target, clip, durationMs: stop.durationMs };
  }
  const message = text === null ? replyMessage : attempt.onText(target, text);
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

// The recorder's working parts. They change without a re-render, so they
// share one ref.
type Live = {
  /** Bumped by discard(): anything started under an older session is ignored. */
  session: number;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  autoStop: number | null;
  upload: AbortController | null;
  stop: Stop | null;
  startedAt: number;
  /** Where this recording is set to auto-stop. */
  stopAtMs: number;
};

function releaseMic(live: Live) {
  stopTracks(live.stream);
  live.stream = null;
}

function clearAutoStop(live: Live) {
  if (live.autoStop !== null) window.clearTimeout(live.autoStop);
  live.autoStop = null;
}

// Wall-clock time, capped at the auto-stop point: a device that slept while
// recording would otherwise send a length the server refuses.
function clipDurationMs(live: Live) {
  return Math.max(1, Math.min(live.stopAtMs, Date.now() - live.startedAt));
}

// The browser ended the recording itself (mic unplugged, permission removed,
// a call took the mic). Keep what was said, and say why it stopped.
function browserStop(live: Live): Stop {
  clearAutoStop(live);
  return { durationMs: clipDurationMs(live), notice: DICTATION_MESSAGES.micStopped, byBrowser: true };
}

function recordingStartedAt(state: DictationState) {
  return state.kind === "recording" ? state.startedAt : null;
}

function isBusyElsewhere(busyKind: DictationKind | null, kind: DictationKind) {
  return busyKind !== null && busyKind !== kind;
}

// Ticks while a recording runs, for the "Recording m:ss" label.
function useElapsedMs(startedAt: number | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

// Tells the page while this form's recorder is busy, and lets go when it stops
// being busy or the form unmounts, so the other form's mics wait for it.
function useReportBusy(busy: boolean, kind: DictationKind, onBusy: SharedDictationAvailability["onBusy"]) {
  useEffect(() => {
    if (!busy) return;
    onBusy(kind, true);
    return () => onBusy(kind, false);
  }, [busy, kind, onBusy]);
}

export function useDictationRecorder(options: {
  url: string;
  kind: DictationKind;
  remainingSeconds: number;
  onRemainingSeconds: (seconds: number) => void;
  busyKind: DictationKind | null;
  onBusy: SharedDictationAvailability["onBusy"];
  onText: ApplyDictationText;
}): DictationRecorder {
  const [state, setState] = useState<DictationState>({ kind: "idle" });
  // The latest props, for callbacks that outlive a render. `remainingSeconds`
  // is the page's count, so a recording started after a reply, or after the
  // other form dictated, stops at what is really left.
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });
  const liveRef = useRef<Live>({
    session: 0, stream: null, recorder: null, autoStop: null, upload: null, stop: null, startedAt: 0,
    stopAtMs: MAX_CLIP_SECONDS * 1000,
  });

  // An empty recording is never sent or counted: it shows the nothing-heard
  // notice instead. This one check serves both stop paths (Mentor or auto-stop, and the browser).
  const upload = useCallback(async (target: string, clip: Blob, stop: Stop, session: number) => {
    if (clip.size === 0) {
      setState({ kind: "notice", target, message: nothingHeardNotice(stop) });
      return;
    }
    const live = liveRef.current;
    setState({ kind: "transcribing", target });
    const controller = new AbortController();
    live.upload = controller;
    const reply = await postClip(optionsRef.current, clip, stop.durationMs, controller.signal);
    if (session !== live.session) return;
    live.upload = null;
    const reported = remainingAfter(reply);
    if (reported !== null) optionsRef.current.onRemainingSeconds(reported);
    const remaining = reported ?? optionsRef.current.remainingSeconds;
    setState(stateAfterReply(reply, {
      target, clip, stop, limitReached: remaining <= 0, onText: optionsRef.current.onText,
    }));
  }, []);

  const retry = useCallback(() => {
    if (state.kind !== "failed") return;
    void upload(state.target, state.clip, { durationMs: state.durationMs, notice: null }, liveRef.current.session);
  }, [state, upload]);

  const stop = useCallback((notice: string | null) => {
    const live = liveRef.current;
    clearAutoStop(live);
    const recorder = live.recorder;
    if (!recorder || recorder.state === "inactive") return;
    live.stop = { durationMs: clipDurationMs(live), notice };
    recorder.stop();
  }, []);

  const start = useCallback(async (target: string) => {
    const live = liveRef.current;
    const session = live.session;
    if (micUnsupported()) {
      setState({ kind: "notice", target, message: DICTATION_MESSAGES.unsupported });
      return;
    }
    setState({ kind: "requesting_mic", target });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (session === live.session) setState({ kind: "notice", target, message: micErrorMessage(error) });
      return;
    }
    if (session !== live.session) {
      stopTracks(stream);
      return;
    }
    live.stream = stream;
    // A recorder that can't be made, or can't start (the stream ended after
    // getUserMedia), lets go of the mic and says this browser can't record.
    try {
      const recorder = new MediaRecorder(stream, recorderOptions());
      live.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onstop = () => {
        releaseMic(live);
        live.recorder = null;
        const finished = live.stop;
        live.stop = null;
        if (session !== live.session) return;
        const clip = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "" });
        void upload(target, clip, finished ?? browserStop(live), session);
      };
      // A recorder error ends the recording like a stop the browser made itself.
      // A recorder that is already inactive fires stop after the error.
      recorder.onerror = () => { if (recorder.state !== "inactive") recorder.stop(); };
      recorder.start();
    } catch {
      live.recorder = null;
      releaseMic(live);
      setState({ kind: "notice", target, message: DICTATION_MESSAGES.unsupported });
      return;
    }
    const startedAt = Date.now();
    live.startedAt = startedAt;
    const stopAtSeconds = Math.min(MAX_CLIP_SECONDS, optionsRef.current.remainingSeconds);
    const stopAtMs = stopAtSeconds * 1000;
    live.stopAtMs = stopAtMs;
    live.autoStop = window.setTimeout(() => stop(autoStopNotice(stopAtSeconds)), stopAtMs);
    setState({ kind: "recording", target, startedAt, stopAtMs });
  }, [stop, upload]);

  const discard = useCallback(() => {
    const live = liveRef.current;
    live.session += 1;
    clearAutoStop(live);
    live.upload?.abort();
    live.upload = null;
    const recorder = live.recorder;
    live.recorder = null;
    live.stop = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    releaseMic(live);
    setState({ kind: "idle" });
  }, []);

  const busyElsewhere = isBusyElsewhere(options.busyKind, options.kind);
  useReportBusy(dictationBusy(state), options.kind, options.onBusy);

  const toggle = useCallback((target: string) => {
    if (state.kind === "recording" && state.target === target) {
      stop(null);
      return;
    }
    if (dictationBusy(state) || busyElsewhere || optionsRef.current.remainingSeconds <= 0) return;
    void start(target);
  }, [busyElsewhere, start, state, stop]);

  const elapsedMs = useElapsedMs(recordingStartedAt(state));

  // Leaving the page or unmounting the form drops the recording and any late text.
  useEffect(() => {
    window.addEventListener("pagehide", discard);
    return () => {
      window.removeEventListener("pagehide", discard);
      discard();
    };
  }, [discard]);

  return { state: shownState(state, options.remainingSeconds), elapsedMs, busyElsewhere, toggle, retry, discard };
}

export function dictationBusy(state: DictationState) {
  return state.kind === "requesting_mic" || state.kind === "recording" || state.kind === "transcribing";
}
