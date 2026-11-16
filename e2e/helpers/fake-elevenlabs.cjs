// fallow-ignore-file unused-file
// The e2e server's stand-in for the two Dictation providers: ElevenLabs Scribe
// and the OpenRouter translation. Only the Playwright web server loads it
// (NODE_OPTIONS=--require, see playwright.config.ts). It wraps global fetch
// before Next starts:
// - a POST to Scribe's speech-to-text URL gets a fixed transcript (English
//   unless the test asks for Hindi, see below) and a content-free line in the
//   ElevenLabs call log; any other request to an ElevenLabs host is refused.
// - a POST to OpenRouter's chat completions URL gets a fixed English
//   translation and a content-free line in the OpenRouter call log; any other
//   request to an OpenRouter host is refused.
// Nothing reaches a real provider.
//
// A test steers one Dictation request with headers on that request only (its
// page.route adds them), so tests in other workers are unaffected:
// - x-e2e-fake-scribe-language: hin  -> Scribe answers a Hindi/Hinglish
//   transcript with language_code "hin" (default: English, "eng").
// - x-e2e-fake-openrouter: fail      -> every OpenRouter call answers HTTP 500.
// The incoming request's headers reach the provider fetch through an
// AsyncLocalStorage entered when the HTTP server emits "request".
//
// It fails closed: the config leaves both API keys blank, and only this file
// sets the dummy keys, after the fetch wrapper is in place. A server started
// without it has Dictation off, and a child process that won't load it doesn't
// inherit the keys.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const http = require("node:http");
const childProcess = require("node:child_process");
const { AsyncLocalStorage } = require("node:async_hooks");

const SPEECH_TO_TEXT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_NAMES = ["HOLISTIC_DICTATION_ELEVENLABS_API_KEY", "HOLISTIC_DICTATION_OPENROUTER_API_KEY"];
const SCRIBE_LANGUAGE_HEADER = "x-e2e-fake-scribe-language";
const OPENROUTER_HEADER = "x-e2e-fake-openrouter";
const transcripts = {
  eng: process.env.E2E_FAKE_ELEVENLABS_TRANSCRIPT || "fake transcript",
  hin: process.env.E2E_FAKE_ELEVENLABS_HINDI_TRANSCRIPT || "आज छात्र ने maths का homework पूरा किया",
};
const translation = process.env.E2E_FAKE_OPENROUTER_TRANSLATION || "fake translation";

// The steering headers of the incoming request being handled, if any.
const incoming = new AsyncLocalStorage();
const NO_STEERING = { scribeLanguage: "eng", openRouterFails: false };

function steeringFrom(headers) {
  return {
    scribeLanguage: headers[SCRIBE_LANGUAGE_HEADER] === "hin" ? "hin" : "eng",
    openRouterFails: headers[OPENROUTER_HEADER] === "fail",
  };
}

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function emitWithFakeProviderSteering(event, ...args) {
  if (event !== "request") return emit.call(this, event, ...args);
  return incoming.run(steeringFrom(args[0].headers), () => emit.call(this, event, ...args));
};

function steering() {
  return incoming.getStore() ?? NO_STEERING;
}

// The URL a fetch targets (a string, URL or Request) when its host matches, or null.
function providerUrl(input, hostPattern) {
  const url = URL.parse(String(input.url ?? input));
  return hostPattern.test(String(url?.hostname)) ? url : null;
}

function requestMethod(init) {
  return String(init.method || "GET").toUpperCase();
}

function isPost(method, url, target) {
  return method === "POST" && `${url.origin}${url.pathname}` === target;
}

function fileSummary(body) {
  const file = body instanceof FormData ? body.get("file") : null;
  return file instanceof Blob ? { size: file.size, type: file.type, name: file.name } : null;
}

// What the Scribe log records about one call: never the audio or the key.
function scribeCall(method, url, init) {
  const answered = isPost(method, url, SPEECH_TO_TEXT_URL);
  if (!answered) return { answered, file: null, language: null };
  return { answered, file: fileSummary(init.body), language: steering().scribeLanguage };
}

function scribeReply(call) {
  const transcript = transcripts[call.language];
  // Every word ends before 1 s, so the clip's duration sets audio_seconds.
  const words = transcript.split(" ").map((text, index) => ({
    text, type: "word", start: index * 0.1, end: index * 0.1 + 0.05,
  }));
  return Response.json({ language_code: call.language, text: transcript, words });
}

// The request body as an object ({} when it is not JSON).
function parsedJson(body) {
  try {
    return Object(JSON.parse(String(body)));
  } catch {
    return {};
  }
}

