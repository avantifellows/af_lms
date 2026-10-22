import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { __resetS3ClientForTesting } from "@/lib/s3";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);

const MENTOR_A = "faizan@avantifellows.org";
const ADMIN = "juned@avantifellows.org";
const ADMIN_READ_ONLY = "shalinijha@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

// Fixture tables, keyed the way the SQL reads them.
const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
// Active current-year Mappings: student → Mentor user id. Student 503 is unmapped.
const MAPPINGS: Record<number, number> = { 501: 9001, 502: 9001, 601: 9002 };
// Open Conversation Drafts (transcribing, ready or failed) by Student.
const OPEN_DRAFTS: Record<number, { id: number; state: string }> = { 502: { id: 41, state: "ready" } };

const TWO_HUNDRED_MB = 200 * 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

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
    if (sql.includes("FROM blended_learning_conversation_drafts")) {
      const draft = OPEN_DRAFTS[Number(params?.[0])];
      return draft ? [draft] : [];
    }
    return [];
  });
}

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function issue(studentId: string, body: unknown) {
  const res = await POST(
    jsonRequest(`http://localhost/api/blended-learning/students/${studentId}/recordings/upload-url`, {
      method: "POST",
      body,
    }),
    routeParams({ id: studentId })
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  givenTables();
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

describe("POST /api/blended-learning/students/[id]/recordings/upload-url", () => {
  it("gives a Mentor a 15-minute presigned PUT for an MP3 under the Mentee's recordings prefix", async () => {
    signedInAs(MENTOR_A);
    const res = await issue("501", { fileName: "call with Ira.mp3", contentType: "audio/mpeg", byteSize: 4_200_000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      uploadUrl: expect.any(String),
      s3Key: expect.stringMatching(new RegExp(`^lms-documents/blended-learning/recordings/501/${UUID}\\.mp3$`)),
      contentType: "audio/mpeg",
    });
    const url = new URL(res.body.uploadUrl);
    expect(url.hostname).toBe("test-bucket.s3.ap-south-1.amazonaws.com");
    expect(decodeURIComponent(url.pathname)).toBe(`/${res.body.s3Key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    // The browser must PUT with exactly this Content-Type.
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-type");
  });

  it.each([
    ["an M4A the browser gave no MIME type", "voice.m4a", "", "audio/mp4", "m4a"],
    ["an upper-case .WAV", "CALL.WAV", "audio/x-wav", "audio/wav", "wav"],
    ["an MP3 labelled with an odd MIME type", "call.mp3", "audio/mp3", "audio/mpeg", "mp3"],
  ])("normalises %s from its extension", async (_case, fileName, contentType, expectedType, extension) => {
    signedInAs(ADMIN);
    const res = await issue("601", { fileName, contentType, byteSize: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.contentType).toBe(expectedType);
    expect(res.body.s3Key).toMatch(new RegExp(`^lms-documents/blended-learning/recordings/601/${UUID}\\.${extension}$`));
  });

  it("accepts a recording of exactly 200 MB", async () => {
    signedInAs(MENTOR_A);
    expect((await issue("501", { fileName: "long.wav", contentType: "audio/wav", byteSize: TWO_HUNDRED_MB })).status).toBe(200);
  });

  it.each([
    ["an OGG file", { fileName: "call.ogg", contentType: "audio/ogg", byteSize: 1000 }],
    ["a video", { fileName: "call.mp4", contentType: "video/mp4", byteSize: 1000 }],
    ["a file with no extension", { fileName: "recording", contentType: "audio/mpeg", byteSize: 1000 }],
    ["no file name", { contentType: "audio/mpeg", byteSize: 1000 }],
    ["a recording over 200 MB", { fileName: "call.mp3", contentType: "audio/mpeg", byteSize: TWO_HUNDRED_MB + 1 }],
    ["an empty recording", { fileName: "call.mp3", contentType: "audio/mpeg", byteSize: 0 }],
    ["a size that isn't a number", { fileName: "call.mp3", contentType: "audio/mpeg", byteSize: "4200000" }],
  ])("rejects %s (422)", async (_case, body) => {
    signedInAs(MENTOR_A);
    const res = await issue("501", body);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it("returns 409 when the Mentee already has an open Conversation Draft", async () => {
    signedInAs(MENTOR_A);
    const res = await issue("502", { fileName: "call.mp3", contentType: "audio/mpeg", byteSize: 1000 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This Mentee already has a Conversation Draft." });
  });

  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await issue("501", { fileName: "call.mp3", byteSize: 1000 })).status).toBe(401);
  });

  it.each([
    ["a read-only Blended Learning Admin", ADMIN_READ_ONLY],
    ["a user without Blended Learning access", TEACHER],
  ])("returns 403 to %s", async (_case, email) => {
    signedInAs(email);
    expect((await issue("501", { fileName: "call.mp3", byteSize: 1000 })).status).toBe(403);
  });

  it.each([
    ["another Mentor's Mentee", "601"],
    ["an unmapped Student", "503"],
    ["a malformed id", "50x"],
  ])("returns 404 for %s", async (_case, studentId) => {
    signedInAs(MENTOR_A);
    expect((await issue(studentId, { fileName: "call.mp3", byteSize: 1000 })).status).toBe(404);
  });
});
