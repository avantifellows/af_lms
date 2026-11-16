import fs from "fs";
import os from "os";
import path from "path";

// The e2e web server's Dictation provider fakes (fake-elevenlabs.cjs: ElevenLabs
// Scribe and the OpenRouter translation): the config preloads it into Next, and
// specs read its call logs.
export const FAKE_ELEVENLABS_PRELOAD = path.resolve(__dirname, "fake-elevenlabs.cjs");
export const FAKE_ELEVENLABS_CALL_LOG = path.join(os.tmpdir(), "af-lms-e2e-fake-elevenlabs-calls.jsonl");
export const FAKE_OPENROUTER_CALL_LOG = path.join(os.tmpdir(), "af-lms-e2e-fake-openrouter-calls.jsonl");
export const FAKE_ELEVENLABS_TRANSCRIPT = "transcribed by the e2e server fake";
export const FAKE_ELEVENLABS_HINDI_TRANSCRIPT = "आज छात्र ने maths का homework पूरा किया";
export const FAKE_OPENROUTER_TRANSLATION = "Today the student finished the maths homework, translated by the e2e fake";

// Headers a spec adds to one dictation request (via page.route) to steer the
// fakes for that request only.
export const FAKE_SCRIBE_HINDI_HEADERS = { "x-e2e-fake-scribe-language": "hin" } as const;
export const FAKE_OPENROUTER_FAIL_HEADERS = { "x-e2e-fake-openrouter": "fail" } as const;

export type FakeElevenLabsCall = {
  at: string;
  pid: number;
  method: string;
  url: string;
  answered: boolean;
  file: { size: number; type: string; name: string } | null;
  language: "eng" | "hin" | null;
};

export type FakeOpenRouterCall = {
  at: string;
  pid: number;
  method: string;
  url: string;
  answered: boolean;
  forcedFailure: boolean;
  model?: string | null;
  messageCount?: number | null;
  provider?: Record<string, unknown> | null;
  reasoning?: Record<string, unknown> | null;
  stream?: boolean | null;
};

function readCallLog<T>(logPath: string): T[] {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/** Every Scribe call the fake has seen, oldest first (the log outlives a run). */
export function readFakeElevenLabsCalls(): FakeElevenLabsCall[] {
  return readCallLog<FakeElevenLabsCall>(FAKE_ELEVENLABS_CALL_LOG);
}

/** Every OpenRouter call the fake has seen, oldest first (the log outlives a run). */
export function readFakeOpenRouterCalls(): FakeOpenRouterCall[] {
  return readCallLog<FakeOpenRouterCall>(FAKE_OPENROUTER_CALL_LOG);
}
