// Client-safe: how Dictation (#500) adds a transcribed clip to an answer box.
// The words go at the end, never replacing what the Mentor already wrote.

import { HOLISTIC_ANSWER_MAX_LENGTH } from "./holistic-answer-limit";

export type AppendDictationResult =
  | { ok: true; value: string }
  | { ok: false; reason: "too_long" };

export function appendDictation(
  existing: string,
  text: string,
  max = HOLISTIC_ANSWER_MAX_LENGTH
): AppendDictationResult {
  const words = text.trim();
  if (!words) return { ok: true, value: existing };
  const separator = existing && !/\s$/.test(existing) ? " " : "";
  const value = `${existing}${separator}${words}`;
  return value.length > max ? { ok: false, reason: "too_long" } : { ok: true, value };
}
