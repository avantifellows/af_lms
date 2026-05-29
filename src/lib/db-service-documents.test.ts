import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import {
  listDocuments,
  createDocument,
  softDeleteDocument,
  DbServiceError,
} from "./db-service-documents";

beforeAll(() => {
  process.env.DB_SERVICE_URL = "https://db.test/api";
  process.env.DB_SERVICE_TOKEN = "test-token";
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchResponse(opts: {
  ok?: boolean;
  status?: number;
  jsonBody?: unknown;
  textBody?: string;
}) {
  const { ok = true, status = ok ? 200 : 500, jsonBody, textBody = "" } = opts;
  return vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    return {
      ok,
      status,
      json: async () => jsonBody,
      text: async () => textBody,
    };
  });
}

describe("listDocuments", () => {
  it("returns a bare array when db-service returns an array", async () => {
    const fetchMock = mockFetchResponse({
      jsonBody: [
        { id: 1, student_id: 42, document_type: "wise_research_consent", pages: [], metadata: {}, uploaded_by: "x", deleted_at: null, inserted_at: "t", updated_at: "t" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await listDocuments(42);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("https://db.test/api/lms-student-document?student_id=42");
    expect(call[1]).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({
        Authorization: "Bearer test-token",
      }),
    });
  });

  it("unwraps a { data: [...] } envelope", async () => {
    const fetchMock = mockFetchResponse({
      jsonBody: { data: [{ id: 7 }] },
    });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await listDocuments(99);
    expect(rows).toEqual([{ id: 7 }]);
  });

  it("throws DbServiceError on non-2xx", async () => {
    const fetchMock = mockFetchResponse({
      ok: false,
      status: 502,
      textBody: "Bad Gateway",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listDocuments(1)).rejects.toBeInstanceOf(DbServiceError);
  });
});

describe("createDocument", () => {
  it("POSTs the input and returns the created row", async () => {
    const created = {
      id: 11,
      student_id: 5,
      document_type: "wise_research_consent",
      pages: [{ s3_key: "k", page_number: 1, mime_type: "image/jpeg", byte_size: 10 }],
      metadata: {},
      uploaded_by: "teacher@example.com",
      deleted_at: null,
      inserted_at: "t",
      updated_at: "t",
    };
    const fetchMock = mockFetchResponse({
      status: 201,
      jsonBody: { data: created },
    });
    vi.stubGlobal("fetch", fetchMock);

    const row = await createDocument({
      student_id: 5,
      document_type: "wise_research_consent",
      pages: created.pages,
      metadata: {},
      uploaded_by: "teacher@example.com",
    });

    expect(row).toEqual(created);
    const call = fetchMock.mock.calls[0];
    const url = call[0];
    const init = call[1] as RequestInit;
    expect(url).toBe("https://db.test/api/lms-student-document");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      student_id: 5,
      document_type: "wise_research_consent",
      uploaded_by: "teacher@example.com",
    });
  });

  it("falls back to bare object response", async () => {
    const fetchMock = mockFetchResponse({
      status: 201,
      jsonBody: { id: 9 },
    });
    vi.stubGlobal("fetch", fetchMock);

    const row = await createDocument({
      student_id: 1,
      document_type: "other",
      pages: [],
      metadata: {},
      uploaded_by: "x",
    });
    expect(row).toEqual({ id: 9 });
  });

  it("throws DbServiceError on failure", async () => {
    const fetchMock = mockFetchResponse({
      ok: false,
      status: 422,
      textBody: "validation",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createDocument({
        student_id: 1,
        document_type: "other",
        pages: [],
        metadata: {},
        uploaded_by: "x",
      }),
    ).rejects.toMatchObject({
      name: "DbServiceError",
      status: 422,
      body: "validation",
    });
  });
});

describe("softDeleteDocument", () => {
  it("DELETEs at the right URL and returns void", async () => {
    const fetchMock = mockFetchResponse({ status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(softDeleteDocument(123)).resolves.toBeUndefined();
    const call = fetchMock.mock.calls[0];
    const url = call[0];
    const init = call[1] as RequestInit;
    expect(url).toBe("https://db.test/api/lms-student-document/123");
    expect(init.method).toBe("DELETE");
  });

  it("throws DbServiceError on non-2xx", async () => {
    const fetchMock = mockFetchResponse({
      ok: false,
      status: 404,
      textBody: "not found",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(softDeleteDocument(1)).rejects.toMatchObject({
      name: "DbServiceError",
      status: 404,
    });
  });
});
