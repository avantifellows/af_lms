import fs from "fs";
import os from "os";
import path from "path";

// The e2e web server's ElevenLabs Scribe fake (fake-elevenlabs.cjs): the
// config preloads it into Next, and specs read its call log.
export const FAKE_ELEVENLABS_PRELOAD = path.resolve(__dirname, "fake-elevenlabs.cjs");
export const FAKE_ELEVENLABS_CALL_LOG = path.join(os.tmpdir(), "af-lms-e2e-fake-elevenlabs-calls.jsonl");
export const FAKE_ELEVENLABS_TRANSCRIPT = "transcribed by the e2e server fake";

export type FakeElevenLabsCall = {
  at: string;
  pid: number;
  method: string;
  url: string;
  answered: boolean;
  file: { size: number; type: string; name: string } | null;
};

/** Every call the fake has seen, oldest first (the log outlives a run). */
export function readFakeElevenLabsCalls(): FakeElevenLabsCall[] {
  if (!fs.existsSync(FAKE_ELEVENLABS_CALL_LOG)) return [];
  return fs.readFileSync(FAKE_ELEVENLABS_CALL_LOG, "utf8").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as FakeElevenLabsCall);
}
