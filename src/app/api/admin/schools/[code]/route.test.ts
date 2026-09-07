import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: vi.fn(),
  PROGRAM_IDS_ORDERED: [1, 2, 64, 74, 94, 78],
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { getUserPermission, type UserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import { PATCH } from "./route";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
  ADMIN_SESSION,
} from "../../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockGetUserPermission = vi.mocked(getUserPermission);
const ADMIN_PERMISSION = { email: "admin@avantifellows.org", level: 3, role: "admin" } as UserPermission;
const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PATCH /api/admin/schools/[code]", () => {
  const params = routeParams({ code: "70705" });

  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/admin/schools/70705", {
      method: "PATCH",
      body: { program_ids: [1] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(null);
    const req = jsonRequest("http://localhost/api/admin/schools/70705", {
      method: "PATCH",
      body: { program_ids: [1] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 400 when program_ids is not an array", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/schools/70705", {
      method: "PATCH",
      body: { program_ids: "not-array" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("must be an array");
  });

  it("returns 400 for invalid program IDs", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/schools/70705", {
      method: "PATCH",
      body: { program_ids: [1, 999] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("999");
  });

  it("updates school program_ids successfully", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery.mockResolvedValue([]);
    const req = jsonRequest("http://localhost/api/admin/schools/70705", {
      method: "PATCH",
      body: { program_ids: [1, 2] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE school"),
      [[1, 2], "70705"],
    );
  });

  it("returns 500 on query error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery.mockRejectedValue(new Error("DB error"));
    const req = jsonRequest("http://localhost/api/admin/schools/70705", {
      method: "PATCH",
      body: { program_ids: [1] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(500);
  });
});
