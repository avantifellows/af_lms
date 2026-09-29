import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getUserPermission: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { getUserPermission, type UserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import { GET, POST } from "./route";
import {
  jsonRequest,
  NO_SESSION,
  ADMIN_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockGetUserPermission = vi.mocked(getUserPermission);
const ADMIN_PERMISSION = { email: "admin@avantifellows.org", level: 3, role: "admin" } as UserPermission;
const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/admin/users", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns users list", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const users = [{ id: 1, email: "u@test.com", level: 3, role: "admin" }];
    mockQuery.mockResolvedValue(users);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(users);
  });
});

describe("POST /api/admin/users", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1, program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(null);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1, program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
  });

  it("returns 403 for a read-only admin (writes blocked, reads allowed)", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue({
      ...ADMIN_PERMISSION,
      read_only: true,
    } as UserPermission);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1, program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);

    mockQuery.mockResolvedValue([]);
    const getRes = await GET();
    expect(getRes.status).toBe(200);
  });

  it("returns 400 when email is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { level: 1, program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Email and level");
  });

  it("returns 400 when level is out of range", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 5, program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Level must be between");
  });

  it("returns 400 when program_ids is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1 },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("program");
  });

  it("creates user with valid role", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery.mockResolvedValue([{ id: 10 }]);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: {
        email: "u@test.com",
        level: 2,
        role: "program_admin",
        program_ids: [1, 2],
        school_codes: ["70705"],
      },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ id: 10, success: true });
  });

  it("creates a Program 1-wide Holistic Mentorship Admin without a Centre seat", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery.mockResolvedValue([{ id: 12 }]);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: {
        email: "holistic@example.com",
        level: 1,
        role: "holistic_mentorship_admin",
        program_ids: [64],
        school_codes: ["SCH001"],
      },
    });

    expect((await POST(req as never)).status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
      "holistic@example.com",
      3,
      "holistic_mentorship_admin",
      null,
      null,
      [1, 74, 94, 78, 88, 99],
      false,
      null,
    ]);
  });

  it("rejects an unknown role", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1, role: "unknown", program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid role" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 500 on query error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery.mockRejectedValue(new Error("DB error"));
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1, role: "teacher", program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(500);
  });
});

describe("POST /api/admin/users — PMU roles", () => {
  const JNV_SCHOOLS = [
    { code: "JNV001", region: "North" },
    { code: "JNV002", region: "North" },
  ];

  // Routes each SQL statement to a fake: JNV School lookups answer from
  // JNV_SCHOOLS, the seat check from `seats`, and the upsert returns an id.
  function mockDb({ seats = [] as unknown[] } = {}) {
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("centre_positions")) return seats;
      if (sql.includes("af_school_category = 'JNV'")) {
        const wanted = (params?.[0] ?? []) as string[];
        return sql.includes("region")
          ? JNV_SCHOOLS.filter((s) => wanted.includes(s.region)).map((s) => ({ region: s.region }))
          : JNV_SCHOOLS.filter((s) => wanted.includes(s.code)).map((s) => ({ code: s.code }));
      }
      if (sql.includes("INSERT INTO user_permission")) return [{ id: 21 }];
      return [];
    });
  }

  function insertParams() {
    const call = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO user_permission")
    );
    return call?.[1];
  }

  async function post(body: Record<string, unknown>) {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "pmu@example.com", ...body },
    });
    return POST(req as never);
  }

  it.each([
    ["a Govt School User at level 2", { role: "pmu_govt_school_user", level: 2, regions: ["North"] }],
    ["a Govt School User at level 3", { role: "pmu_govt_school_user", level: 3 }],
    ["a Govt School User with no codes", { role: "pmu_govt_school_user", level: 1, school_codes: [] }],
    ["a Govt School User with two codes", { role: "pmu_govt_school_user", level: 1, school_codes: ["JNV001", "JNV002"] }],
    ["a Govt School User with a non-JNV code", { role: "pmu_govt_school_user", level: 1, school_codes: ["OTHER1"] }],
    ["a Manager at level 1 with a non-JNV code", { role: "pmu_manager", level: 1, school_codes: ["JNV001", "OTHER1"] }],
    ["a Manager at level 1 with no codes", { role: "pmu_manager", level: 1, school_codes: [] }],
    ["a Manager at level 2 with no region", { role: "pmu_manager", level: 2, regions: [] }],
    ["a Manager at level 2 with a region without a JNV School", { role: "pmu_manager", level: 2, regions: ["North", "Nowhere"] }],
  ])("returns 400 for %s", async (_label, body) => {
    mockDb();
    const res = await post({ program_ids: [64], ...body });
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(insertParams()).toBeUndefined();
  });

  it("stores a Govt School User pinned to [64] with its one School, ignoring body program_ids", async () => {
    mockDb();
    const res = await post({
      role: "pmu_govt_school_user",
      level: 1,
      school_codes: ["JNV001"],
      program_ids: [1, 2],
      read_only: true,
      full_name: "Principal",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 21, success: true });
    expect(insertParams()).toEqual([
      "pmu@example.com",
      1,
      "pmu_govt_school_user",
      ["JNV001"],
      null,
      [64],
      true,
      "Principal",
    ]);
  });

  it("stores a Manager without program_ids in the body", async () => {
    mockDb();
    const res = await post({ role: "pmu_manager", level: 2, regions: ["North"], school_codes: ["JNV001"] });
    expect(res.status).toBe(200);
    expect(insertParams()).toEqual([
      "pmu@example.com", 2, "pmu_manager", null, ["North"], [64], false, null,
    ]);
  });

  it("stores null codes and regions for a level-3 Manager", async () => {
    mockDb();
    const res = await post({
      role: "pmu_manager",
      level: 3,
      school_codes: ["JNV001"],
      regions: ["North"],
      program_ids: [1],
    });
    expect(res.status).toBe(200);
    expect(insertParams()).toEqual([
      "pmu@example.com", 3, "pmu_manager", null, null, [64], false, null,
    ]);
  });

  it("returns 409 when the target already holds a centre seat", async () => {
    mockDb({ seats: [{ one: 1 }] });
    const res = await post({ role: "pmu_manager", level: 3 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/centre assignments/i);
    expect(insertParams()).toBeUndefined();
  });
});
