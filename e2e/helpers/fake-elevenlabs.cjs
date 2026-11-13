// fallow-ignore-file unused-file
// The e2e server's stand-in for ElevenLabs Scribe. Only the Playwright web
// server loads it (NODE_OPTIONS=--require, see playwright.config.ts). It wraps
// global fetch before Next starts: a POST to the speech-to-text URL gets a
// fixed transcript and a content-free line in the call log; any other request
// to an ElevenLabs host is refused. Nothing reaches the real provider.
//
// It fails closed: the config leaves the API key blank, and only this file sets
// the dummy key, after the fetch wrapper is in place. A server started without
// it has Dictation off, and a child process that won't load it doesn't inherit
// the key.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const childProcess = require("node:child_process");

const SPEECH_TO_TEXT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const KEY_NAME = "HOLISTIC_DICTATION_ELEVENLABS_API_KEY";
const transcript = process.env.E2E_FAKE_ELEVENLABS_TRANSCRIPT || "fake transcript";

// The ElevenLabs URL a fetch targets (a string, URL or Request), or null.
function elevenLabsUrl(input) {
  const url = URL.parse(String(input.url ?? input));
  return /(^|\.)elevenlabs\.io$/i.test(String(url?.hostname)) ? url : null;
}

function fileSummary(body) {
  const file = body instanceof FormData ? body.get("file") : null;
  return file instanceof Blob ? { size: file.size, type: file.type, name: file.name } : null;
}

function scribeReply() {
  // Every word ends before 1 s, so the clip's duration sets audio_seconds.
  const words = transcript.split(" ").map((text, index) => ({
    text, type: "word", start: index * 0.1, end: index * 0.1 + 0.05,
  }));
  return Response.json({ language_code: "eng", text: transcript, words });
}

function isSpeechToText(method, url) {
  return method === "POST" && `${url.origin}${url.pathname}` === SPEECH_TO_TEXT_URL;
}

// Content-free: never the audio or the key. Without a log path this throws,
// so the fetch fails rather than going unrecorded.
function logCall(call) {
  fs.appendFileSync(process.env.E2E_FAKE_ELEVENLABS_CALL_LOG, `${JSON.stringify(call)}\n`);
}

function answerElevenLabs(url, init) {
  const method = String(init.method || "GET").toUpperCase();
  const answered = isSpeechToText(method, url);
  const file = answered ? fileSummary(init.body) : null;
  logCall({ at: new Date().toISOString(), pid: process.pid, method, url: url.href, answered, file });
  if (!answered) throw new TypeError(`fake ElevenLabs refused ${method} ${url.href}`);
  return scribeReply();
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function fetchWithFakeElevenLabs(input, init = {}) {
  const url = elevenLabsUrl(input);
  return url ? answerElevenLabs(url, init) : realFetch(input, init);
};

// A child whose NODE_OPTIONS no longer loads this file must not get the key.
function loadsFake(envPairs) {
  return envPairs.some((pair) => pair.startsWith("NODE_OPTIONS=") && pair.includes(__filename));
}

const spawn = childProcess.ChildProcess.prototype.spawn;
childProcess.ChildProcess.prototype.spawn = function spawnWithoutUnfakedKey(options) {
  const envPairs = options.envPairs;
  if (envPairs && !loadsFake(envPairs)) options.envPairs = envPairs.filter((pair) => !pair.startsWith(`${KEY_NAME}=`));
  return spawn.call(this, options);
};

process.env[KEY_NAME] = "e2e-fake-elevenlabs-key";
