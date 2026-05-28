import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/academic-year", () => ({
  getAcademicYearChoices: () => ["2026-2027", "2025-2026", "2024-2025"],
}));

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
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  process.env.DB_SERVICE_URL = "http://db-service.local";
  process.env.DB_SERVICE_TOKEN = "test-token";
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
    mockQuery.mockResolvedValue([{ email: "admin@avantifellows.org", role: "admin" }]);

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
      .mockResolvedValueOnce([{ email: "other@test.com", role: "admin" }]) // lookup
      .mockResolvedValueOnce([]); // delete

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("blocks deleting a teacher with active academic mentorship mappings", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce([{ email: "teacher@test.com", role: "teacher" }]);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ mappings: [{ id: 10 }, { id: 11 }] }))
      .mockResolvedValueOnce(Response.json({ mappings: [] }))
      .mockResolvedValueOnce(Response.json({ mappings: [{ id: 12 }] }));
    vi.stubGlobal("fetch", mockFetch);

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Cannot delete teacher — 3 active mentee assignment(s) exist. Unassign all mentees first.",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("deletes a teacher with no active academic mentorship mappings", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce([{ email: "teacher@test.com", role: "teacher" }])
      .mockResolvedValueOnce([]);
    const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ mappings: [] })));
    vi.stubGlobal("fetch", mockFetch);

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockQuery).toHaveBeenLastCalledWith(
      `DELETE FROM user_permission WHERE id = $1`,
      ["5"]
    );
  });

  it("skips the academic mentorship check for non-teacher users", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce([{ email: "pm@test.com", role: "program_manager" }])
      .mockResolvedValueOnce([]);
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns a historical mentorship error when the delete hits a foreign key violation", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const fkError = new Error("foreign key violation") as Error & { code: string };
    fkError.code = "23503";
    mockQuery
      .mockResolvedValueOnce([{ email: "teacher@test.com", role: "teacher" }])
      .mockRejectedValueOnce(fkError);
    const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ mappings: [] })));
    vi.stubGlobal("fetch", mockFetch);

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error:
        "Cannot delete teacher — historical mentorship records exist. Contact an administrator to purge historical records before deletion.",
    });
  });

  it("blocks deletion when db-service cannot verify active mappings", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce([{ email: "teacher@test.com", role: "teacher" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Cannot verify mentorship status — please try again later.",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("blocks deletion when db-service verification times out", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce([{ email: "teacher@test.com", role: "teacher" }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Cannot verify mentorship status — please try again later.",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
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

  it("blocks role or school access changes for teachers with active academic mentorship mappings", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce([
      {
        email: "teacher@test.com",
        role: "teacher",
        level: 1,
        school_codes: ["SCH001"],
        regions: null,
      },
    ]);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ mappings: [{ id: 10 }, { id: 11 }] }))
      .mockResolvedValueOnce(Response.json({ mappings: [] }))
      .mockResolvedValueOnce(Response.json({ mappings: [] }));
    vi.stubGlobal("fetch", mockFetch);

    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: {
        level: 1,
        role: "teacher",
        school_codes: ["SCH002"],
        regions: null,
        program_ids: [1],
      },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error:
        "Cannot update teacher — 2 active mentee assignment(s) exist. Unassign or reassign all mentees before changing role or school access.",
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("allows non-scope edits for teachers with active academic mentorship mappings", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce([
        {
          email: "teacher@test.com",
          role: "teacher",
          level: 1,
          school_codes: ["SCH001"],
          regions: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { full_name: "Updated Teacher" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE user_permission"),
      [
        undefined,
        undefined,
        ["SCH001"],
        null,
        null,
        undefined,
        "Updated Teacher",
        "5",
      ]
    );
  });

  it("updates user successfully", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValue([]);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 2, role: "program_admin", program_ids: [1, 2] },
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
