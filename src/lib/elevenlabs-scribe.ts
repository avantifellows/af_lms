// Server-only: the ElevenLabs Scribe speech-to-text client used by Dictation
// (ADR 0012). It holds no key of its own — the caller passes it — and never
// puts the provider's response body in an error, so nothing said by a Mentor
// can reach a log through it.

const ELEVENLABS_SPEECH_TO_TEXT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

export type TranscribeSpeechInput = {
  audio: Blob;
  filename: string;
  apiKey: string;
  zeroRetention: boolean;
  signal: AbortSignal;
};

export type TranscribeSpeechResult =
  | { kind: "text"; text: string; lastWordEndSeconds: number }
  | { kind: "empty" };

type ScribeWord = { type?: unknown; end?: unknown };

export type ScribeFailureClass = "http" | "malformed" | "network" | "timeout";

// The message is fixed per failure class: never the provider body, the key,
// or an underlying error's text.
export class ScribeTranscriptionError extends Error {
  constructor(readonly failureClass: ScribeFailureClass, readonly status?: number) {
    super(status ? `ElevenLabs Scribe failed (${failureClass} ${status})` : `ElevenLabs Scribe failed (${failureClass})`);
    this.name = "ScribeTranscriptionError";
  }
}

async function postToScribe(input: TranscribeSpeechInput, form: FormData): Promise<Response> {
  try {
    const url = input.zeroRetention
      ? `${ELEVENLABS_SPEECH_TO_TEXT_URL}?enable_logging=false`
      : ELEVENLABS_SPEECH_TO_TEXT_URL;
    return await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": input.apiKey },
      body: form,
      signal: input.signal,
    });
  } catch {
    throw new ScribeTranscriptionError(input.signal.aborted ? "timeout" : "network");
  }
}

async function readScribeBody(response: Response, signal: AbortSignal) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ScribeTranscriptionError(signal.aborted ? "timeout" : "malformed");
  }
  const { text, words } = (body ?? {}) as { text?: unknown; words?: unknown };
  if (typeof text !== "string" || (words !== undefined && !Array.isArray(words))) {
    throw new ScribeTranscriptionError("malformed");
  }
  return { text, words: (words ?? []) as ScribeWord[] };
}

export async function transcribeSpeech(input: TranscribeSpeechInput): Promise<TranscribeSpeechResult> {
  const form = new FormData();
  form.append("file", input.audio, input.filename);
  form.append("model_id", "scribe_v2");
  form.append("tag_audio_events", "false");

  const response = await postToScribe(input, form);
  if (!response.ok) {
    // Never read the body: it may echo the Mentor's words or account details.
    await response.body?.cancel().catch(() => undefined);
    throw new ScribeTranscriptionError("http", response.status);
  }
  const body = await readScribeBody(response, input.signal);
  const text = body.text.trim();
  const words = body.words.filter((word) => word?.type === "word");
  if (!text || words.length === 0) return { kind: "empty" };
  const lastWordEndSeconds = Math.max(0, ...words.map((word) => Number(word.end) || 0));
  return { kind: "text", text, lastWordEndSeconds };
}
