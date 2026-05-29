import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  ADMIN_SESSION,
  PASSCODE_SESSION,
  routeParams,
} from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const s3Mock = mockClient(S3Client);

// Set env once for the whole suite.
process.env.S3_DOCS_BUCKET = "test-bucket";
process.env.S3_DOCS_PREFIX = "test-prefix";
process.env.S3_DOCS_REGION = "ap-south-1";
process.env.S3_DOCS_ACCESS_KEY_ID = "test-key";
process.env.S3_DOCS_SECRET_ACCESS_KEY = "test-secret";
process.env.DB_SERVICE_URL = "https://db.test/api";
process.env.DB_SERVICE_TOKEN = "test-token";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  s3Mock.reset();
});

// --- helpers --------------------------------------------------------------

function authorizedAdmin() {
  mockSession.mockResolvedValue(ADMIN_SESSION);
  // First query inside canAccessStudent: getStudentSchool
  mockQuery.mockResolvedValueOnce([{ code: "12345", region: "West" }]);
  // Second query: getUserPermission (level-3 admin)
  mockQuery.mockResolvedValueOnce([
    { email: "admin@avantifellows.org", level: 3, role: "admin", school_codes: null, regions: null, program_ids: null, read_only: false },
  ]);
}

interface MultipartPart {
  field: string;
  filename?: string;
  mimeType?: string;
  bytes: Uint8Array;
}

// jsdom's FormData serializer mishandles binary File parts (it stringifies
// typed arrays). Build the multipart body manually so undici parses it
// exactly as a real client would.
function buildMultipartBody(parts: MultipartPart[]): { body: Uint8Array; contentType: string } {
  const boundary = `----formdata-test-${Math.random().toString(36).slice(2)}`;
  const chunks: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const p of parts) {
    const header = p.filename !== undefined
      ? `--${boundary}\r\nContent-Disposition: form-data; name="${p.field}"; filename="${p.filename}"\r\nContent-Type: ${p.mimeType ?? "application/octet-stream"}\r\n\r\n`
      : `--${boundary}\r\nContent-Disposition: form-data; name="${p.field}"\r\n\r\n`;
    chunks.push(enc.encode(header));
    chunks.push(p.bytes);
    chunks.push(enc.encode("\r\n"));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));

  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

interface BuildFormOpts {
  documentType?: string | null;
  files?: Array<{ field: string; mimeType: string; bytes: Uint8Array }>;
  metadata?: string;
}

// Identity alias kept so existing call sites pass the opts object directly
// (e.g. `multipartRequest(buildFormData({...}))` still type-checks).
function buildFormData(opts: BuildFormOpts): BuildFormOpts {
  return opts;
}

function multipartRequest(opts: BuildFormOpts): Request {
  const parts: MultipartPart[] = [];
  if (opts.documentType !== null) {
    parts.push({
      field: "document_type",
      bytes: new TextEncoder().encode(opts.documentType ?? "wise_research_consent"),
    });
  }
  if (opts.metadata !== undefined) {
    parts.push({
      field: "metadata",
      bytes: new TextEncoder().encode(opts.metadata),
    });
  }
  for (const f of opts.files ?? []) {
    parts.push({
      field: f.field,
      filename: `${f.field}.bin`,
      mimeType: f.mimeType,
      bytes: f.bytes,
    });
  }
  const { body, contentType } = buildMultipartBody(parts);
  return new Request("http://localhost/api/students/1/documents", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: body as unknown as BodyInit,
  });
}

