// fallow-ignore-file unused-file
// The e2e server's stand-in for the two Dictation providers: ElevenLabs Scribe
// and the OpenRouter translation. Only the Playwright web server loads it
// (NODE_OPTIONS=--require, see playwright.config.ts). It wraps global fetch
// before Next starts:
// - a POST to Scribe's speech-to-text URL gets a fixed transcript (English
//   unless steered to Hindi, see below); any other request to an ElevenLabs
//   host is refused.
// - a POST to OpenRouter's chat completions URL gets a fixed English
//   translation; any other request to an OpenRouter host is refused.
// Nothing reaches a real provider. The fixed texts are in fake-providers.json,
// which the specs read too.
//
// A spec steers the fakes by writing a small JSON file (see
// steerFakeProviders in fake-elevenlabs.ts) that is read on every provider
// call and removed after each test; e2e runs one test at a time (workers: 1):
// - {"scribeLanguage": "hin"} -> Scribe answers a Hindi/Hinglish transcript
//   with language_code "hin" (default: English, "eng").
// - {"openRouterFails": true} -> every OpenRouter call answers HTTP 500.
//
// It fails closed: the config leaves both API keys blank, and only this file
// sets the dummy keys, after the fetch wrapper is in place. A server started
// without it has Dictation off.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const replies = require("./fake-providers.json");

const SPEECH_TO_TEXT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const STEERING_FILE = path.join(os.tmpdir(), replies.steeringFileName);

// What the current test asked for; nothing written means English and a
// translation that succeeds.
function steering() {
  if (!fs.existsSync(STEERING_FILE)) return {};
  return JSON.parse(fs.readFileSync(STEERING_FILE, "utf8"));
}

function scribeReply() {
  const language = steering().scribeLanguage === "hin" ? "hin" : "eng";
  const transcript = language === "hin" ? replies.hindiTranscript : replies.englishTranscript;
  // Every word ends before 1 s, so the clip's duration sets audio_seconds.
  const words = transcript.split(" ").map((text, index) => ({
    text, type: "word", start: index * 0.1, end: index * 0.1 + 0.05,
  }));
  return Response.json({ language_code: language, text: transcript, words });
}

function openRouterReply() {
  if (steering().openRouterFails) return Response.json({ error: "fake OpenRouter forced failure" }, { status: 500 });
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: replies.translation } }] });
}

const PROVIDERS = [
  { name: "ElevenLabs", host: /(^|\.)elevenlabs\.io$/i, answers: SPEECH_TO_TEXT_URL, reply: scribeReply },
  { name: "OpenRouter", host: /(^|\.)openrouter\.ai$/i, answers: CHAT_COMPLETIONS_URL, reply: openRouterReply },
];

// The URL a fetch targets (a string, URL or Request) when its host matches, or null.
function providerUrl(input, hostPattern) {
  const url = URL.parse(String(input.url ?? input));
  return hostPattern.test(String(url?.hostname)) ? url : null;
}

// Answers the one URL each fake stands in for and refuses the rest.
function answerProvider(provider, url, init) {
  const method = String(init.method || "GET").toUpperCase();
  if (method !== "POST" || `${url.origin}${url.pathname}` !== provider.answers) {
    throw new TypeError(`fake ${provider.name} refused ${method} ${url.href}`);
  }
  return provider.reply();
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function fetchWithFakeProviders(input, init = {}) {
  for (const provider of PROVIDERS) {
    const url = providerUrl(input, provider.host);
    if (url) return answerProvider(provider, url, init);
  }
  return realFetch(input, init);
};

process.env.HOLISTIC_DICTATION_ELEVENLABS_API_KEY = "e2e-fake-elevenlabs-key";
process.env.HOLISTIC_DICTATION_OPENROUTER_API_KEY = "e2e-fake-openrouter-key";
