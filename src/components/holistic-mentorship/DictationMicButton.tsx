import { Mic, Square } from "lucide-react";

import { dictationBusy, type DictationRecorder } from "./useDictationRecorder";

function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Dictation (#500): the mic toggle beside one editable answer box. Kept out
// of the Student Phase workspace so the Follow-up Note form can reuse it.
// While any box in the form is busy, every other mic is disabled.
export function DictationMicButton({ question, target, recorder, disabled = false }: {
  question: string;
  target: string;
  recorder: DictationRecorder;
  disabled?: boolean;
}) {
  const { state } = recorder;
  const recording = state.kind === "recording" && state.target === target;
  const blocked = disabled || (dictationBusy(state) && !recording);
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" aria-label={`Dictate: ${question}`} aria-pressed={recording}
      disabled={blocked} onClick={() => recorder.toggle(target)}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
        recording
          ? "border-danger bg-danger text-white"
          : "border-border bg-bg-card text-text-secondary hover:border-accent hover:text-accent"}`}>
      {recording
        ? <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
        : <Mic aria-hidden="true" className="h-4 w-4" />}
      Dictate
    </button>
    {recording && <span className="inline-flex items-center gap-1.5 font-mono text-xs text-danger">
      <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-danger" />
      {`Recording ${formatElapsed(recorder.elapsedMs)}`}
    </span>}
  </div>;
}

// The box's Dictation messages, in a polite live region that is always present
// so screen readers announce each change.
export function DictationStatus({ target, recorder }: { target: string; recorder: DictationRecorder }) {
  const { state } = recorder;
  const mine = "target" in state && state.target === target;
  const message = !mine ? "" : state.kind === "transcribing"
    ? "Transcribing…"
    : state.kind === "notice" ? state.message : "";
  return <p aria-live="polite" className="text-xs text-text-muted">{message}</p>;
}
