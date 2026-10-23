import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { __resetS3ClientForTesting } from "@/lib/s3";
import { GET } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
// S3 holds etl-next's raw ElevenLabs Scribe response for each saved draft.
const s3 = mockClient(S3Client);

const MENTOR_A = "faizan@avantifellows.org";
const ADMIN = "juned@avantifellows.org";
const ADMIN_READ_ONLY = "shalinijha@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

const TRANSCRIPT_71 = "lms-documents/blended-learning/transcripts/3f2b8c1e-7d4a-4c9b-8e21-5a6f0d9c1b2e.json";
const TRANSCRIPT_72 = "lms-documents/blended-learning/transcripts/9a1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e.json";
const TRANSCRIPT_75 = "lms-documents/blended-learning/transcripts/11111111-2222-4333-8444-555555555555.json";
const TRANSCRIPT_81 = "lms-documents/blended-learning/transcripts/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json";

const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002 };
// 71 has a diarised transcript; 72's has no words, only text; 73 was typed
// by hand (no keys); 74 is an Attempt; 75's transcript has expired from S3;
// 91 is an unmapped Student's.
const CONVERSATIONS: Record<number, { student_id: number; kind: string; transcript_s3_key: string | null }> = {
  71: { student_id: 501, kind: "conversation", transcript_s3_key: TRANSCRIPT_71 },
  72: { student_id: 501, kind: "conversation", transcript_s3_key: TRANSCRIPT_72 },
  73: { student_id: 501, kind: "conversation", transcript_s3_key: null },
  74: { student_id: 501, kind: "attempt", transcript_s3_key: null },
  75: { student_id: 501, kind: "conversation", transcript_s3_key: TRANSCRIPT_75 },
  81: { student_id: 601, kind: "conversation", transcript_s3_key: TRANSCRIPT_81 },
  91: { student_id: 503, kind: "conversation", transcript_s3_key: TRANSCRIPT_71 },
};

// Scribe responses as etl-next stores them: spacing tokens between words,
// a speaker_id on every token. The Mentor (speaker_1) speaks first.
const DIARISED = {
  language_code: "hin",
  text: "Namaste beta. Namaste sir. Test kaisa gaya?",
  words: [
    { text: "Namaste", type: "word", speaker_id: "speaker_1" },
    { text: " ", type: "spacing", speaker_id: "speaker_1" },
    { text: "beta.", type: "word", speaker_id: "speaker_1" },
    { text: " ", type: "spacing", speaker_id: "speaker_1" },
    { text: "Namaste", type: "word", speaker_id: "speaker_0" },
    { text: " ", type: "spacing", speaker_id: "speaker_0" },
    { text: "sir.", type: "word", speaker_id: "speaker_0" },
    { text: " ", type: "spacing", speaker_id: "speaker_0" },
    { text: "Test", type: "word", speaker_id: "speaker_1" },
    { text: " ", type: "spacing", speaker_id: "speaker_1" },
    { text: "kaisa", type: "word", speaker_id: "speaker_1" },
    { text: " ", type: "spacing", speaker_id: "speaker_1" },
    { text: "gaya?", type: "word", speaker_id: "speaker_1" },
  ],
};
const TEXT_ONLY = { language_code: "eng", text: "  Mock test went well.  ", words: [] };
const OBJECTS: Record<string, string> = {
  [TRANSCRIPT_71]: JSON.stringify(DIARISED),
  [TRANSCRIPT_72]: JSON.stringify(TEXT_ONLY),
  [TRANSCRIPT_81]: JSON.stringify({ text: "Hello.", words: [{ text: "Hello.", type: "word", speaker_id: "speaker_0" }] }),
};

function givenTables() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_permission")) {
      const email = String(params?.[0]).toLowerCase();
      const row = PERMISSIONS[email];
      return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
    }
    if (sql.includes("FROM blended_learning_mentor_mentee_mappings")) {
      const mentor = MAPPINGS[Number(params?.[0])];
      return mentor ? [{ mentor_user_id: mentor }] : [];
    }
    if (sql.includes("FROM blended_learning_conversations")) {
      const row = CONVERSATIONS[Number(params?.[0])];
      return row ? [{ notes_html: null, call_recording_s3_key: null, ...row }] : [];
    }
    return [];
  });
}

