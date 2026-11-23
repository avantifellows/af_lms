// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Explicitly opt in with a migrated, disposable local DB that includes
// db-service #858 (holistic_mentorship_dictation_usage_records) and the
// migration adding its detected_language and translation columns. Synthetic
// rows remain; drop the disposable DB to remove them. ElevenLabs and OpenRouter
// are faked at fetch.
// HOLISTIC_DICTATION_TEST_DATABASE=dbservice_test_lms500 DATABASE_HOST=localhost \
// DATABASE_USER=postgres DATABASE_PASSWORD=postgres npx vitest run src/lib/holistic-dictation.integration.test.ts
const database = process.env.HOLISTIC_DICTATION_TEST_DATABASE;
const runId = randomUUID();
let db: typeof import("./db");
let dictation: typeof import("./holistic-dictation");
let schoolId: number;
let programId: number;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Every outbound call goes through fetchMock, which hands it to the fake for
// the provider it targets.
const fetchMock = vi.fn();
const scribeMock = vi.fn();
const openRouterMock = vi.fn();

function scribeSaid(text: string, lastWordEndSeconds: number, languageCode: string | null = "eng") {
  return Response.json({
    ...(languageCode ? { language_code: languageCode, language_probability: 0.95 } : {}),
    text,
    words: [{ text, type: "word", start: 0, end: lastWordEndSeconds }],
  });
}

function translated(content: string) {
  return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
}

