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
  completed: boolean;
};

const { db, mockAccess, mockSession } = vi.hoisted(() => ({
  db: {
    scope: null as null | Record<string, unknown>,
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
  async function query(text: string, params: unknown[] = []) {
    if (text.includes(usageTable) && /SUM\(/i.test(text)) {
      const recorded = db.records.reduce((sum, record) => sum + record.audioSeconds, 0);
      return [{ used_seconds: db.usedTodaySeconds + recorded }];
    }
    if (text.includes(`INSERT INTO ${usageTable}`)) {
      const [mentorUserId, schoolId, programId, noteKind, audioSeconds] = params as [
        number, number, number, string, number,
      ];
      const record = {
        id: db.records.length + 1, mentorUserId, schoolId, programId, noteKind,
        audioSeconds, charactersReturned: 0, outcome: "failed", completed: false,
      };
      db.records.push(record);
      return [{ id: record.id }];
    }
    if (text.includes(`UPDATE ${usageTable}`)) {
      const [id, outcome, charactersReturned, audioSeconds] = params as [number, string, number, number];
      Object.assign(db.records.find((record) => record.id === id)!, {
        outcome, charactersReturned, audioSeconds, completed: /completed_at\s*=/.test(text),
      });
      return [];
    }
    throw new Error(`Unexpected query: ${text}`);
  }
  async function withTransaction<T>(fn: (client: unknown) => Promise<T>) {
    db.transactionOpen = true;
    try {
      return await fn({
        query: async (text: string) => {
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

import { POST } from "./route";

const context = { params: Promise.resolve({ studentId: "41", phaseId: "73" }) };
const url = "http://localhost/api/holistic-mentorship/students/41/phases/73/dictation";
const contextQuery = "?school_code=SCH001&academic_year=2026-2027&program_id=1";
const apiKey = "sk_live_dictation_key_123";

const fetchMock = vi.fn();

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

const spokenReply = {
  text: " Usne bola exam ka stress hai. ",
  words: [
    { text: "Usne", type: "word", start: 0.2, end: 0.6 },
    { text: "hai.", type: "word", start: 4.4, end: 4.9 },
  ],
};

const mentorAccess = {
  ok: true,
  email: "nila.sen@example.com",
  actorUserId: 9,
  permission: { role: "teacher" },
  canEdit: true,
  school: { id: 4 },
};

const openScope = { mapping_id: 300, mentor_user_id: 9, phase_revision: 2, phase_state: "open" };

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
  expect(logs).not.toMatch(/Usne|bola|stress/);
  expect(logs).not.toMatch(/\b41\b|\b73\b/); // Student and Phase ids
}

describe("Holistic Dictation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db, {
      scope: { ...openScope }, notesState: "draft", usedTodaySeconds: 0, records: [],
      transactionOpen: false,
    });
    vi.stubEnv("HOLISTIC_DICTATION_ENABLED", "true");
    vi.stubEnv("HOLISTIC_DICTATION_ELEVENLABS_API_KEY", apiKey);
    vi.stubEnv("HOLISTIC_DICTATION_ELEVENLABS_ZERO_RETENTION", "");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(scribeReply(spokenReply));
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
    ["the flag is off", "false", apiKey],
    ["the flag is unset", "", apiKey],
    ["the flag is on but no key is set", "true", ""],
  ])("returns 404 without calling ElevenLabs when %s", async (_label, flag, key) => {
    vi.stubEnv("HOLISTIC_DICTATION_ENABLED", flag);
    vi.stubEnv("HOLISTIC_DICTATION_ELEVENLABS_API_KEY", key);

    const response = await post();

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.records).toEqual([]);
  });

  it("returns the Mentor's verbatim words and records the attempt", async () => {
    db.usedTodaySeconds = 600;

    const response = await post({ duration_ms: "4200" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcome: "ok",
      text: "Usne bola exam ka stress hai.",
      remainingSeconds: 1195,
    });
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "nila.sen@example.com" } },
      "notes_draft",
      { schoolCode: "SCH001", studentId: 41, academicYear: "2026-2027", programId: 1 },
    );
    // duration 4.2 s, last word ends at 4.9 s → ceil(4.9) = 5 s.
    expect(db.records).toEqual([{
      id: 1, mentorUserId: 9, schoolId: 4, programId: 1, noteKind: "post_session",
      audioSeconds: 5, charactersReturned: 29, outcome: "ok", completed: true,
    }]);
  });

  it("returns nothing heard when Scribe hears no words, and still counts the clip", async () => {
    fetchMock.mockResolvedValue(scribeReply({ text: "  ", words: [] }));

    const response = await post({ duration_ms: "3000" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: "nothing_heard", remainingSeconds: 1797 });
    expect(db.records).toEqual([expect.objectContaining({
      audioSeconds: 3, charactersReturned: 0, outcome: "nothing_heard", completed: true,
    })]);
  });

  it.each([
    ["a 401", () => scribeReply({ detail: `bad key ${apiKey}` }, 401)],
    ["a 422", () => scribeReply({ detail: "Usne bola exam ka stress hai" }, 422)],
    ["a 503", () => new Response("Usne bola exam ka stress hai", { status: 503 })],
    ["malformed JSON", () => new Response("{Usne bola", { status: 200 })],
  ])("returns 502 for %s and records a failed attempt", async (_label, reply) => {
    fetchMock.mockResolvedValue(reply());
    const logged = spyOnConsole();

    const response = await post({ duration_ms: "4200" });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Couldn't transcribe. Try again",
      remainingSeconds: 1795,
    });
    expect(db.records).toEqual([expect.objectContaining({
      audioSeconds: 5, charactersReturned: 0, outcome: "failed", completed: true,
    })]);
    expectNothingSensitiveIn(logged());
  });

  it("returns 502 for a network error and records a failed attempt", async () => {
    fetchMock.mockRejectedValue(new TypeError(`connect ECONNRESET ${apiKey}`));
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
    const file = body.get("file") as File;
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
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
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
    expect(recordWhileWaiting).toMatchObject({ outcome: "failed", completed: false });
    expect(response.status).toBe(502);
    expect(db.records).toEqual([expect.objectContaining({ audioSeconds: 5, outcome: "failed", completed: true })]);
    expect(logged()).toContain("timeout");
    expectNothingSensitiveIn(logged());
  });

  it("records at most 125 seconds when Scribe's words run past the clip", async () => {
    fetchMock.mockResolvedValue(scribeReply({
      text: "Bahut lamba jawab",
      words: [{ text: "jawab", type: "word", start: 130.0, end: 131.2 }],
    }));

    await post({ duration_ms: "120000" });

    expect(db.records[0]).toMatchObject({ audioSeconds: 125, outcome: "ok" });
  });

  function expectNoProviderCallOrRecord() {
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

  it.each(["program_manager", "program_admin", "holistic_mentorship_admin", "admin"])(
    "refuses a read-only %s through the access check",
    async () => {
      mockAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });

      const response = await post();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
      expectNoProviderCallOrRecord();
    },
  );

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
    fetchMock.mockImplementation(async () => {
      transactionOpenDuringCall = db.transactionOpen;
      return scribeReply(spokenReply);
    });

    await post();

    expect(transactionOpenDuringCall).toBe(false);
  });

  const fiveMegabytes = 5 * 1024 * 1024;

  it("returns 422 when no audio is attached", async () => {
    const response = await post({ audio: null });

    expect(response.status).toBe(422);
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

  it("returns 413 for a clip over 5 MB, and accepts exactly 5 MB", async () => {
    const tooBig = await post({ audio: clip(fiveMegabytes + 1, "audio/webm") });
    expect(tooBig.status).toBe(413);
    expectNoProviderCallOrRecord();

    expect((await post({ audio: clip(fiveMegabytes, "audio/webm") })).status).toBe(200);
  });

  it.each(["0", "125001", "-5", "4.5", "abc", ""])("returns 422 for duration_ms %j", async (duration) => {
    const response = await post({ duration_ms: duration });

    expect(response.status).toBe(422);
    expectNoProviderCallOrRecord();
  });

  it.each([["1", 1], ["125000", 125]])("accepts duration_ms %s and records %i s", async (duration, seconds) => {
    fetchMock.mockResolvedValue(scribeReply({ text: "Haan", words: [{ text: "Haan", type: "word", start: 0, end: 0.4 }] }));

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

  it("allows a 15 s clip at 1,790 s used (1,805 ≤ 1,805) and reports 0 remaining", async () => {
    db.usedTodaySeconds = 1790;
    fetchMock.mockResolvedValue(scribeReply({ text: "Theek hai", words: [{ text: "hai", type: "word", start: 1, end: 14.2 }] }));

    const response = await post({ duration_ms: "15000" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: "ok", text: "Theek hai", remainingSeconds: 0 });
    expect(db.records[0]).toMatchObject({ audioSeconds: 15, outcome: "ok" });
  });

  it("logs nothing sensitive when a clip is transcribed", async () => {
    const logged = spyOnConsole();

    await post();

    expectNothingSensitiveIn(logged());
  });
});
