import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery, mockWithTransaction } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return {
    mockQuery,
    // Run the callback with a client whose query routes to the same mock, so
    // top-level and in-transaction queries are captured in one call list.
    mockWithTransaction: vi.fn(
      async (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) =>
        fn({
          query: async (...args: unknown[]) => {
            const result = await mockQuery(...args);
            return result && !Array.isArray(result) ? result : { rows: result ?? [] };
          },
        })
    ),
  };
});

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getUserPermission: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}));

import { getServerSession } from "next-auth";
import { getUserPermission, type UserPermission } from "@/lib/permissions";
import { DELETE, PATCH } from "./route";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
  ADMIN_SESSION,
} from "../../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockGetUserPermission = vi.mocked(getUserPermission);
const ADMIN_PERMISSION = { email: "admin@avantifellows.org", level: 3, role: "admin" } as UserPermission;

beforeEach(() => {
  vi.resetAllMocks();
  mockWithTransaction.mockImplementation(
    async (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) =>
      fn({
        query: async (...args: unknown[]) => {
          const result = await mockQuery(...args);
          return result && !Array.isArray(result) ? result : { rows: result ?? [] };
        },
      })
  );
});

describe("DELETE /api/admin/users/[id]", () => {
  const params = routeParams({ id: "5" });

  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(null);
    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("prevents deleting yourself", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery.mockResolvedValue([{ email: "admin@avantifellows.org" }]);

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Cannot delete your own");
  });

  it("blocks deleting a user with Academic Mentor-Mentee Mapping history", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery
      .mockResolvedValueOnce([{ email: "mentor@test.com", user_id: 70 }])
      .mockResolvedValueOnce([
        {
          school_code: "54019",
          academic_year: "2026-2027",
        },
      ]);

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("Academic Mentor-Mentee Mapping history");
    expect(json.error).toContain(
      "/admin/academic-mentorship?school_code=54019&academic_year=2026-2027"
    );
    expect(String(mockQuery.mock.calls[1][0])).toContain("m.mentor_user_id = $1");
    expect(mockQuery.mock.calls[1][1]).toEqual([70]);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("revokes LMS access and ends Holistic Mappings without blocking on history", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery
      .mockResolvedValueOnce([{ email: "mentor@test.com", user_id: 70 }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(200);
    const cleanup = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("holistic_mentorship_mentor_mentee_mappings")
    );
    expect(cleanup?.[1]).toEqual([
      70,
      "af_lms_staff_management",
      "mentor_access_revoked",
      true,
      expect.any(Array),
    ]);
    expect(mockWithTransaction).toHaveBeenCalledOnce();
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM user_permission"))
    ).toBe(true);
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes("has_mapping_history"))
    ).toBe(false);
  });

  it("resolves legacy null permission user_id by email before mapping-history checks", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery
      .mockResolvedValueOnce([{ email: "mentor@test.com", user_id: 70 }])
      .mockResolvedValueOnce([{ school_code: "54019", academic_year: "2026-2027" }]);

    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "DELETE" });
    const res = await DELETE(req as never, params);

    expect(res.status).toBe(409);
    expect(String(mockQuery.mock.calls[0][0])).toContain(
      "COALESCE(up.user_id, u.id) AS user_id"
    );
    expect(String(mockQuery.mock.calls[0][0])).toContain("LOWER(u.email) = LOWER(up.email)");
    expect(mockQuery.mock.calls[1][1]).toEqual([70]);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("deletes another user and vacates their centre seats", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery
      .mockResolvedValueOnce([{ email: "other@test.com", user_id: 70 }]) // lookup
      .mockResolvedValueOnce([]) // mapping history blocker
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
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
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
    mockGetUserPermission.mockResolvedValue(null);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 2 },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid level", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 5 },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty program_ids array", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
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
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
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

  it("ends Holistic Mappings in the same transaction when a Teacher role changes", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery.mockResolvedValueOnce([{ one: 1, user_id: 70 }]);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { role: "program_manager", program_ids: [1] },
    });

    expect((await PATCH(req as never, params)).status).toBe(200);
    expect(mockWithTransaction).toHaveBeenCalledOnce();
    const cleanup = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("holistic_mentorship_mentor_mentee_mappings")
    );
    expect(cleanup?.[1]).toEqual([
      70,
      "af_lms_staff_management",
      "mentor_role_changed",
      true,
      expect.any(Array),
    ]);
  });

  it("changes an unseated user to Program 1-wide Holistic Mentorship Admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: {
        level: 1,
        role: "holistic_mentorship_admin",
        program_ids: [64],
        school_codes: ["SCH001"],
      },
    });

    expect((await PATCH(req as never, params)).status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toEqual([
      3,
      "holistic_mentorship_admin",
      null,
      null,
      [1, 74, 94, 78, 88, 99],
      undefined,
      null,
      "5",
    ]);
  });

  it("rejects (409) editing school_codes for a user with a centre seat", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
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
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery
      .mockResolvedValueOnce([{ one: 1 }]) // seated check → seated
      .mockResolvedValueOnce([{ level: 1, role: "program_manager", school_codes: null, regions: null }]) // stored row
      .mockResolvedValueOnce([]); // UPDATE
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 2 }, // no scope edit, so allowed
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const updateArgs = mockQuery.mock.calls[2][1] as unknown[];
    expect(updateArgs[2]).toBeNull(); // school_codes
    expect(updateArgs[3]).toBeNull(); // regions
  });

  it("still allows editing school_codes for a user with NO centre seat", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery
      .mockResolvedValueOnce([]) // seated check → not seated
      .mockResolvedValueOnce([{ level: 1, role: "teacher", school_codes: null, regions: null }]) // stored row
      .mockResolvedValueOnce([]); // UPDATE
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { school_codes: ["54019"] },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const updateArgs = mockQuery.mock.calls[2][1] as unknown[];
    expect(updateArgs[2]).toEqual(["54019"]); // school_codes applied
  });

  it("rejects invalid role values", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { role: "invalid_role" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid role" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 500 on query error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    mockQuery.mockRejectedValue(new Error("DB error"));
    const req = jsonRequest("http://localhost/api/admin/users/5", {
      method: "PATCH",
      body: { level: 2 },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/admin/users/[id] — PMU roles", () => {
  const params = routeParams({ id: "5" });
  const JNV_SCHOOLS = [
    { code: "JNV001", region: "North" },
    { code: "JNV002", region: "North" },
  ];
  const MULTI_SCHOOL_PM = {
    level: 1,
    role: "program_manager",
    school_codes: ["JNV001", "JNV002"],
    regions: null,
    program_ids: [1, 64],
  };

  // Routes each SQL statement to a fake: the seat check answers from `seats`,
  // the stored-row read from `stored`, and JNV lookups from JNV_SCHOOLS.
  function mockDb({ seats = [] as unknown[], stored = MULTI_SCHOOL_PM as unknown } = {}) {
    mockQuery.mockImplementation(async (sql: string, args?: unknown[]) => {
      if (sql.includes("centre_positions")) return seats;
      if (sql.includes("af_school_category = 'JNV'")) {
        const wanted = (args?.[0] ?? []) as string[];
        return sql.includes("region")
          ? JNV_SCHOOLS.filter((s) => wanted.includes(s.region)).map((s) => ({ region: s.region }))
          : JNV_SCHOOLS.filter((s) => wanted.includes(s.code)).map((s) => ({ code: s.code }));
      }
      if (/SELECT[\s\S]*FROM user_permission[\s\S]*WHERE id = \$1/.test(sql)) {
        return stored ? [stored] : [];
      }
      return [];
    });
  }

  function updateParams() {
    const call = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE user_permission")
    );
    return call?.[1];
  }

  async function patch(body: Record<string, unknown>) {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(ADMIN_PERMISSION);
    const req = jsonRequest("http://localhost/api/admin/users/5", { method: "PATCH", body });
    return PATCH(req as never, params);
  }

  it.each([
    ["a Govt School User at level 2", { role: "pmu_govt_school_user", level: 2, regions: ["North"] }],
    ["a Govt School User at level 3", { role: "pmu_govt_school_user", level: 3 }],
    ["a Govt School User with no codes", { role: "pmu_govt_school_user", level: 1, school_codes: [] }],
    ["a Govt School User with two codes", { role: "pmu_govt_school_user", level: 1, school_codes: ["JNV001", "JNV002"] }],
    ["a Govt School User with a non-JNV code", { role: "pmu_govt_school_user", level: 1, school_codes: ["OTHER1"] }],
    ["a Manager at level 1 with a non-JNV code", { role: "pmu_manager", level: 1, school_codes: ["OTHER1"] }],
    ["a Manager at level 1 with no codes", { role: "pmu_manager", level: 1, school_codes: [] }],
    ["a Manager at level 2 with no region", { role: "pmu_manager", level: 2, regions: [] }],
    ["a Manager at level 2 with a region without a JNV School", { role: "pmu_manager", level: 2, regions: ["Nowhere"] }],
    ["a role-only change to Govt School User on a multi-school row", { role: "pmu_govt_school_user" }],
  ])("returns 400 for %s", async (_label, body) => {
    mockDb();
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(updateParams()).toBeUndefined();
  });

  it("returns 400 when a stored Govt School User row is edited to level 3", async () => {
    mockDb({
      stored: { level: 1, role: "pmu_govt_school_user", school_codes: ["JNV001"], regions: null, program_ids: [64] },
    });
    const res = await patch({ level: 3 });
    expect(res.status).toBe(400);
    expect(updateParams()).toBeUndefined();
  });

  it("stores [64] and the single School for a role-only change on a one-school row", async () => {
    mockDb({ stored: { ...MULTI_SCHOOL_PM, school_codes: ["JNV002"] } });
    const res = await patch({ role: "pmu_govt_school_user", program_ids: [1] });
    expect(res.status).toBe(200);
    expect(updateParams()).toEqual([
      1, "pmu_govt_school_user", ["JNV002"], null, [64], undefined, null, "5",
    ]);
  });

  it("ignores body program_ids and stores null scope for a level-3 Manager", async () => {
    mockDb();
    const res = await patch({
      role: "pmu_manager",
      level: 3,
      school_codes: ["JNV001"],
      regions: ["North"],
      program_ids: [1, 2],
      read_only: true,
      full_name: "PMU Lead",
    });
    expect(res.status).toBe(200);
    expect(updateParams()).toEqual([3, "pmu_manager", null, null, [64], true, "PMU Lead", "5"]);
  });

  it("stores regions for a level-2 Manager", async () => {
    mockDb();
    const res = await patch({ role: "pmu_manager", level: 2, regions: ["North"], school_codes: [] });
    expect(res.status).toBe(200);
    expect(updateParams()).toEqual([2, "pmu_manager", null, ["North"], [64], undefined, null, "5"]);
  });

  it("returns 409 when the target holds a centre seat", async () => {
    mockDb({ seats: [{ one: 1, user_id: 70 }] });
    const res = await patch({ role: "pmu_manager", level: 3 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/centre assignments/i);
    expect(updateParams()).toBeUndefined();
  });
});