function givenS3() {
  s3.on(GetObjectCommand).callsFake(async (input: { Key: string }) => {
    const body = OBJECTS[input.Key];
    if (body !== undefined) return { Body: { transformToString: async () => body } };
    throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
  });
}

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function getTranscript(conversationId: string) {
  const res = await GET(
    new Request(`http://localhost/api/blended-learning/conversations/${conversationId}/transcript`),
    routeParams({ id: conversationId })
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

beforeEach(() => {
  vi.clearAllMocks();
  s3.reset();
  givenTables();
  givenS3();
  vi.stubEnv("S3_DOCS_BUCKET", "test-bucket");
  vi.stubEnv("S3_DOCS_PREFIX", "lms-documents");
  vi.stubEnv("S3_DOCS_REGION", "ap-south-1");
  vi.stubEnv("S3_DOCS_ACCESS_KEY_ID", "AKIATESTKEY");
  vi.stubEnv("S3_DOCS_SECRET_ACCESS_KEY", "test-secret");
  __resetS3ClientForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetS3ClientForTesting();
});

describe("GET /api/blended-learning/conversations/[id]/transcript", () => {
  it("returns 403 to a Mentor, even for their own Mentee's transcript", async () => {
    signedInAs(MENTOR_A);
    expect(await getTranscript("71")).toMatchObject({ status: 403, body: { error: "Forbidden" } });
    expect(s3.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("groups the words into speaker turns, numbered in the order each speaker first talks", async () => {
    signedInAs(ADMIN);
    const res = await getTranscript("71");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body).toEqual({
      expired: false,
      turns: [
        { speaker: "Speaker 1", text: "Namaste beta." },
        { speaker: "Speaker 2", text: "Namaste sir." },
        { speaker: "Speaker 1", text: "Test kaisa gaya?" },
      ],
    });
  });

  it("falls back to the whole text as one unlabelled turn when there are no words", async () => {
    signedInAs(ADMIN);
    expect(await getTranscript("72")).toMatchObject({
      status: 200,
      body: { expired: false, turns: [{ speaker: null, text: "Mock test went well." }] },
    });
  });

  it("tells an admin the transcript has expired when S3 has no object", async () => {
    signedInAs(ADMIN);
    expect(await getTranscript("75")).toMatchObject({ status: 200, body: { expired: true } });
  });

  it("lets a read-only admin read any mapped Mentee's transcript", async () => {
    signedInAs(ADMIN_READ_ONLY);
    expect(await getTranscript("81")).toMatchObject({
      status: 200,
      body: { expired: false, turns: [{ speaker: "Speaker 1", text: "Hello." }] },
    });
  });

  it("returns 401 when signed out and 403 for a role without Blended Learning access", async () => {
    signedInAs(null);
    expect((await getTranscript("71")).status).toBe(401);
    signedInAs(TEACHER);
    expect((await getTranscript("71")).status).toBe(403);
  });

  it("returns 404 for a keyless Conversation, an Attempt, an unmapped Student, a missing id and a malformed id", async () => {
    signedInAs(ADMIN);
    expect((await getTranscript("73")).status).toBe(404);
    expect((await getTranscript("74")).status).toBe(404);
    expect((await getTranscript("91")).status).toBe(404);
    expect((await getTranscript("99")).status).toBe(404);
    expect((await getTranscript("7x")).status).toBe(404);
    expect(s3.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("returns 502 without logging the key or the transcript when the object is not JSON", async () => {
    signedInAs(ADMIN);
    s3.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => "Namaste beta, the mock" },
    } as never);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const { status, body } = await getTranscript("81");

    expect(status).toBe(502);
    const logged = JSON.stringify([errorLog.mock.calls, log.mock.calls, body]);
    expect(logged).not.toContain("lms-documents");
    expect(logged).not.toContain("Namaste");
    errorLog.mockRestore();
    log.mockRestore();
  });
});
