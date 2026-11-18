import fs from "fs";
import os from "os";
import path from "path";

import replies from "./fake-providers.json";

// The e2e web server's Dictation provider fakes (fake-elevenlabs.cjs: ElevenLabs
// Scribe and the OpenRouter translation): the config preloads it into Next, and
// specs steer it and check the fixed texts it answers with.
export const FAKE_ELEVENLABS_PRELOAD = path.resolve(__dirname, "fake-elevenlabs.cjs");
export const FAKE_ELEVENLABS_TRANSCRIPT = replies.englishTranscript;
export const FAKE_OPENROUTER_TRANSLATION = replies.translation;

const STEERING_FILE = path.join(os.tmpdir(), replies.steeringFileName);

/**
 * Steers the server's fakes until resetFakeProviders(): Scribe hears Hindi,
 * and/or every OpenRouter call fails. Only one test runs at a time (workers: 1).
 */
export function steerFakeProviders(steering: { scribeLanguage?: "hin"; openRouterFails?: boolean }) {
  fs.writeFileSync(STEERING_FILE, JSON.stringify(steering));
}

/** Back to the default: an English transcript and a translation that succeeds. */
export function resetFakeProviders() {
  fs.rmSync(STEERING_FILE, { force: true });
}
