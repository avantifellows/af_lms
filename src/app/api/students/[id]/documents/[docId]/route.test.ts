import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ADMIN_SESSION,
  routeParams,
} from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);

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

// The DELETE route now does listDocuments(studentId) first to verify the doc
// belongs to that student, then softDeleteDocument(docId). Both go through
// fetch — sequence the responses.
function mockListThenDelete(opts: {
  listDocs?: Array<{ id: number; student_id: number; deleted_at?: string | null; pages?: unknown[] }>;
  deleteResponse?: { ok: boolean; status: number; text?: string };
}) {
  const docs = opts.listDocs ?? [];
  const del = opts.deleteResponse ?? { ok: true, status: 204 };
  let call = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    call += 1;
    if (call === 1) {
      // listDocuments GET
      return {
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => docs.map((d) => ({
          deleted_at: null,
          pages: [],
          metadata: {},
          uploaded_by: "x",
          inserted_at: "t",
          updated_at: "t",
          document_type: "wise_research_consent",
          ...d,
        })),
        text: async (): Promise<string> => "",
      };
    }
    // softDeleteDocument DELETE
    void init;
    return {
      ok: del.ok,
      status: del.status,
      json: async (): Promise<unknown> => null,
      text: async (): Promise<string> => del.text ?? "",
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function deleteRequest() {
  return new Request("http://localhost/api/students/1/documents/77", {
    method: "DELETE",
  });
}

describe("DELETE /api/students/[id]/documents/[docId]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    mockSession.mockResolvedValue(null);
    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));
    expect(res.status).toBe(401);
  });

  it("rejects when the user lacks school access (403)", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValueOnce([{ code: "12345", region: null }]);
    mockQuery.mockResolvedValueOnce([]); // no permission row
    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));
    expect(res.status).toBe(403);
  });

  it("rejects invalid student id with 400", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "abc", docId: "77" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid document id with 400", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "abc" }));
    expect(res.status).toBe(400);
  });

  it("happy path: returns 204 on successful soft-delete", async () => {
    authorizedAdmin();
    const fetchMock = mockListThenDelete({
      listDocs: [{ id: 77, student_id: 1 }],
    });

    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));

    expect(res.status).toBe(204);
    // First call = list, second call = delete
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const deleteCall = fetchMock.mock.calls[1];
    expect(deleteCall[0]).toBe("https://db.test/api/lms-student-document/77");
    expect((deleteCall[1] as RequestInit).method).toBe("DELETE");
  });

  it("rejects cross-student docId — returns 404 instead of deleting another student's doc (IDOR fix)", async () => {
    authorizedAdmin();
    // listDocuments(1) returns no rows for doc 77 (it belongs to student 999)
    const fetchMock = mockListThenDelete({
      listDocs: [{ id: 5, student_id: 1 }],
    });

    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));
    expect(res.status).toBe(404);
    // Only the list fetch ran; we never reached softDeleteDocument.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when doc is soft-deleted", async () => {
    authorizedAdmin();
    mockListThenDelete({
      listDocs: [{ id: 77, student_id: 1, deleted_at: "2026-05-29T00:00:00Z" }],
    });

    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when db-service rejects the delete itself", async () => {
    authorizedAdmin();
    mockListThenDelete({
      listDocs: [{ id: 77, student_id: 1 }],
      deleteResponse: { ok: false, status: 404, text: "not found" },
    });

    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));
    expect(res.status).toBe(404);
  });

  it("returns 502 when db-service returns 5xx on delete", async () => {
    authorizedAdmin();
    mockListThenDelete({
      listDocs: [{ id: 77, student_id: 1 }],
      deleteResponse: { ok: false, status: 500, text: "down" },
    });

    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));
    expect(res.status).toBe(502);
  });
});