// What the request asked for, without any message text.
function chatRequestSummary(body) {
  const { model, messages, provider, reasoning, stream } = parsedJson(body);
  return { model, messageCount: Array.isArray(messages) ? messages.length : null, provider, reasoning, stream };
}

// What the OpenRouter log records about one call: never the text or the key.
function openRouterCall(method, url, init) {
  const answered = isPost(method, url, CHAT_COMPLETIONS_URL);
  if (!answered) return { answered, forcedFailure: false };
  return { answered, forcedFailure: steering().openRouterFails, ...chatRequestSummary(init.body) };
}

function openRouterReply(call) {
  if (call.forcedFailure) return Response.json({ error: "fake OpenRouter forced failure" }, { status: 500 });
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: translation } }] });
}

const PROVIDERS = [
  {
    name: "ElevenLabs",
    host: /(^|\.)elevenlabs\.io$/i,
    logEnv: "E2E_FAKE_ELEVENLABS_CALL_LOG",
    describe: scribeCall,
    reply: scribeReply,
  },
  {
    name: "OpenRouter",
    host: /(^|\.)openrouter\.ai$/i,
    logEnv: "E2E_FAKE_OPENROUTER_CALL_LOG",
    describe: openRouterCall,
    reply: openRouterReply,
  },
];

// Content-free (see describe). Without a log path this throws, so the fetch
// fails rather than going unrecorded.
function logCall(logPath, call) {
  fs.appendFileSync(logPath, `${JSON.stringify(call)}\n`);
}

// Logs every request to the provider's host, answers the one URL it fakes and
// refuses the rest.
function answerProvider(provider, url, init) {
  const method = requestMethod(init);
  const call = provider.describe(method, url, init);
  logCall(process.env[provider.logEnv], {
    at: new Date().toISOString(), pid: process.pid, method, url: url.href, ...call,
  });
  if (!call.answered) throw new TypeError(`fake ${provider.name} refused ${method} ${url.href}`);
  return provider.reply(call);
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function fetchWithFakeProviders(input, init = {}) {
  for (const provider of PROVIDERS) {
    const url = providerUrl(input, provider.host);
    if (url) return answerProvider(provider, url, init);
  }
  return realFetch(input, init);
};

// A child whose NODE_OPTIONS no longer loads this file must not get the keys.
function loadsFake(envPairs) {
  return envPairs.some((pair) => pair.startsWith("NODE_OPTIONS=") && pair.includes(__filename));
}

function isKeyPair(pair) {
  return KEY_NAMES.some((name) => pair.startsWith(`${name}=`));
}

// spawn, exec, execFile and fork all end here.
const spawn = childProcess.ChildProcess.prototype.spawn;
childProcess.ChildProcess.prototype.spawn = function spawnWithoutUnfakedKeys(options) {
  const envPairs = options.envPairs;
  if (envPairs && !loadsFake(envPairs)) options.envPairs = envPairs.filter((pair) => !isKeyPair(pair));
  return spawn.call(this, options);
};

// The synchronous ones bypass ChildProcess, so their options are rewritten:
// an env that won't load this file loses the keys.
function keepsKeys(env) {
  const pairs = Object.entries(env).map(([name, value]) => `${name}=${value}`);
  return loadsFake(pairs) || !pairs.some(isKeyPair);
}

function withoutUnfakedKeys(args, optionsIndex) {
  const options = { ...args[optionsIndex] };
  const env = options.env ?? process.env;
  if (keepsKeys(env)) return args;
  const strippedEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !KEY_NAMES.includes(name)));
  const copy = [...args];
  copy[optionsIndex] = { ...options, env: strippedEnv };
  return copy;
}

for (const name of ["spawnSync", "execFileSync"]) {
  const original = childProcess[name];
  childProcess[name] = function syncWithoutUnfakedKeys(...args) {
    return original.apply(this, withoutUnfakedKeys(args, Array.isArray(args[1]) || args[1] == null ? 2 : 1));
  };
}
const execSync = childProcess.execSync;
childProcess.execSync = function execSyncWithoutUnfakedKeys(...args) {
  return execSync.apply(this, withoutUnfakedKeys(args, 1));
};
// So `import { execSync } from "node:child_process"` gets the wrappers too.
require("node:module").syncBuiltinESMExports();

process.env.HOLISTIC_DICTATION_ELEVENLABS_API_KEY = "e2e-fake-elevenlabs-key";
process.env.HOLISTIC_DICTATION_OPENROUTER_API_KEY = "e2e-fake-openrouter-key";
