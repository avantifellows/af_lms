// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for Postgres: the Mentor's write scope, the Phase's Notes
// state, earlier usage today, and the usage records this route writes.
type UsageRecord = {
  id: number;
  mentorUserId: number;
  schoolId: number;
  programId: number;
  noteKind: string;
  audioSeconds: number;
  charactersReturned: number;
  outcome: string;
  detectedLanguage: string | null;
  translation: string;
  completed: boolean;
};

const { db, mockAccess, mockSession } = vi.hoisted(() => ({
  db: {
    scope: null as null | Record<string, unknown>,
    // The Grade's Active Phase: the latest ordered Open Phase of the Plan (#536).
    activePhaseId: 73 as number | null,
    notesState: null as null | string,
    usedTodaySeconds: 0,
    records: [] as UsageRecord[],
    transactionOpen: false,
  },
  mockAccess: vi.fn(),
  mockSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/holistic-mentorship", () => ({ requireHolisticMentorshipAccess: mockAccess }));
vi.mock("@/lib/db", () => {
  const usageTable = "holistic_mentorship_dictation_usage_records";
  const fields: Record<string, string> = {
    mentor_user_id: "mentorUserId", school_id: "schoolId", program_id: "programId", note_kind: "noteKind",
    audio_seconds: "audioSeconds", characters_returned: "charactersReturned", outcome: "outcome",
    detected_language: "detectedLanguage", translation: "translation",
  };
  // A $n placeholder, NULL, a quoted string or a number; anything else (now()) as written.
  function valueOf(expression: string, params: unknown[]) {
    const text = expression.trim();
    const placeholder = /^\$(\d+)/.exec(text);
    if (placeholder) return params[Number(placeholder[1]) - 1];
    if (/^NULL$/i.test(text)) return null;
    if (/^\d+$/.test(text)) return Number(text);
    return /^'(.*)'$/.exec(text)?.[1] ?? text;
  }
  // Writes what the statement set into the record, so tests check the rows.
  function assign(record: Record<string, unknown>, columns: string[], values: unknown[]) {
    columns.forEach((column, index) => {
      if (column === "completed_at") record.completed = values[index] !== null;
      else if (fields[column]) record[fields[column]] = values[index];
    });
  }
  const split = (list: string) => list.split(",").map((part) => part.trim());
  async function query(text: string, params: unknown[] = []) {
    if (text.includes(usageTable) && /SUM\(/i.test(text)) {
      const recorded = db.records.reduce((sum, record) => sum + record.audioSeconds, 0);
      return [{ used_seconds: db.usedTodaySeconds + recorded }];
    }
    const insert = /INSERT INTO \S+\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)\s*RETURNING/i.exec(text);
    if (insert && text.includes(usageTable)) {
      const record = { id: db.records.length + 1 } as UsageRecord;
      assign(record, split(insert[1]), split(insert[2]).map((value) => valueOf(value, params)));
      db.records.push(record);
      return [{ id: record.id }];
    }
    const update = /UPDATE \S+\s+SET([\s\S]*)WHERE id = (\$\d+)/i.exec(text);
    if (update && text.includes(usageTable)) {
      const pairs = split(update[1]).map((pair) => pair.split("=").map((part) => part.trim()));
      const record = db.records.find((row) => row.id === valueOf(update[2], params))!;
      assign(record, pairs.map(([column]) => column), pairs.map(([, value]) => valueOf(value, params)));
      return [];
    }
    throw new Error(`Unexpected query: ${text}`);
  }
  async function withTransaction<T>(fn: (client: unknown) => Promise<T>) {
    db.transactionOpen = true;
    try {
      return await fn({
        query: async (text: string) => {
          // The write check share-locks the Plan row first, then reads the Active Phase (#536).
          if (/FOR SHARE OF plan/.test(text)) return { rows: [{ id: 7 }] };
          if (/state = 'open'\s+ORDER BY position DESC/.test(text)) {
            return { rows: db.activePhaseId === null ? [] : [{ id: db.activePhaseId }] };
          }
          if (/FOR UPDATE/.test(text)) return { rows: db.scope ? [db.scope] : [] };
          if (text.includes("holistic_mentorship_post_session_notes")) {
            return { rows: db.notesState ? [{ state: db.notesState }] : [] };
          }
          throw new Error(`Unexpected transaction query: ${text}`);
        },
      });
    } finally {
      db.transactionOpen = false;
    }
  }
  return { query, withTransaction };
});

import { HOLISTIC_PHASE_CLOSED_ERROR } from "@/lib/holistic-phase-messages";

import { POST } from "./route";

const context = { params: Promise.resolve({ studentId: "41", phaseId: "73" }) };
const url = "http://localhost/api/holistic-mentorship/students/41/phases/73/dictation";
const contextQuery = "?school_code=SCH001&academic_year=2026-2027&program_id=1";
const apiKey = "sk_live_dictation_key_123";
const openRouterKey = "sk-or-v1-dictation-translate-456";

// Every outbound call goes through fetchMock, which hands it to the fake for
// the provider it targets.
const fetchMock = vi.fn();
const scribeMock = vi.fn();
const openRouterMock = vi.fn();
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type Fields = { audio?: Blob | null; kind?: string; duration_ms?: string; filename?: string };

function clip(bytes = 3, type = "audio/webm;codecs=opus") {
  return new Blob([new Uint8Array(bytes).fill(7)], { type });
}

function post(fields: Fields = {}, query = contextQuery) {
  const form = new FormData();
  const audio = fields.audio === undefined ? clip() : fields.audio;
  if (audio) form.append("audio", audio, fields.filename ?? "dictation.webm");
  form.append("kind", fields.kind ?? "post_session");
  form.append("duration_ms", fields.duration_ms ?? "4200");
  return POST(new Request(`${url}${query}`, { method: "POST", body: form }) as never, context);
}

function scribeReply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Scribe hears English: returned as it is, with no translation call.
const spokenReply = {
  language_code: "eng",
  language_probability: 0.98,
  text: " She said exam stress is high. ",
  words: [
    { text: "She", type: "word", start: 0.2, end: 0.6 },
    { text: "high.", type: "word", start: 4.4, end: 4.9 },
  ],
};

// Scribe hears Hindi: translated through OpenRouter before it is returned.
const hindiText = "छात्र ने कहा कि परीक्षा का तनाव बहुत है।";
const hindiReply = {
  language_code: "hin",
  language_probability: 0.91,
  text: hindiText,
  words: [
    { text: "छात्र", type: "word", start: 0.2, end: 0.7 },
    { text: "है।", type: "word", start: 5.1, end: 5.6 },
  ],
};
const englishTranslation = "The student said the exam stress is very high.";

function scribeSaid(text: string, lastWordEnd: number) {
  return scribeReply({ language_code: "eng", text, words: [{ text, type: "word", start: 0, end: lastWordEnd }] });
}

function translated(content: string, finishReason = "stop") {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

const mentorAccess = {
  ok: true,
  email: "nila.sen@example.com",
  actorUserId: 9,
  permission: { role: "teacher" },
  canEdit: true,
  school: { id: 4 },
};

const openScope = {
  mapping_id: 300, mentor_user_id: 9, phase_revision: 2, phase_state: "open",
  phase_plan_id: 7, phase_grade_id: 11, current_year_plan: true,
};

// Everything any console method printed during the test, as one string.
function spyOnConsole() {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined));
  return () => spies.flatMap((spy) => spy.mock.calls).map((call) =>
    call.map((part) => (part instanceof Error ? `${part.message} ${part.stack}` : JSON.stringify(part)))
      .join(" ")).join("\n");
}

function expectNothingSensitiveIn(logs: string) {
  expect(logs).not.toContain(apiKey);
  expect(logs).not.toContain(openRouterKey);
  expect(logs).not.toMatch(/She said|stress|student|छात्र|परीक्षा|Usne|bola/);
  expect(logs).not.toMatch(/\b41\b|\b73\b/); // Student and Phase ids
}

describe("Holistic Dictation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db, {
      scope: { ...openScope }, activePhaseId: 73, notesState: "draft", usedTodaySeconds: 0, records: [],
      transactionOpen: false,
    });
    vi.stubEnv("HOLISTIC_DICTATION_ENABLED", "true");
    vi.stubEnv("HOLISTIC_DICTATION_ELEVENLABS_API_KEY", apiKey);
    vi.stubEnv("HOLISTIC_DICTATION_ELEVENLABS_ZERO_RETENTION", "");
    vi.stubEnv("HOLISTIC_DICTATION_OPENROUTER_API_KEY", openRouterKey);
    vi.stubEnv("HOLISTIC_DICTATION_TRANSLATION_MODEL", "");
    fetchMock.mockReset();
    scribeMock.mockReset();
    openRouterMock.mockReset();
    fetchMock.mockImplementation((target: string, init: RequestInit) =>
      (String(target) === OPENROUTER_URL ? openRouterMock : scribeMock)(target, init));
    scribeMock.mockImplementation(async () => scribeReply(spokenReply));
    openRouterMock.mockImplementation(async () => translated(englishTranslation));
    vi.stubGlobal("fetch", fetchMock);
    mockSession.mockResolvedValue({ user: { email: "nila.sen@example.com" } });
    mockAccess.mockResolvedValue(mentorAccess);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    ["the flag is off", "false", apiKey, openRouterKey],
    ["the flag is unset", "", apiKey, openRouterKey],
    ["the flag is on but no ElevenLabs key is set", "true", "", openRouterKey],
    ["the flag is on but no OpenRouter key is set", "true", apiKey, ""],
    ["the flag is on but the OpenRouter key is blank", "true", apiKey, "   "],
  ])("returns 404 without calling any provider when %s", async (_label, flag, key, translationKey) => {
    vi.stubEnv("HOLISTIC_DICTATION_ENABLED", flag);
    vi.stubEnv("HOLISTIC_DICTATION_ELEVENLABS_API_KEY", key);
    vi.stubEnv("HOLISTIC_DICTATION_OPENROUTER_API_KEY", translationKey);

    const response = await post();

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.records).toEqual([]);
  });

  it("returns English as Scribe heard it, with no translation call, and records the attempt", async () => {
    db.usedTodaySeconds = 600;

    const response = await post({ duration_ms: "4200" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcome: "ok",
      text: "She said exam stress is high.",
      remainingSeconds: 1195,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scribeMock).toHaveBeenCalledTimes(1);
    expect(openRouterMock).not.toHaveBeenCalled();
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "nila.sen@example.com" } },
      "notes_draft",
      { schoolCode: "SCH001", studentId: 41, academicYear: "2026-2027", programId: 1 },
    );
    // duration 4.2 s, last word ends at 4.9 s → ceil(4.9) = 5 s.
    expect(db.records).toEqual([{
      id: 1, mentorUserId: 9, schoolId: 4, programId: 1, noteKind: "post_session",
      audioSeconds: 5, charactersReturned: 29, outcome: "ok", detectedLanguage: "eng", translation: "skipped",
      completed: true,
    }]);
  });

  it("returns nothing heard when Scribe hears no words, and still counts the clip", async () => {
    scribeMock.mockResolvedValue(scribeReply({ language_code: "hin", text: "  ", words: [] }));

    const response = await post({ duration_ms: "3000" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: "nothing_heard", remainingSeconds: 1797 });
    expect(openRouterMock).not.toHaveBeenCalled();
    expect(db.records).toEqual([expect.objectContaining({
      audioSeconds: 3, charactersReturned: 0, outcome: "nothing_heard", detectedLanguage: null,
      translation: "not_run", completed: true,
    })]);
  });

  it.each([
    ["a 401", () => scribeReply({ detail: `bad key ${apiKey}` }, 401)],
    ["a 422", () => scribeReply({ detail: "Usne bola exam ka stress hai" }, 422)],
    ["a 503", () => new Response("Usne bola exam ka stress hai", { status: 503 })],
    ["malformed JSON", () => new Response("{Usne bola", { status: 200 })],
  ])("returns 502 for %s and records a failed attempt", async (_label, reply) => {
    scribeMock.mockResolvedValue(reply());
    const logged = spyOnConsole();

    const response = await post({ duration_ms: "4200" });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Couldn't transcribe. Try again",
      remainingSeconds: 1795,
    });
    expect(db.records).toEqual([expect.objectContaining({
      audioSeconds: 5, charactersReturned: 0, outcome: "failed", detectedLanguage: null, translation: "not_run",
      completed: true,
    })]);
    expect(openRouterMock).not.toHaveBeenCalled();
    expect(logged()).toContain("Holistic Dictation transcription failed");
    expectNothingSensitiveIn(logged());
  });

  it("returns 502 for a network error and records a failed attempt", async () => {
    scribeMock.mockRejectedValue(new TypeError(`connect ECONNRESET ${apiKey}`));
    const logged = spyOnConsole();

    const response = await post();

    expect(response.status).toBe(502);
    expect(db.records).toEqual([expect.objectContaining({ outcome: "failed", completed: true })]);
    expectNothingSensitiveIn(logged());
  });

  function sentToScribe() {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url: new URL(target), headers: new Headers(init.headers), body: init.body as FormData };
  }

  it("sends the clip to Scribe v2 with the key in a header and no language or diarization", async () => {
    await post({ audio: clip(5, "audio/webm;codecs=opus"), filename: "take-1.webm" });

    const { url: scribeUrl, headers, body } = sentToScribe();
    expect(`${scribeUrl.origin}${scribeUrl.pathname}`).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(scribeUrl.searchParams.has("enable_logging")).toBe(false);
    expect(headers.get("xi-api-key")).toBe(apiKey);
    expect(body.get("model_id")).toBe("scribe_v2");
    expect(body.get("tag_audio_events")).toBe("false");
    expect(body.has("language_code")).toBe(false);
    expect(body.has("diarize")).toBe(false);
    expect(body.has("enable_logging")).toBe(false);
    expect([...body.keys()]).toEqual(["file", "model_id", "tag_audio_events"]);
    const file = body.get("file") as File;
    expect(file.name).toBe("take-1.webm");
    expect(file.type).toBe("audio/webm;codecs=opus");
    expect(file.size).toBe(5);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(5).fill(7));
    expect(scribeUrl.toString()).not.toContain(apiKey);
    for (const [, value] of body.entries()) expect(value).not.toBe(apiKey);
  });

  it("asks Scribe not to log the request only when zero retention is on", async () => {
    vi.stubEnv("HOLISTIC_DICTATION_ELEVENLABS_ZERO_RETENTION", "true");

    await post();

    expect(sentToScribe().url.searchParams.get("enable_logging")).toBe("false");
  });

  it("gives up after 25 seconds, returns 502, and records a failed attempt", async () => {
    vi.useFakeTimers();
    let waitedMs: number | null = null;
    let recordWhileWaiting: UsageRecord | undefined;
    scribeMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const calledAt = Date.now();
      recordWhileWaiting = { ...db.records[0] };
      init.signal?.addEventListener("abort", () => {
        waitedMs = Date.now() - calledAt;
        reject(new DOMException("aborted", "AbortError"));
      });
    }));
    const logged = spyOnConsole();

    const pending = post({ duration_ms: "4200" });
    await vi.runAllTimersAsync();
    const response = await pending;

    expect(waitedMs).toBe(25_000);
    expect(recordWhileWaiting).toMatchObject({
      outcome: "failed", detectedLanguage: null, translation: "not_run", completed: false,
    });
    expect(response.status).toBe(502);
    expect(db.records).toEqual([expect.objectContaining({ audioSeconds: 5, outcome: "failed", completed: true })]);
    expect(logged()).toContain("timeout");
    expectNothingSensitiveIn(logged());
  });

  it("records at most 305 seconds when Scribe's words run past the clip", async () => {
    scribeMock.mockResolvedValue(scribeSaid("A very long answer", 311.2));

    await post({ duration_ms: "300000" });

    expect(db.records[0]).toMatchObject({ audioSeconds: 305, outcome: "ok" });
  });

  function expectNoProviderCallOrRecord() {
    expect(scribeMock).not.toHaveBeenCalled();
    expect(openRouterMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.records).toEqual([]);
  }

  it("returns 401 without a session", async () => {
    mockSession.mockResolvedValue(null);

    const response = await post();

    expect(response.status).toBe(401);
    expect(mockAccess).not.toHaveBeenCalled();
    expectNoProviderCallOrRecord();
  });

  it.each([
    ["a Program outside the Holistic allowlist", "?school_code=SCH001&academic_year=2026-2027&program_id=2"],
    ["a missing Program", "?school_code=SCH001&academic_year=2026-2027"],
    ["a missing School", "?academic_year=2026-2027&program_id=1"],
  ])("returns 422 for %s", async (_label, query) => {
    const response = await post({}, query);

    expect(response.status).toBe(422);
    expect(mockAccess).not.toHaveBeenCalled();
    expectNoProviderCallOrRecord();
  });

  // Which roles are refused notes_draft / follow_up_note_add is tested in src/lib/holistic-mentorship.test.ts.
  it("returns the access check's refusal without calling the provider or recording usage", async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });

    const response = await post();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expectNoProviderCallOrRecord();
  });

  it("checks Follow-up Note access for a Follow-up box", async () => {
    db.notesState = "submitted";

    const response = await post({ kind: "follow_up" });

    expect(response.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(
      expect.anything(),
      "follow_up_note_add",
      { schoolCode: "SCH001", studentId: 41, academicYear: "2026-2027", programId: 1 },
    );
    expect(db.records[0]).toMatchObject({ noteKind: "follow_up", outcome: "ok" });
  });

  it.each(["", "summary", "notes_draft"])("returns 422 for an unknown kind %j", async (kind) => {
    const response = await post({ kind });

    expect(response.status).toBe(422);
    expect(mockAccess).not.toHaveBeenCalled();
    expectNoProviderCallOrRecord();
  });

  it("returns 422 for a body that is not a form", async () => {
    const response = await POST(new Request(`${url}${contextQuery}`, {
      method: "POST", body: "{}", headers: { "content-type": "application/json" },
    }) as never, context);

    expect(response.status).toBe(422);
    expectNoProviderCallOrRecord();
  });

  // The write-scope query returns no row for an inapplicable Phase, a dropout,
  // a privacy tombstone, or an ended Mapping.
  it.each([
    ["no row (inapplicable Phase, dropout, tombstone)", null, 404, "Not found"],
    ["another Mentor's Mapping", { ...openScope, mentor_user_id: 12 }, 404, "Not found"],
    ["a locked Phase", { ...openScope, phase_state: "locked" }, 422, "Phase is not Open"],
  ])("refuses a write scope with %s before calling ElevenLabs", async (_label, scope, status, error) => {
    db.scope = scope;

    const response = await post();

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
    expectNoProviderCallOrRecord();
  });

  // Issue #536: Dictation goes through the Mentor write check, so a Closed Phase takes no clips.
  it.each([
    ["a later Phase of the Grade is the Active Phase", { activePhaseId: 74 }],
    ["the Phase belongs to a past year's Plan", { scope: { ...openScope, current_year_plan: false } }],
  ])("refuses a clip for a Closed Phase (%s) before calling ElevenLabs", async (_label, state) => {
    Object.assign(db, state);

    const response = await post({ kind: "post_session" });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: HOLISTIC_PHASE_CLOSED_ERROR });
    expectNoProviderCallOrRecord();
  });

  it.each([["draft"], [null]])("refuses a Follow-up clip while Post-Session Notes are %s", async (state) => {
    db.notesState = state;

    const response = await post({ kind: "follow_up" });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Submit Post-Session Notes first" });
    expectNoProviderCallOrRecord();
  });

  it("allows a Post-Session clip while the Notes are still a draft", async () => {
    db.notesState = "draft";

    expect((await post({ kind: "post_session" })).status).toBe(200);
  });

  it("holds no transaction open while ElevenLabs transcribes", async () => {
    let transactionOpenDuringCall: boolean | null = null;
    scribeMock.mockImplementation(async () => {
      transactionOpenDuringCall = db.transactionOpen;
      return scribeReply(hindiReply);
    });
    let transactionOpenDuringTranslation: boolean | null = null;
    openRouterMock.mockImplementation(async () => {
      transactionOpenDuringTranslation = db.transactionOpen;
      return translated(englishTranslation);
    });

    await post();

    expect(transactionOpenDuringCall).toBe(false);
    expect(transactionOpenDuringTranslation).toBe(false);
  });

  const tenMegabytes = 10 * 1024 * 1024;

  it("returns 422 when no audio is attached", async () => {
    const response = await post({ audio: null });

    expect(response.status).toBe(422);
    expectNoProviderCallOrRecord();
  });

  it("returns 422 for an empty clip without recording it or calling ElevenLabs", async () => {
    const response = await post({ audio: clip(0) });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Attach one audio clip" });
    expectNoProviderCallOrRecord();
  });

  it.each(["audio/wav", "video/webm", "text/plain", ""])("returns 415 for a %j clip", async (type) => {
    const response = await post({ audio: clip(3, type) });

    expect(response.status).toBe(415);
    expectNoProviderCallOrRecord();
  });

  it.each(["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg; codecs=opus", "audio/mpeg"])(
    "accepts a %s clip",
    async (type) => {
      expect((await post({ audio: clip(3, type) })).status).toBe(200);
    },
  );

  it("returns 413 for a clip over 10 MB, and accepts exactly 10 MB", async () => {
    const tooBig = await post({ audio: clip(tenMegabytes + 1, "audio/webm") });
    expect(tooBig.status).toBe(413);
    await expect(tooBig.json()).resolves.toEqual({ error: "Audio clip is too large" });
    expectNoProviderCallOrRecord();

    expect((await post({ audio: clip(tenMegabytes, "audio/webm") })).status).toBe(200);
  });

  it.each(["0", "305001", "-5", "4.5", "abc", ""])("returns 422 for duration_ms %j", async (duration) => {
    const response = await post({ duration_ms: duration });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Invalid recording duration" });
    expectNoProviderCallOrRecord();
  });

  it.each([["1", 1], ["300000", 300], ["305000", 305]])("accepts duration_ms %s and records %i s", async (duration, seconds) => {
    scribeMock.mockResolvedValue(scribeSaid("Yes", 0.4));

    expect((await post({ duration_ms: duration })).status).toBe(200);
    expect(db.records[0]).toMatchObject({ audioSeconds: seconds });
  });

  it("checks the write scope before validating the clip", async () => {
    db.scope = null;

    const response = await post({ audio: clip(3, "audio/wav") });

    expect(response.status).toBe(404);
  });

  it.each([["16000"], ["15001"]])(
    "refuses a %s ms clip with 429 when 1,790 s are already used today",
    async (duration) => {
      db.usedTodaySeconds = 1790;

      const response = await post({ duration_ms: duration });

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toMatchObject({ code: "daily_limit" });
      expectNoProviderCallOrRecord();
    },
  );

  it.each([[1790, "16000", 10], [1803, "3000", 0]])(
    "tells the page the real time left with a 429 at %i s used, never below 0",
    async (used, duration, remainingSeconds) => {
      db.usedTodaySeconds = used;

      const response = await post({ duration_ms: duration });

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({
        error: "You've used today's Dictation time", code: "daily_limit", remainingSeconds,
      });
      expectNoProviderCallOrRecord();
    },
  );

  it("allows a 15 s clip at 1,790 s used (1,805 ≤ 1,805) and reports 0 remaining", async () => {
    db.usedTodaySeconds = 1790;
    scribeMock.mockResolvedValue(scribeSaid("Fine", 14.2));

    const response = await post({ duration_ms: "15000" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: "ok", text: "Fine", remainingSeconds: 0 });
    expect(db.records[0]).toMatchObject({ audioSeconds: 15, outcome: "ok" });
  });

  it("allows a five-minute clip at 1,505 s used (1,805 ≤ 1,805) and refuses it at 1,506 s", async () => {
    scribeMock.mockResolvedValue(scribeSaid("Long answer", 299.6));
    db.usedTodaySeconds = 1506;

    const refused = await post({ duration_ms: "300000" });

    expect(refused.status).toBe(429);
    await expect(refused.json()).resolves.toEqual({
      error: "You've used today's Dictation time", code: "daily_limit", remainingSeconds: 294,
    });
    expectNoProviderCallOrRecord();

    db.usedTodaySeconds = 1505;
    const allowed = await post({ duration_ms: "300000" });

    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({ outcome: "ok", text: "Long answer", remainingSeconds: 0 });
    expect(db.records[0]).toMatchObject({ audioSeconds: 300, outcome: "ok" });
  });

  it("logs nothing sensitive when a clip is transcribed", async () => {
    const logged = spyOnConsole();

    await post();

    expectNothingSensitiveIn(logged());
  });

  describe("translation into English", () => {
    const DEVANAGARI = /[ऀ-ॿ]/;

    function sentToOpenRouter(call = 0) {
      const [target, init] = openRouterMock.mock.calls[call] as [string, RequestInit];
      return { url: target, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
    }

    async function expectTranscriptionFailureResponse(response: Response) {
      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).not.toMatch(DEVANAGARI);
      expect(JSON.parse(body)).toEqual({ error: "Couldn't transcribe. Try again", remainingSeconds: 1794 });
    }

    beforeEach(() => {
      scribeMock.mockImplementation(async () => scribeReply(hindiReply));
    });

    it("translates a Hindi clip and returns only the English", async () => {
      let recordWhileTranslating: UsageRecord | undefined;
      openRouterMock.mockImplementation(async () => {
        recordWhileTranslating = { ...db.records[0] };
        return translated(englishTranslation);
      });

      const response = await post({ duration_ms: "4200" });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toMatch(DEVANAGARI);
      expect(JSON.parse(body)).toEqual({ outcome: "ok", text: englishTranslation, remainingSeconds: 1794 });
      expect(scribeMock).toHaveBeenCalledTimes(1);
      expect(openRouterMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const sent = sentToOpenRouter();
      expect(sent.url).toBe(OPENROUTER_URL);
      expect(sent.headers.get("authorization")).toBe(`Bearer ${openRouterKey}`);
      expect(sent.body).toMatchObject({
        model: "openai/gpt-6.1-terra",
        provider: { zdr: true, data_collection: "deny" },
        reasoning: { effort: "none" },
        max_tokens: 4000,
      });
      expect(sent.body.messages[1].content).toBe(`<transcript>\n${hindiText}\n</transcript>`);
      expect(recordWhileTranslating).toMatchObject({ outcome: "failed", translation: "not_run", completed: false });
      // duration 4.2 s, last word ends at 5.6 s → 6 s.
      expect(db.records).toEqual([expect.objectContaining({
        audioSeconds: 6, charactersReturned: englishTranslation.length, outcome: "ok",
        detectedLanguage: "hin", translation: "ok", completed: true,
      })]);
    });

    it("uses the translation model from the environment", async () => {
      vi.stubEnv("HOLISTIC_DICTATION_TRANSLATION_MODEL", " anthropic/claude-haiku-5.5 ");

      await post();

      expect(sentToOpenRouter().body.model).toBe("anthropic/claude-haiku-5.5");
    });

    it.each([
      ["romanised Hindi", { language_code: "hin", text: "Usne bola exam ka stress hai." }],
      ["English with a Devanagari word", { language_code: "eng", text: "She said the stress is बहुत high." }],
      ["a clip with no language code", { text: "She said exam stress is high." }],
    ])("translates %s", async (_label, heard) => {
      scribeMock.mockResolvedValue(scribeReply({ ...heard, words: [{ text: "x", type: "word", start: 0, end: 1 }] }));

      const response = await post();

      await expect(response.json()).resolves.toMatchObject({ outcome: "ok", text: englishTranslation });
      expect(openRouterMock).toHaveBeenCalledTimes(1);
      expect(db.records[0]).toMatchObject({ translation: "ok", charactersReturned: englishTranslation.length });
    });

    it("records the detected language in lower case", async () => {
      scribeMock.mockResolvedValue(scribeReply({ ...hindiReply, language_code: "HIN" }));

      await post();

      expect(db.records[0]).toMatchObject({ detectedLanguage: "hin", translation: "ok" });
    });

    it("records no language when Scribe's code is longer than the column allows", async () => {
      scribeMock.mockResolvedValue(scribeReply({ ...hindiReply, language_code: "x".repeat(17) }));

      await post();

      expect(db.records[0]).toMatchObject({ detectedLanguage: null, translation: "ok", outcome: "ok" });
    });

    it("retries a failed translation once and returns the English", async () => {
      openRouterMock
        .mockResolvedValueOnce(new Response(`upstream echoed ${hindiText}`, { status: 503 }))
        .mockResolvedValueOnce(translated(englishTranslation));
      const logged = spyOnConsole();

      const response = await post({ duration_ms: "4200" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ outcome: "ok", text: englishTranslation });
      expect(openRouterMock).toHaveBeenCalledTimes(2);
      expect(scribeMock).toHaveBeenCalledTimes(1);
      expect(db.records).toEqual([expect.objectContaining({
        outcome: "ok", translation: "ok", charactersReturned: englishTranslation.length, completed: true,
      })]);
      expect(logged()).toContain("Holistic Dictation translation failed");
      expect(logged()).toContain("503");
      expectNothingSensitiveIn(logged());
    });

    it.each([
      ["a 500 echoing the transcript", () => new Response(`upstream echoed ${hindiText}`, { status: 500 })],
      ["a reply still in Hindi", () => translated(hindiText)],
      ["a cut-off reply", () => translated("The student said", "length")],
      ["an empty reply", () => translated("  ")],
      ["a refused reply", () => translated("", "content_filter")],
      ["a network error", () => { throw new TypeError(`connect ECONNRESET ${openRouterKey} ${hindiText}`); }],
    ])("fails the clip like a failed transcription after two attempts with %s", async (_label, reply) => {
      openRouterMock.mockImplementation(async () => reply());
      const logged = spyOnConsole();

      const response = await post({ duration_ms: "4200" });

      await expectTranscriptionFailureResponse(response);
      expect(openRouterMock).toHaveBeenCalledTimes(2);
      expect(db.records).toEqual([expect.objectContaining({
        audioSeconds: 6, charactersReturned: 0, outcome: "failed", detectedLanguage: "hin",
        translation: "failed", completed: true,
      })]);
      expect(logged()).toContain("Holistic Dictation translation failed");
      expect(logged()).not.toContain("transcription failed");
      expect(logged()).not.toMatch(DEVANAGARI);
      expectNothingSensitiveIn(logged());
    });

    it("gives a failed translation the same response as a failed transcription", async () => {
      openRouterMock.mockImplementation(async () => new Response("", { status: 500 }));
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const translationFailure = await post({ duration_ms: "4200" });

      db.records = [];
      scribeMock.mockResolvedValue(new Response("", { status: 500 }));
      const transcriptionFailure = await post({ duration_ms: "6000" });

      expect(translationFailure.status).toBe(transcriptionFailure.status);
      await expect(translationFailure.json()).resolves.toEqual(await transcriptionFailure.json());
    });

    function hangUntilAborted(log: number[]) {
      return (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const calledAt = Date.now();
        init.signal?.addEventListener("abort", () => {
          log.push(Date.now() - calledAt);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }

    function scribeAnswersAfter(ms: number) {
      scribeMock.mockImplementation(() =>
        new Promise((resolve) => setTimeout(() => resolve(scribeReply(hindiReply)), ms)));
    }

    async function postWithFakeTimers() {
      const startedAt = Date.now();
      const pending = post({ duration_ms: "4200" });
      await vi.runAllTimersAsync();
      const response = await pending;
      return { response, elapsedMs: Date.now() - startedAt };
    }

    it("gives each translation attempt at most 15 s and retries while 5 s or more are left", async () => {
      vi.useFakeTimers();
      scribeAnswersAfter(3_000);
      const waits: number[] = [];
      openRouterMock.mockImplementation(hangUntilAborted(waits));
      const logged = spyOnConsole();

      const { response, elapsedMs } = await postWithFakeTimers();

      // Scribe 3 s, first attempt 15 s (t = 18 s), 9 s left: the retry gets 9 s.
      expect(waits).toEqual([15_000, 9_000]);
      expect(elapsedMs).toBe(27_000);
      await expectTranscriptionFailureResponse(response);
      expect(db.records[0]).toMatchObject({ outcome: "failed", translation: "failed", completed: true });
      expect(logged()).toContain("timeout");
      expectNothingSensitiveIn(logged());
    });

    it("does not retry when less than 5 s are left before the 27 s deadline", async () => {
      vi.useFakeTimers();
      scribeAnswersAfter(8_000);
      const waits: number[] = [];
      openRouterMock.mockImplementation(hangUntilAborted(waits));
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const { response, elapsedMs } = await postWithFakeTimers();

      // Scribe 8 s, first attempt 15 s (t = 23 s), 4 s left: no retry.
      expect(waits).toEqual([15_000]);
      expect(elapsedMs).toBe(23_000);
      await expectTranscriptionFailureResponse(response);
    });

    it("cuts a slow Scribe's translation off at the 27 s deadline", async () => {
      vi.useFakeTimers();
      scribeAnswersAfter(20_000);
      const waits: number[] = [];
      openRouterMock.mockImplementation(hangUntilAborted(waits));
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const { response, elapsedMs } = await postWithFakeTimers();

      expect(waits).toEqual([7_000]);
      expect(elapsedMs).toBe(27_000);
      await expectTranscriptionFailureResponse(response);
    });

    it("retries a fast failure and succeeds inside the deadline", async () => {
      vi.useFakeTimers();
      scribeAnswersAfter(5_000);
      openRouterMock
        .mockImplementationOnce(() => new Promise((resolve) =>
          setTimeout(() => resolve(new Response("", { status: 502 })), 2_000)))
        .mockImplementationOnce(() => new Promise((resolve) =>
          setTimeout(() => resolve(translated(englishTranslation)), 4_000)));
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const { response, elapsedMs } = await postWithFakeTimers();

      expect(elapsedMs).toBe(11_000);
      await expect(response.json()).resolves.toMatchObject({ outcome: "ok", text: englishTranslation });
    });
  });
});
