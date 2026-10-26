import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
// S3 holds the Call Recordings; HeadObject tells a live one from an expired one.
const s3 = mockClient(S3Client);

const MENTOR_A = "faizan@avantifellows.org";
const ADMIN = "juned@avantifellows.org";
const ADMIN_READ_ONLY = "shalinijha@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

const RECORDING_71 = "lms-documents/blended-learning/recordings/501/3f2b8c1e-7d4a-4c9b-8e21-5a6f0d9c1b2e.mp3";
const RECORDING_72 = "lms-documents/blended-learning/recordings/501/9a1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e.m4a";
const RECORDING_81 = "lms-documents/blended-learning/recordings/601/11111111-2222-4333-8444-555555555555.wav";

// Fixture tables, keyed the way the SQL reads them.
const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
// Active current-year Mappings: student → Mentor user id. Student 503 is unmapped.
const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002 };
// 71 was saved from a draft; 72's recording has expired from S3; 73 was typed
// by hand (no keys); 74 is an Attempt; 91 is an unmapped Student's.
const CONVERSATIONS: Record<number, { student_id: number; kind: string; call_recording_s3_key: string | null }> = {
  71: { student_id: 501, kind: "conversation", call_recording_s3_key: RECORDING_71 },
  72: { student_id: 501, kind: "conversation", call_recording_s3_key: RECORDING_72 },
  73: { student_id: 501, kind: "conversation", call_recording_s3_key: null },
  74: { student_id: 501, kind: "attempt", call_recording_s3_key: null },
  81: { student_id: 601, kind: "conversation", call_recording_s3_key: RECORDING_81 },
  91: { student_id: 503, kind: "conversation", call_recording_s3_key: RECORDING_71 },
};
// Objects still in S3 (the lifecycle rule has removed RECORDING_72).
const OBJECTS = new Set([RECORDING_71, RECORDING_81]);

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
      return row ? [{ notes_html: null, transcript_s3_key: null, ...row }] : [];
    }
    return [];
  });
}

function givenS3() {
  s3.on(HeadObjectCommand).callsFake(async (input: { Key: string }) => {
    if (OBJECTS.has(input.Key)) return { ContentLength: 4_200_000 };
    throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
  });
}

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function getRecording(conversationId: string) {
  const res = await GET(
    new Request(`http://localhost/api/blended-learning/conversations/${conversationId}/recording`),
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

describe("GET /api/blended-learning/conversations/[id]/recording", () => {
  it("returns 403 to a Mentor, even for their own Mentee's recording", async () => {
    signedInAs(MENTOR_A);
    expect(await getRecording("71")).toMatchObject({ status: 403, body: { error: "Forbidden" } });
    expect(s3.commandCalls(HeadObjectCommand)).toHaveLength(0);
  });

  it("gives an admin a 5-minute presigned GET for a live recording", async () => {
    signedInAs(ADMIN);
    const res = await getRecording("71");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body.expired).toBe(false);
    const url = new URL(res.body.url);
    expect(url.host).toBe("test-bucket.s3.ap-south-1.amazonaws.com");
    expect(decodeURIComponent(url.pathname)).toBe(`/${RECORDING_71}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("tells an admin the recording has expired when HEAD finds no object", async () => {
    signedInAs(ADMIN);
    expect(await getRecording("72")).toMatchObject({ status: 200, body: { expired: true } });
  });

  it("still gives a presigned GET when HEAD fails with anything but a 404", async () => {
    signedInAs(ADMIN);
    s3.on(HeadObjectCommand).rejects(
      Object.assign(new Error("Forbidden"), { name: "Forbidden", $metadata: { httpStatusCode: 403 } })
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await getRecording("71");

    expect(res.status).toBe(200);
    expect(res.body.expired).toBe(false);
    expect(new URL(res.body.url).searchParams.get("X-Amz-Expires")).toBe("300");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("lms-documents");
    errorLog.mockRestore();
  });

  it("lets a read-only admin play any mapped Mentee's recording", async () => {
    signedInAs(ADMIN_READ_ONLY);
    const res = await getRecording("81");

    expect(res.status).toBe(200);
    expect(decodeURIComponent(new URL(res.body.url).pathname)).toBe(`/${RECORDING_81}`);
  });

  it("returns 401 when signed out and 403 for a role without Blended Learning access", async () => {
    signedInAs(null);
    expect((await getRecording("71")).status).toBe(401);
    signedInAs(TEACHER);
    expect((await getRecording("71")).status).toBe(403);
  });

  it("returns 404 for a keyless Conversation, an Attempt, an unmapped Student, a missing id and a malformed id", async () => {
    signedInAs(ADMIN);
    expect((await getRecording("73")).status).toBe(404);
    expect((await getRecording("74")).status).toBe(404);
    expect((await getRecording("91")).status).toBe(404);
    expect((await getRecording("99")).status).toBe(404);
    expect((await getRecording("7x")).status).toBe(404);
    expect(s3.commandCalls(HeadObjectCommand)).toHaveLength(0);
  });

  it("returns 502 without leaking the key when signing fails", async () => {
    signedInAs(ADMIN);
    vi.stubEnv("S3_DOCS_BUCKET", "");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, body } = await getRecording("71");

    expect(status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("lms-documents");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("lms-documents");
    errorLog.mockRestore();
  });
});