async function newMentor() {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO "user" (first_name, email, inserted_at, updated_at)
     VALUES ('Issue500 synthetic mentor', $1, now(), now()) RETURNING id`,
    [`issue500-${randomUUID()}@example.com`]);
  return Number(row.id);
}

function dictate(mentorUserId: number, at: string, durationMs: number) {
  return dictation.transcribeHolisticDictation({
    mentorUserId,
    schoolId,
    programId,
    kind: "post_session",
    clip: { audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), filename: "clip.webm" },
    durationMs,
    now: new Date(at),
  });
}

function remaining(mentorUserId: number, at: string) {
  return dictation.getHolisticDictationRemainingSeconds(mentorUserId, new Date(at));
}

async function recordsOf(mentorUserId: number) {
  return db.query<{
    note_kind: string; audio_seconds: number; characters_returned: number;
    outcome: string; detected_language: string | null; translation: string; completed: boolean;
  }>(
    `SELECT note_kind, audio_seconds, characters_returned, outcome, detected_language, translation,
            completed_at IS NOT NULL AS completed
     FROM holistic_mentorship_dictation_usage_records
     WHERE mentor_user_id = $1 ORDER BY id`,
    [mentorUserId]);
}

// Skipping does not import db.ts, construct a pool, or load application DB env.
describe.skipIf(!database)("Holistic Dictation usage against disposable Postgres", () => {
  beforeAll(async () => {
    const host = process.env.DATABASE_HOST || "localhost";
    if (!database || !/^dbservice_test_[a-z0-9_]+$/.test(database)
      || !["localhost", "127.0.0.1"].includes(host)) {
      throw new Error("Integration tests require a localhost/127.0.0.1 host and dbservice_test_ database name");
    }
    if ((globalThis as { pool?: unknown }).pool) {
      throw new Error("Integration tests must start before the database singleton is initialized");
    }
    process.env.DATABASE_HOST = host;
    process.env.DATABASE_NAME = database;
    process.env.DATABASE_SSL = "false";
    db = await import("./db");
    dictation = await import("./holistic-dictation");
    const [connection] = await db.query<{ name: string; address: string }>(
      "SELECT current_database() AS name, host(inet_server_addr()) AS address");
    expect(connection.name).toBe(database);
    expect(["127.0.0.1", "::1"]).toContain(connection.address);
    await db.query("SELECT 1 FROM holistic_mentorship_dictation_usage_records LIMIT 0");

    const [school] = await db.query<{ id: string }>(
      "INSERT INTO school (name, inserted_at, updated_at) VALUES ($1, now(), now()) RETURNING id",
      [`Issue500 synthetic ${runId}`]);
    schoolId = Number(school.id);
    const [program] = await db.query<{ id: string }>("SELECT id FROM program WHERE id = 1");
    programId = Number(program.id);
  });

  beforeEach(() => {
    vi.stubEnv("HOLISTIC_DICTATION_ENABLED", "true");
    vi.stubEnv("HOLISTIC_DICTATION_ELEVENLABS_API_KEY", "sk_integration_dummy");
    vi.stubEnv("HOLISTIC_DICTATION_OPENROUTER_API_KEY", "sk-or-integration-dummy");
    fetchMock.mockReset();
    scribeMock.mockReset();
    openRouterMock.mockReset();
    fetchMock.mockImplementation((target: string, init: RequestInit) =>
      (String(target) === OPENROUTER_URL ? openRouterMock : scribeMock)(target, init));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("counts a clip toward the India-time day it was recorded in", async () => {
    const mentor = await newMentor();
    scribeMock.mockImplementation(async () => scribeSaid("Yes", 0.5));

    // 18:29 UTC is 23:59 IST on 10 Nov; 18:31 UTC is 00:01 IST on 11 Nov.
    await dictate(mentor, "2026-11-10T18:29:00Z", 10_000);
    await dictate(mentor, "2026-11-10T18:31:00Z", 20_000);

    await expect(remaining(mentor, "2026-11-10T10:00:00Z")).resolves.toBe(1790);
    await expect(remaining(mentor, "2026-11-10T18:29:59Z")).resolves.toBe(1790);
    await expect(remaining(mentor, "2026-11-10T18:30:00Z")).resolves.toBe(1780);
    await expect(remaining(mentor, "2026-11-11T18:29:59Z")).resolves.toBe(1780);
    await expect(remaining(mentor, "2026-11-11T18:30:00Z")).resolves.toBe(1800);
  });

  it("sums only this Mentor's clips and never reports below zero", async () => {
    const mentor = await newMentor();
    const otherMentor = await newMentor();
    scribeMock.mockImplementation(async () => scribeSaid("Fine", 1));
    const at = "2026-11-12T06:00:00Z";

    await dictate(otherMentor, at, 125_000);
    await dictate(mentor, at, 125_000);
    await dictate(mentor, at, 125_000);
    await expect(remaining(mentor, at)).resolves.toBe(1550);

    for (let clip = 0; clip < 12; clip += 1) await dictate(mentor, at, 125_000);
    await expect(remaining(mentor, at)).resolves.toBe(50);
    // 1,750 used + 60 s = 1,810: refused with the real 50 s left, and not recorded.
    await expect(dictate(mentor, at, 60_000)).resolves.toEqual({ outcome: "daily_limit", remainingSeconds: 50 });
    expect(await recordsOf(mentor)).toHaveLength(14);
    // 1,750 used + 55 s = 1,805: allowed, leaving -5, shown as 0.
    await expect(dictate(mentor, at, 55_000)).resolves.toMatchObject({ outcome: "ok", remainingSeconds: 0 });
    await expect(remaining(mentor, at)).resolves.toBe(0);
    await expect(dictate(mentor, at, 1_000)).resolves.toEqual({ outcome: "daily_limit", remainingSeconds: 0 });
    expect(await recordsOf(mentor)).toHaveLength(15);
    await expect(remaining(otherMentor, at)).resolves.toBe(1675);
  });

  it("finishes a record with its outcome, characters and the longer of clip and words", async () => {
    const mentor = await newMentor();
    scribeMock.mockResolvedValue(scribeSaid("She said exam stress is high.", 4.9));

    await dictate(mentor, "2026-11-13T06:00:00Z", 4_200);

    expect(openRouterMock).not.toHaveBeenCalled();
    expect(await recordsOf(mentor)).toEqual([{
      note_kind: "post_session", audio_seconds: 5, characters_returned: 29, outcome: "ok",
      detected_language: "eng", translation: "skipped", completed: true,
    }]);
  });

  it("records a translated clip with the language heard and the English length returned", async () => {
    const mentor = await newMentor();
    const english = "The student said the exam stress is very high.";
    scribeMock.mockResolvedValue(scribeSaid("छात्र ने कहा कि परीक्षा का तनाव बहुत है।", 5.6, "HIN"));
    openRouterMock.mockResolvedValue(translated(english));

    await expect(dictate(mentor, "2026-11-13T07:00:00Z", 4_200))
      .resolves.toMatchObject({ outcome: "ok", text: english });

    expect(await recordsOf(mentor)).toEqual([{
      note_kind: "post_session", audio_seconds: 6, characters_returned: english.length, outcome: "ok",
      detected_language: "hin", translation: "ok", completed: true,
    }]);
  });

  it("records a failed translation as a failed clip that still counts", async () => {
    const mentor = await newMentor();
    scribeMock.mockResolvedValue(scribeSaid("Usne bola exam ka stress hai.", 4.9, "hin"));
    openRouterMock.mockImplementation(async () => new Response("upstream error", { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const at = "2026-11-13T08:00:00Z";

    await expect(dictate(mentor, at, 4_200)).resolves.toEqual({ outcome: "failed", remainingSeconds: 1795 });

    expect(openRouterMock).toHaveBeenCalledTimes(2);
    expect(await recordsOf(mentor)).toEqual([{
      note_kind: "post_session", audio_seconds: 5, characters_returned: 0, outcome: "failed",
      detected_language: "hin", translation: "failed", completed: true,
    }]);
  });

  it("records no language and no translation when nothing was heard", async () => {
    const mentor = await newMentor();
    scribeMock.mockResolvedValue(Response.json({ language_code: "hin", text: " ", words: [] }));

    await expect(dictate(mentor, "2026-11-13T09:00:00Z", 3_000))
      .resolves.toEqual({ outcome: "nothing_heard", remainingSeconds: 1797 });

    expect(await recordsOf(mentor)).toEqual([{
      note_kind: "post_session", audio_seconds: 3, characters_returned: 0, outcome: "nothing_heard",
      detected_language: null, translation: "not_run", completed: true,
    }]);
  });

  it("refuses a translation status outside the four allowed values", async () => {
    const mentor = await newMentor();
    await expect(db.query(
      `INSERT INTO holistic_mentorship_dictation_usage_records
         (mentor_user_id, school_id, program_id, note_kind, audio_seconds, characters_returned,
          outcome, translation, inserted_at, updated_at)
       VALUES ($1, $2, $3, 'post_session', 1, 0, 'failed', 'translated', now(), now())`,
      [mentor, schoolId, programId])).rejects.toThrow();
  });

  it("records a five-minute clip, and at most 305 s when the words run past it", async () => {
    const mentor = await newMentor();
    scribeMock
      .mockResolvedValueOnce(scribeSaid("Long answer", 299.6))
      .mockResolvedValueOnce(scribeSaid("An even longer answer", 311.2));
    const at = "2026-11-15T06:00:00Z";

    await expect(dictate(mentor, at, 300_000)).resolves.toMatchObject({ outcome: "ok", remainingSeconds: 1500 });
    await expect(dictate(mentor, at, 300_000)).resolves.toMatchObject({ outcome: "ok", remainingSeconds: 1195 });

    expect((await recordsOf(mentor)).map((record) => record.audio_seconds)).toEqual([300, 305]);
  });

  it("leaves a killed attempt failed and uncompleted, and still counts it", async () => {
    const mentor = await newMentor();
    let duringCall: { records: Awaited<ReturnType<typeof recordsOf>>; remainingSeconds: number } | null = null;
    // What the table holds while ElevenLabs is working is what stays if the
    // host kills the request at that moment.
    scribeMock.mockImplementation(async () => {
      duringCall = {
        records: await recordsOf(mentor),
        remainingSeconds: await remaining(mentor, "2026-11-14T06:00:00Z"),
      };
      return new Response("upstream error", { status: 500 });
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await dictate(mentor, "2026-11-14T06:00:00Z", 7_400);

    expect(duringCall).toEqual({
      records: [{
        note_kind: "post_session", audio_seconds: 8, characters_returned: 0, outcome: "failed",
        detected_language: null, translation: "not_run", completed: false,
      }],
      remainingSeconds: 1792,
    });
    expect(await recordsOf(mentor)).toEqual([{
      note_kind: "post_session", audio_seconds: 8, characters_returned: 0, outcome: "failed",
      detected_language: null, translation: "not_run", completed: true,
    }]);
  });
});
