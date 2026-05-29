import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ADMIN_SESSION,
  routeParams,
} from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/s3", () => ({
  presignDocumentPage: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { presignDocumentPage } from "@/lib/s3";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockPresign = vi.mocked(presignDocumentPage);

process.env.DB_SERVICE_URL = "https://db.test/api";
process.env.DB_SERVICE_TOKEN = "test-token";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function authorizedAdmin() {
  mockSession.mockResolvedValue(ADMIN_SESSION);
  // canAccessStudent: getStudentSchool → admin permission
  mockQuery.mockResolvedValueOnce([{ code: "12345", region: "West" }]);
  mockQuery.mockResolvedValueOnce([
    { email: "admin@avantifellows.org", level: 3, role: "admin", school_codes: null, regions: null, program_ids: null, read_only: false },
  ]);
}

function stubListDocs(docs: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      void init;
      return {
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => docs,
        text: async (): Promise<string> => "",
      };
    }),
  );
}

const sampleDoc = {
  id: 99,
  student_id: 1,
  document_type: "wise_research_consent",
  pages: [
    { s3_key: "lms-documents/students/1/wise_research_consent/u/page-1.jpg", page_number: 1, mime_type: "image/jpeg", byte_size: 100 },
    { s3_key: "lms-documents/students/1/wise_research_consent/u/page-2.jpg", page_number: 2, mime_type: "image/jpeg", byte_size: 100 },
  ],
  metadata: {},
  uploaded_by: "x",
  deleted_at: null,
  inserted_at: "t",
  updated_at: "t",
};

function viewerRequest() {
  return new Request("http://localhost/api/students/1/documents/99/page/1");
}

describe("GET /api/students/[id]/documents/[docId]/page/[n]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    mockSession.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "1", docId: "99", n: "1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for non-numeric ids", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "abc", docId: "99", n: "1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-positive page number", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "1", docId: "99", n: "0" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 for users without school access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValueOnce([{ code: "12345", region: null }]);
    mockQuery.mockResolvedValueOnce([]); // no permission row
    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "1", docId: "99", n: "1" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when the doc id is unknown", async () => {
    authorizedAdmin();
    stubListDocs([sampleDoc]);
    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "1", docId: "12345", n: "1" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the page is out of range", async () => {
    authorizedAdmin();
    stubListDocs([sampleDoc]);
    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "1", docId: "99", n: "5" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the doc is soft-deleted", async () => {
    authorizedAdmin();
    stubListDocs([{ ...sampleDoc, deleted_at: "2026-05-30T00:00:00Z" }]);
    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "1", docId: "99", n: "1" }));
    expect(res.status).toBe(404);
  });

  it("happy path: returns 302 redirect to the presigned URL", async () => {
    authorizedAdmin();
    stubListDocs([sampleDoc]);
    mockPresign.mockResolvedValue("https://s3.example/signed-url");

    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "1", docId: "99", n: "2" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://s3.example/signed-url");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockPresign).toHaveBeenCalledWith({
      s3Key: "lms-documents/students/1/wise_research_consent/u/page-2.jpg",
      ttlSeconds: 600,
      responseContentType: "image/jpeg",
    });
  });

  it("returns 502 when the presigner fails", async () => {
    authorizedAdmin();
    stubListDocs([sampleDoc]);
    mockPresign.mockRejectedValue(new Error("kaboom"));

    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "1", docId: "99", n: "1" }));
    expect(res.status).toBe(502);
  });

  it("returns 502 when db-service is down", async () => {
    authorizedAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => null,
        text: async () => "down",
      })),
    );
    const { GET } = await import("./route");
    const res = await GET(viewerRequest(), routeParams({ id: "1", docId: "99", n: "1" }));
    expect(res.status).toBe(502);
  });
});
