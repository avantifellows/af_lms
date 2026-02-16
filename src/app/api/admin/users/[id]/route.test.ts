import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { DELETE, PATCH } from "./route";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
  ADMIN_SESSION,
} from "../../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockIsAdmin = vi.mocked(isAdmin);
const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("DELETE /api/admin/users/[id]", () => {
  const params = routeParams({ id: "5" });

  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(false);
    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);
    expect(res.status).toBe(403);
  });

  it("prevents deleting yourself", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValue([{ email: "admin@avantifellows.org" }]);

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Cannot delete your own");
  });

  it("deletes another user successfully", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce([{ email: "other@test.com" }]) // lookup
      .mockResolvedValueOnce([]); // delete

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("succeeds when user to delete does not exist", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce([]) // lookup returns empty
      .mockResolvedValueOnce([]); // delete (no-op)

    const req = jsonRequest("http://localhost/api/admin/users/999", { method: "DELETE" });
    const res = await DELETE(req as never, routeParams({ id: "999" }));
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/admin/users/[id]", () => {
  const params = routeParams({ id: "5" });

  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 2 },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(false);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 2 },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid level", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 5 },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty program_ids array", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { program_ids: [] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("program");
  });

  it("updates user successfully", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValue([]);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 3, role: "admin", program_ids: [1, 2] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("ignores invalid role values", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValue([]);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { role: "invalid_role" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    // role should be undefined (COALESCE keeps existing)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([undefined]),
    );
  });

  it("returns 500 on query error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockRejectedValue(new Error("DB error"));
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 2 },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(500);
  });
});
