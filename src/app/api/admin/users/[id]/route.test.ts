import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery, mockWithTransaction } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return {
    mockQuery,
    // Run the callback with a client whose query routes to the same mock, so
    // top-level and in-transaction queries are captured in one call list.
    mockWithTransaction: vi.fn(
      async (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) =>
        fn({ query: mockQuery })
    ),
  };
});

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}));

import { getServerSession } from "next-auth";
import { isAdmin } from "@/lib/permissions";
import { DELETE, PATCH } from "./route";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
  ADMIN_SESSION,
} from "../../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockIsAdmin = vi.mocked(isAdmin);

beforeEach(() => {
  vi.resetAllMocks();
  mockWithTransaction.mockImplementation(
    async (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) =>
      fn({ query: mockQuery })
  );
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

  it("deletes another user and vacates their centre seats", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce([{ email: "other@test.com", user_id: 70 }]) // lookup
      .mockResolvedValueOnce([]) // vacate seats (soft-delete)
      .mockResolvedValueOnce([]); // delete permission

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // The seats are soft-deleted (removing them from the centre + roster).
    expect(
      mockQuery.mock.calls.some((c) =>
        String(c[0]).includes("centre_positions SET deleted_at")
      )
    ).toBe(true);
    // The teacher/staff/user identity rows are NOT destroyed.
    expect(
      mockQuery.mock.calls.some((c) => /DELETE FROM (teacher|staff|"user")/.test(String(c[0])))
    ).toBe(false);
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
      body: { level: 2, role: "program_admin", program_ids: [1, 2] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("rejects (409) editing school_codes for a user with a centre seat", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce([{ one: 1 }]); // seated check → seated
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { school_codes: ["54019"] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("centre");
    // guard returns before the UPDATE — only the seated check ran
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("forces school_codes/regions to NULL when a seated user's other fields are edited", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce([{ one: 1 }]) // seated check → seated
      .mockResolvedValueOnce([]); // UPDATE
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 2 }, // no scope edit, so allowed
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const updateArgs = mockQuery.mock.calls[1][1] as unknown[];
    expect(updateArgs[2]).toBeNull(); // school_codes
    expect(updateArgs[3]).toBeNull(); // regions
  });

  it("still allows editing school_codes for a user with NO centre seat", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce([]) // seated check → not seated
      .mockResolvedValueOnce([]); // UPDATE
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { school_codes: ["54019"] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const updateArgs = mockQuery.mock.calls[1][1] as unknown[];
    expect(updateArgs[2]).toEqual(["54019"]); // school_codes applied
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
