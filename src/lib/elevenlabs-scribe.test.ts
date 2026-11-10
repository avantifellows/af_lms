// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScribeTranscriptionError, transcribeSpeech } from "./elevenlabs-scribe";

const fetchMock = vi.fn();

function call(overrides: Partial<Parameters<typeof transcribeSpeech>[0]> = {}) {
  return transcribeSpeech({
    audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
    filename: "clip.webm",
    contentType: "audio/webm",
    apiKey: "sk_test_key",
    zeroRetention: false,
    signal: new AbortController().signal,
    ...overrides,
  });
}

function providerJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ElevenLabs Scribe client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns Scribe's trimmed text and the end of the last spoken word", async () => {
    fetchMock.mockResolvedValue(providerJson({
      text: "  Usne bola exam ka stress hai.  ",
      words: [
        { text: "Usne", type: "word", start: 0.1, end: 0.5 },
        { text: " ", type: "spacing", start: 0.5, end: 0.6 },
        { text: "hai.", type: "word", start: 4.2, end: 4.9 },
        { text: " ", type: "spacing", start: 4.9, end: 6.0 },
      ],
    }));

    await expect(call()).resolves.toEqual({
      kind: "text",
      text: "Usne bola exam ka stress hai.",
      lastWordEndSeconds: 4.9,
    });
  });

  it.each([
    ["blank text", { text: "   ", words: [] }],
    ["text without any word tokens", {
      text: "(silence)",
      words: [{ text: "(silence)", type: "audio_event", start: 0, end: 3 }],
    }],
    ["no words list", { text: "" }],
  ])("reports nothing heard for %s", async (_label, body) => {
    fetchMock.mockResolvedValue(providerJson(body));

    await expect(call()).resolves.toEqual({ kind: "empty" });
  });

  it.each([
    ["a 401", () => providerJson({ detail: { message: "Invalid API key sk_test_key for Nila" } }, 401), "http", 401],
    ["a 500", () => new Response("upstream said: Usne bola exam ka stress hai", { status: 500 }), "http", 500],
    ["malformed JSON", () => new Response("{not json Usne bola", { status: 200 }), "malformed", undefined],
    ["JSON without text", () => providerJson({ words: [] }), "malformed", undefined],
  ])("throws a safe error for %s", async (_label, response, failureClass, status) => {
    fetchMock.mockResolvedValue(response());

    const error = await call().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ScribeTranscriptionError);
    expect(error).toMatchObject({ failureClass, status });
    expect(String((error as Error).message)).not.toMatch(/Usne|sk_test_key|Nila|Invalid API key/);
  });

  it("throws a network failure without the underlying message", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed: getaddrinfo api.elevenlabs.io sk_test_key"));

    const error = await call().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ failureClass: "network" });
    expect(String((error as Error).message)).not.toContain("sk_test_key");
  });

  it("throws a timeout failure when the caller aborts the call", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));

    const pending = call({ signal: controller.signal }).catch((caught: unknown) => caught);
    controller.abort();

    await expect(pending).resolves.toMatchObject({ failureClass: "timeout" });
  });
});
