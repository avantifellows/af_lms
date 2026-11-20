// Client-safe: how Dictation (#500) adds a transcribed clip to an answer box.
// The words go at the end, never replacing what the Mentor already wrote.

import { HOLISTIC_ANSWER_MAX_LENGTH } from "./holistic-answer-limit";

// Not ok when the answer would go past HOLISTIC_ANSWER_MAX_LENGTH.
export type AppendDictationResult = { ok: true; value: string } | { ok: false };

export function appendDictation(existing: string, text: string): AppendDictationResult {
  const words = text.trim();
  if (!words) return { ok: true, value: existing };
  const separator = existing && !/\s$/.test(existing) ? " " : "";
  const value = `${existing}${separator}${words}`;
  return value.length > HOLISTIC_ANSWER_MAX_LENGTH ? { ok: false } : { ok: true, value };
}
