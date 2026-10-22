import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
// S3 is the upload's process boundary.
const s3 = mockClient(S3Client);

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
const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002 };

const TEN_MIB = 10 * 1024 * 1024;
// A photo key: this Student's photo prefix, a v4 UUID and the type's extension.
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
    return [];
  });
}

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

// One multipart part, built by hand: jsdom's FormData mangles binary parts.
function photoRequest(studentId: string, part: { mimeType: string; bytes: Uint8Array } | null): Request {
  const boundary = "----blended-photo-test";
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  if (part) {
    chunks.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.bin"\r\nContent-Type: ${part.mimeType}\r\n\r\n`
      ),
      part.bytes,
      enc.encode("\r\n")
    );
  } else {
    chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nno file\r\n`));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return new Request(`http://localhost/api/blended-learning/students/${studentId}/photos`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: body as unknown as BodyInit,
  });
}

async function upload(studentId: string, part: { mimeType: string; bytes: Uint8Array } | null) {
  const res = await POST(photoRequest(studentId, part), routeParams({ id: studentId }));
  return { status: res.status, body: await res.json() };
}

function puts() {
  return s3.commandCalls(PutObjectCommand).map((call) => call.args[0].input);
}

beforeEach(() => {
  vi.clearAllMocks();
  givenTables();
  s3.reset();
  s3.on(PutObjectCommand).resolves({});
  vi.stubEnv("S3_DOCS_BUCKET", "test-bucket");
  vi.stubEnv("S3_DOCS_PREFIX", "lms-documents");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/blended-learning/students/[id]/photos", () => {
  it("stores a Mentor's JPEG under the Mentee's photo prefix and returns its key, type and size", async () => {
    signedInAs(MENTOR_A);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const res = await upload("501", { mimeType: "image/jpeg", bytes });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      s3Key: expect.stringMatching(new RegExp(`^lms-documents/blended-learning/photos/501/${UUID}\\.jpg$`)),
      contentType: "image/jpeg",
      byteSize: 8,
    });
    expect(puts()).toEqual([
      { Bucket: "test-bucket", Key: res.body.s3Key, Body: expect.anything(), ContentType: "image/jpeg" },
    ]);
    expect(new Uint8Array(puts()[0].Body as Buffer)).toEqual(bytes);
  });

  it("keeps a PNG's type and extension", async () => {
    signedInAs(ADMIN);
    const res = await upload("601", { mimeType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });

    expect(res.status).toBe(201);
    expect(res.body.s3Key).toMatch(new RegExp(`^lms-documents/blended-learning/photos/601/${UUID}\\.png$`));
    expect(res.body.contentType).toBe("image/png");
    expect(puts()[0].ContentType).toBe("image/png");
  });

  it("accepts an image of exactly 10 MiB", async () => {
    signedInAs(MENTOR_A);
    const res = await upload("501", { mimeType: "image/webp", bytes: new Uint8Array(TEN_MIB) });
    expect(res.status).toBe(201);
    expect(res.body.byteSize).toBe(10485760);
  });

  it.each([
    ["a PDF", { mimeType: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }],
    ["a GIF", { mimeType: "image/gif", bytes: new Uint8Array([0x47, 0x49, 0x46]) }],
    ["an image over 10 MiB", { mimeType: "image/jpeg", bytes: new Uint8Array(TEN_MIB + 1) }],
    ["an empty image", { mimeType: "image/jpeg", bytes: new Uint8Array(0) }],
    ["a request with no photo", null],
  ])("rejects %s (422) and stores nothing", async (_case, part) => {
    signedInAs(MENTOR_A);
    const res = await upload("501", part);
    expect(res.status).toBe(422);
    expect(res.body.error).toEqual(expect.any(String));
    expect(puts()).toEqual([]);
  });

  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await upload("501", { mimeType: "image/jpeg", bytes: new Uint8Array([1]) })).status).toBe(401);
    expect(puts()).toEqual([]);
  });

  it.each([
    ["a read-only Blended Learning Admin", ADMIN_READ_ONLY],
    ["a user without Blended Learning access", TEACHER],
  ])("returns 403 to %s and stores nothing", async (_case, email) => {
    signedInAs(email);
    expect((await upload("501", { mimeType: "image/jpeg", bytes: new Uint8Array([1]) })).status).toBe(403);
    expect(puts()).toEqual([]);
  });

  it.each([
    ["another Mentor's Mentee", "601"],
    ["an unmapped Student", "503"],
    ["a malformed id", "50x"],
  ])("returns 404 for %s and stores nothing", async (_case, studentId) => {
    signedInAs(MENTOR_A);
    expect((await upload(studentId, { mimeType: "image/jpeg", bytes: new Uint8Array([1]) })).status).toBe(404);
    expect(puts()).toEqual([]);
  });

  it("returns 502 when S3 refuses the upload", async () => {
    signedInAs(MENTOR_A);
    s3.on(PutObjectCommand).rejects(Object.assign(new Error("Access Denied"), { name: "AccessDenied" }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await upload("501", { mimeType: "image/jpeg", bytes: new Uint8Array([1]) });

    expect(res.status).toBe(502);
    expect(errors.mock.calls.flat().join(" ")).not.toContain("blended-learning/photos");
    errors.mockRestore();
  });
});
