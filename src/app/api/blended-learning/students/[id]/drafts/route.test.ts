import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { jsonRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { withTransaction } from "@/lib/db";
import { MAPPING, MENTOR, READ_ONLY_ADMIN, mockBlendedDb, pgError, rows, signedInAs } from "@/app/api/blended-learning/test-db";
import { POST } from "./route";

// S3 holds the uploaded recording; HeadObject confirms it and its size.
const s3 = mockClient(S3Client);
// etl-next's enqueue endpoint is the wake call's process boundary.
const mockFetch = vi.fn();

const KEY_501 = "lms-documents/blended-learning/recordings/501/3f2b8c1e-7d4a-4c9b-8e21-5a6f0d9c1b2e.mp3";
const KEY_601 = "lms-documents/blended-learning/recordings/601/9a1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e.m4a";
const OVERSIZED_KEY = "lms-documents/blended-learning/recordings/501/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.mp3";
const OVERSIZED_BYTES = 200 * 1024 * 1024 + 1;
const UPLOADED = { s3Key: KEY_501, contentType: "audio/mpeg", byteSize: 4_200_000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let db: ReturnType<typeof mockBlendedDb>;

async function createDraft(studentId: string, body: unknown) {
  const res = await POST(
    jsonRequest(`http://localhost/api/blended-learning/students/${studentId}/drafts`, { method: "POST", body }),
    routeParams({ id: studentId })
  );
  return { status: res.status, body: await res.json() };
}

function configureEtl() {
  vi.stubEnv("BLENDED_LEARNING_ETL_URL", "https://etl.test/");
  vi.stubEnv("BLENDED_LEARNING_ETL_TOKEN", "etl-machine-token");
  vi.stubEnv("APP_ENV", "staging");
}

// The insert transaction: the locked Mapping, the draft, then its request.
function givenSaves() {
  db.clientQuery.mockResolvedValueOnce(rows(MAPPING)).mockResolvedValueOnce(rows({ id: 41 })).mockResolvedValueOnce(rows());
}

// The new request's key, from its INSERT.
function requestKey(): string {
  return db.clientQuery.mock.calls[2][1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  // Today is 22 Oct 2026 in IST.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T06:00:00Z"));
  db = mockBlendedDb();
  // Student 501 is in scope.
  db.query.mockResolvedValue([{ mentor_user_id: 9001 }]);
  s3.reset();
  s3.on(HeadObjectCommand).rejects(Object.assign(new Error("NotFound"), { name: "NotFound" }));
  s3.on(HeadObjectCommand, { Key: KEY_501 }).resolves({ ContentLength: 4_200_000 });
  s3.on(HeadObjectCommand, { Key: OVERSIZED_KEY }).resolves({ ContentLength: OVERSIZED_BYTES });
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("S3_DOCS_BUCKET", "test-bucket");
  vi.stubEnv("S3_DOCS_PREFIX", "lms-documents");
  // ETL is unconfigured unless a test configures it.
  vi.stubEnv("BLENDED_LEARNING_ETL_URL", "");
  vi.stubEnv("BLENDED_LEARNING_ETL_TOKEN", "");
  vi.stubEnv("APP_ENV", "");
  signedInAs(MENTOR);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/blended-learning/students/[id]/drafts", () => {
  it("creates a transcribing draft and a queued Transcription Request in one transaction", async () => {
    givenSaves();
    const res = await createDraft("501", {
      ...UPLOADED, occurredOn: "2026-10-21", mode: "call", spokeWith: "both", durationMinutes: 35,
    });

    expect(res).toEqual({ status: 201, body: { draftId: 41 } });
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(db.clientQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("INSERT INTO blended_learning_conversation_drafts"), [
      501, 80, MAPPING.academic_year, 9001, MENTOR.actorEmail, "transcribing",
      "2026-10-21", "call", "both", 35, KEY_501, "audio/mpeg",
    ]);
    expect(db.clientQuery).toHaveBeenNthCalledWith(3, expect.stringContaining("INSERT INTO blended_learning_transcription_requests"), [
      expect.stringMatching(UUID), 41, 501, MENTOR.actorEmail, "queued",
    ]);
    // ETL is unconfigured here.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await createDraft("501", UPLOADED)).status).toBe(401);
  });

  it.each([
    ["a user without Blended Learning access", "no access" as const],
    ["a read-only Blended Learning Admin", READ_ONLY_ADMIN],
  ])("returns 403 to %s", async (_case, who) => {
    signedInAs(who);
    expect((await createDraft("501", UPLOADED)).status).toBe(403);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 for another Mentor's Mentee", async () => {
    db.query.mockResolvedValue([{ mentor_user_id: 9002 }]);
    expect(await createDraft("601", { ...UPLOADED, s3Key: KEY_601 })).toEqual({ status: 404, body: { error: "Not found" } });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["another Student's recording", { s3Key: KEY_601 }, "This recording isn't this Mentee's. Upload it again."],
    ["a recording that never reached S3", { s3Key: KEY_501.replace("3f2b8c1e", "00000000") }, "The recording didn't finish uploading. Upload it again."],
    ["a recording S3 holds at over 200 MB", { s3Key: OVERSIZED_KEY, byteSize: OVERSIZED_BYTES }, "A recording must be 200 MB or smaller."],
  ])("rejects %s (422) and creates nothing", async (_case, change, message) => {
    expect(await createDraft("501", { ...UPLOADED, ...change })).toEqual({
      status: 422,
      body: { error: message, fieldErrors: { s3Key: message } },
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 when the open-draft unique index refuses a second draft", async () => {
    db.clientQuery.mockResolvedValueOnce(rows(MAPPING)).mockRejectedValueOnce(pgError("23505"));
    expect(await createDraft("501", UPLOADED)).toEqual({
      status: 409,
      body: { error: "This Mentee already has a Conversation Draft." },
    });
  });

  describe("waking etl-next", () => {
    it("POSTs the new request key to etl-next's enqueue endpoint", async () => {
      configureEtl();
      givenSaves();
      mockFetch.mockResolvedValue(new Response(null, { status: 202 }));

      expect((await createDraft("501", UPLOADED)).status).toBe(201);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`https://etl.test/api/internal/blended-learning/transcription-requests/${requestKey()}/enqueue`);
      expect(init).toEqual(
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer etl-machine-token", "Content-Type": "application/json" },
          body: JSON.stringify({ environment: "staging" }),
          signal: expect.any(AbortSignal),
        })
      );
    });

    it.each([
      ["the URL is blank", { BLENDED_LEARNING_ETL_URL: " " }],
      ["the token is missing", { BLENDED_LEARNING_ETL_TOKEN: "" }],
      ["APP_ENV is development", { APP_ENV: "development" }],
    ])("skips the wake with no fetch when %s", async (_case, env) => {
      configureEtl();
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
      givenSaves();

      expect((await createDraft("501", UPLOADED)).status).toBe(201);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each([
      ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
      ["a 404", () => Promise.resolve(new Response(null, { status: 404 }))],
      ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
    ])("keeps the draft on %s: the request stays queued, with no further writes", async (_case, respond) => {
      configureEtl();
      givenSaves();
      mockFetch.mockImplementation(respond);
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await createDraft("501", UPLOADED)).toEqual({ status: 201, body: { draftId: 41 } });
      expect(withTransaction).toHaveBeenCalledTimes(1);
      expect(db.clientQuery).toHaveBeenCalledTimes(3);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("logs a refused wake by status only, never the request or recording key", async () => {
      configureEtl();
      givenSaves();
      mockFetch.mockResolvedValue(new Response(null, { status: 401 }));
      const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
      for (const spy of logs) spy.mockImplementation(() => {});

      await createDraft("501", UPLOADED);

      expect(console.error).toHaveBeenCalledWith("[blended-learning] etl-next wake failed", { status: 401 });
      const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
      expect(logged).not.toContain(requestKey());
      expect(logged).not.toContain("blended-learning/recordings");
    });
  });
});