function mockDbServiceFetch(responses: Array<{ ok: boolean; status: number; body?: unknown; text?: string }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[calls.length - 1];
    if (!r) throw new Error(`Unexpected fetch call #${calls.length} to ${url}`);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
      text: async () => r.text ?? "",
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

// --- tests ----------------------------------------------------------------

describe("POST /api/students/[id]/documents", () => {
  it("rejects unauthenticated requests with 401", async () => {
    mockSession.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(({})),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects when the user lacks school access (403)", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    // student-school lookup → school exists
    mockQuery.mockResolvedValueOnce([{ code: "12345", region: null }]);
    // getUserPermission → empty (no permission row)
    mockQuery.mockResolvedValueOnce([]);

    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(({})),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an invalid student id with 400", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(({})),
      routeParams({ id: "abc" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid document_type with 400", async () => {
    authorizedAdmin();
    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(({ documentType: "not_a_type" })),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: /document_type/ });
  });

  it("rejects when no pages are provided", async () => {
    authorizedAdmin();
    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(({ documentType: "wise_research_consent" })),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: /at least one page/i });
  });

  it("rejects unsupported MIME types (e.g. image/gif)", async () => {
    authorizedAdmin();
    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "wise_research_consent",
          files: [{ field: "page_1", mimeType: "image/gif", bytes: new Uint8Array([1, 2, 3]) }],
        }),
      ),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: /unsupported MIME/i });
  });

  it("rejects oversized photos (>10MB)", async () => {
    authorizedAdmin();
    const oversized = new Uint8Array(11 * 1024 * 1024);
    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "wise_research_consent",
          files: [{ field: "page_1", mimeType: "image/jpeg", bytes: oversized }],
        }),
      ),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects oversized PDF (>5MB)", async () => {
    authorizedAdmin();
    const oversized = new Uint8Array(6 * 1024 * 1024);
    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "caste_certificate",
          files: [{ field: "page_1", mimeType: "application/pdf", bytes: oversized }],
        }),
      ),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects more than 10 photo pages", async () => {
    authorizedAdmin();
    const files = Array.from({ length: 11 }, (_, i) => ({
      field: `page_${i + 1}`,
      mimeType: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3]),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({ documentType: "wise_research_consent", files }),
      ),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects PDF mode with multiple files", async () => {
    authorizedAdmin();
    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "caste_certificate",
          files: [
            { field: "page_1", mimeType: "application/pdf", bytes: new Uint8Array([1, 2]) },
            { field: "page_2", mimeType: "application/pdf", bytes: new Uint8Array([3, 4]) },
          ],
        }),
      ),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(400);
  });

  it("happy path: photos mode uploads each page to S3 and creates a document row (201)", async () => {
    authorizedAdmin();
    s3Mock.on(PutObjectCommand).resolves({});
    const created = {
      id: 77,
      student_id: 1,
      document_type: "wise_research_consent",
      pages: [
        { s3_key: "test-prefix/students/1/wise_research_consent/x/page-1.jpg", page_number: 1, mime_type: "image/jpeg", byte_size: 4 },
        { s3_key: "test-prefix/students/1/wise_research_consent/x/page-2.png", page_number: 2, mime_type: "image/png", byte_size: 5 },
      ],
      metadata: {},
      uploaded_by: "admin@avantifellows.org",
      deleted_at: null,
      inserted_at: "t",
      updated_at: "t",
    };
    const { calls } = mockDbServiceFetch([
      { ok: true, status: 201, body: { data: created } },
    ]);

    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "wise_research_consent",
          files: [
            { field: "page_1", mimeType: "image/jpeg", bytes: new Uint8Array([1, 2, 3, 4]) },
            { field: "page_2", mimeType: "image/png", bytes: new Uint8Array([5, 6, 7, 8, 9]) },
          ],
        }),
      ),
      routeParams({ id: "1" }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);

    // S3 saw two PUTs
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
    // db-service POST received the page metadata
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://db.test/api/lms-student-document");
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body).toMatchObject({
      student_id: 1,
      document_type: "wise_research_consent",
      uploaded_by: "admin@avantifellows.org",
    });
    expect(body.pages).toHaveLength(2);
    expect(body.pages[0].page_number).toBe(1);
  });

  it("happy path: PDF mode uploads a single .pdf object", async () => {
    authorizedAdmin();
    s3Mock.on(PutObjectCommand).resolves({});
    mockDbServiceFetch([{ ok: true, status: 201, body: { id: 1 } }]);

    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "caste_certificate",
          files: [
            { field: "page_1", mimeType: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
          ],
        }),
      ),
      routeParams({ id: "1" }),
    );

    expect(res.status).toBe(201);
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Key).toMatch(/page-1\.pdf$/);
    expect(calls[0].args[0].input.ContentType).toBe("application/pdf");
  });

  it("S3 PUT failure cleans up earlier uploads and returns 502", async () => {
    authorizedAdmin();
    let putCalls = 0;
    s3Mock.on(PutObjectCommand).callsFake(() => {
      putCalls += 1;
      if (putCalls === 2) throw new Error("S3 down");
      return {};
    });
    s3Mock.on(DeleteObjectCommand).resolves({});
    // db-service should NOT be called
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "wise_research_consent",
          files: [
            { field: "page_1", mimeType: "image/jpeg", bytes: new Uint8Array([1]) },
            { field: "page_2", mimeType: "image/jpeg", bytes: new Uint8Array([2]) },
          ],
        }),
      ),
      routeParams({ id: "1" }),
    );

    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    // First page was uploaded successfully → must be deleted as cleanup
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  it("db-service failure cleans up all S3 objects and returns 502", async () => {
    authorizedAdmin();
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    mockDbServiceFetch([{ ok: false, status: 500, text: "db down" }]);

    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "wise_research_consent",
          files: [
            { field: "page_1", mimeType: "image/jpeg", bytes: new Uint8Array([1]) },
            { field: "page_2", mimeType: "image/jpeg", bytes: new Uint8Array([2]) },
          ],
        }),
      ),
      routeParams({ id: "1" }),
    );

    expect(res.status).toBe(502);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(2);
  });

  it("passcode user in matching school can upload (201)", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);
    // getStudentSchool → matches passcode school
    mockQuery.mockResolvedValueOnce([{ code: "70705", region: null }]);
    s3Mock.on(PutObjectCommand).resolves({});
    mockDbServiceFetch([{ ok: true, status: 201, body: { id: 1 } }]);

    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "income_certificate",
          files: [{ field: "page_1", mimeType: "image/jpeg", bytes: new Uint8Array([1, 2]) }],
        }),
      ),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(201);
  });

  it("passcode user in a different school is blocked (403)", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);
    mockQuery.mockResolvedValueOnce([{ code: "99999", region: null }]);

    const { POST } = await import("./route");
    const res = await POST(
      multipartRequest(
        buildFormData({
          documentType: "income_certificate",
          files: [{ field: "page_1", mimeType: "image/jpeg", bytes: new Uint8Array([1]) }],
        }),
      ),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/students/[id]/documents", () => {
  it("rejects unauthenticated requests with 401", async () => {
    mockSession.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/students/1/documents"),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns the documents array from db-service on success", async () => {
    authorizedAdmin();
    const rows = [
      { id: 1, student_id: 1, document_type: "wise_research_consent", pages: [], metadata: {}, uploaded_by: "x", deleted_at: null, inserted_at: "t", updated_at: "t" },
    ];
    const { calls } = mockDbServiceFetch([{ ok: true, status: 200, body: rows }]);

    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/students/1/documents"),
      routeParams({ id: "1" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
    expect(calls[0].url).toBe("https://db.test/api/lms-student-document?student_id=1");
  });

  it("returns 502 when db-service errors", async () => {
    authorizedAdmin();
    mockDbServiceFetch([{ ok: false, status: 500, text: "down" }]);

    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/students/1/documents"),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(502);
  });

  it("returns 403 for users without school access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValueOnce([{ code: "12345", region: null }]);
    mockQuery.mockResolvedValueOnce([]); // no permission row

    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/students/1/documents"),
      routeParams({ id: "1" }),
    );
    expect(res.status).toBe(403);
  });
});
