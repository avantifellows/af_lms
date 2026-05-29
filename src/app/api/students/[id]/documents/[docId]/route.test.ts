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

function mockDbServiceFetch(response: { ok: boolean; status: number; text?: string }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    return {
      ok: response.ok,
      status: response.status,
      json: async () => null,
      text: async () => response.text ?? "",
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
    const fetchMock = mockDbServiceFetch({ ok: true, status: 204 });

    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));

    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("https://db.test/api/lms-student-document/77");
    expect((call[1] as RequestInit).method).toBe("DELETE");
  });

  it("returns 404 when db-service returns 404", async () => {
    authorizedAdmin();
    mockDbServiceFetch({ ok: false, status: 404, text: "not found" });

    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));
    expect(res.status).toBe(404);
  });

  it("returns 502 when db-service returns 5xx", async () => {
    authorizedAdmin();
    mockDbServiceFetch({ ok: false, status: 500, text: "down" });

    const { DELETE } = await import("./route");
    const res = await DELETE(deleteRequest(), routeParams({ id: "1", docId: "77" }));
    expect(res.status).toBe(502);
  });
});
