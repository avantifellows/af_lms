import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import { ALUMNI_MANAGER_ROLE, isAlumniRole } from "./constants";
import {
  canAccessAlumni,
  canAccessSchool,
  canAccessStudent,
  getAlumniPermission,
  getAlumniSchool,
  getFeatureAccess,
  getResolvedPermission,
  getUserPermission,
  isAdmin,
  isUserRole,
  type Feature,
  type UserPermission,
} from "./permissions";

const mockQuery = vi.mocked(query);

// A user_permission row as getUserPermission's SELECT returns it.
function row(overrides: Record<string, unknown> = {}) {
  return {
    email: "caller@avantifellows.org",
    level: 1,
    role: ALUMNI_MANAGER_ROLE,
    school_codes: ["70705"],
    regions: null,
    program_ids: [1],
    read_only: false,
    user_id: 55,
    ...overrides,
  };
}

function permission(overrides: Partial<UserPermission> = {}): UserPermission {
  return { ...(row() as unknown as UserPermission), ...overrides };
}

const session = { user: { email: "caller@avantifellows.org" } };

beforeEach(() => {
  mockQuery.mockReset();
});

describe("alumni_manager role (ADR 0008)", () => {
  it("is a known role, recognised by isAlumniRole", () => {
    expect(isUserRole(ALUMNI_MANAGER_ROLE)).toBe(true);
    expect(isAlumniRole(ALUMNI_MANAGER_ROLE)).toBe(true);
    expect(isAlumniRole("admin")).toBe(false);
  });

  describe("feature matrix", () => {
    const OTHER_FEATURES: Feature[] = [
      "students", "visits", "curriculum", "academic_mentorship", "holistic_mentorship",
      "performance", "summary_stats", "pm_dashboard", "quiz_sessions", "teacher_feedback",
    ];

    it.each(OTHER_FEATURES)("has no access to %s", (feature) => {
      expect(getFeatureAccess(permission({ level: 3 }), feature).access).toBe("none");
    });

    it("edits alumni; read_only only views", () => {
      expect(getFeatureAccess(permission(), "alumni").access).toBe("edit");
      expect(getFeatureAccess(permission({ read_only: true }), "alumni").access).toBe("view");
    });

    it("gives admins alumni edit and every other role none", () => {
      expect(getFeatureAccess(permission({ role: "admin" }), "alumni").access).toBe("edit");
      for (const role of ["teacher", "program_manager", "program_admin", "holistic_mentorship_admin", "pmu_manager", "pmu_govt_school_user"] as const) {
        expect(getFeatureAccess(permission({ role }), "alumni").access).toBe("none");
      }
    });
  });

  describe("denied by default outside alumni", () => {
    it("resolves to no permission for every Student, School and admin gate", async () => {
      mockQuery.mockResolvedValue([row({ level: 3, school_codes: null })]);
      expect(await getUserPermission("caller@avantifellows.org")).toBeNull();
      expect(await getResolvedPermission("caller@avantifellows.org")).toBeNull();
      expect(await canAccessSchool("caller@avantifellows.org", "70705")).toBe(false);
      expect(await isAdmin("caller@avantifellows.org")).toBe(false);
    });

    it("can't reach a Student, even one in its school", async () => {
      mockQuery.mockImplementation(async (sql: string) =>
        sql.includes("FROM user_permission") ? [row()] : [{ code: "70705", region: null, program_id: 1 }],
      );
      expect(await canAccessStudent(session, 42)).toBe(false);
    });

    it("leaves other roles unchanged", async () => {
      mockQuery.mockResolvedValue([row({ role: "teacher" })]);
      expect((await getUserPermission("caller@avantifellows.org"))?.role).toBe("teacher");
    });
  });

  describe("getAlumniPermission", () => {
    it("returns the alumni role with its explicit schools, ignoring centre seats", async () => {
      mockQuery.mockResolvedValueOnce([row()]);
      const p = await getAlumniPermission("caller@avantifellows.org");
      expect(p?.role).toBe(ALUMNI_MANAGER_ROLE);
      expect(p?.scope?.schools).toEqual(new Set(["70705"]));
      expect(p?.scope?.centres).toEqual(new Set());
      expect(mockQuery).toHaveBeenCalledTimes(1); // no centre_positions lookup
    });

    it("returns null when there is no row", async () => {
      mockQuery.mockResolvedValueOnce([]);
      expect(await getAlumniPermission("nobody@x.org")).toBeNull();
    });
  });
});

describe("getAlumniSchool", () => {
  it("finds the latest School enrollment through the alumni row, keyed by alumni.id", async () => {
    mockQuery.mockResolvedValueOnce([{ code: "70705", region: "West" }]);
    expect(await getAlumniSchool(8340)).toEqual({ code: "70705", region: "West" });
    expect(mockQuery.mock.calls[0][0]).toContain("FROM alumni a");
    expect(mockQuery.mock.calls[0][0]).toContain("er.group_type = 'school'");
    expect(mockQuery.mock.calls[0][1]).toEqual([8340]);
  });

  it("returns null for an unknown alumnus", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await getAlumniSchool(1)).toBeNull();
  });
});

describe("canAccessAlumni", () => {
  function answer(permissionRow: Record<string, unknown> | null, school: Record<string, unknown> | null) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
      if (sql.includes("FROM alumni a")) return school ? [school] : [];
      return [];
    });
  }

  it("needs a signed-in user", async () => {
    expect(await canAccessAlumni(null, 1)).toBe(false);
    expect(await canAccessAlumni({ user: { email: null } }, 1)).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("lets an alumni manager view and edit alumni of their School", async () => {
    answer(row(), { code: "70705", region: null });
    expect(await canAccessAlumni(session, 8340)).toBe(true);
    expect(await canAccessAlumni(session, 8340, { requireEdit: true })).toBe(true);
  });

  it("refuses alumni of another School", async () => {
    answer(row(), { code: "11111", region: null });
    expect(await canAccessAlumni(session, 8340)).toBe(false);
  });

  it("matches region scope at level 2", async () => {
    answer(row({ level: 2, school_codes: null, regions: ["West"] }), { code: "11111", region: "West" });
    expect(await canAccessAlumni(session, 8340)).toBe(true);
  });

  it("read_only can view but not edit", async () => {
    answer(row({ read_only: true }), { code: "70705", region: null });
    expect(await canAccessAlumni(session, 8340)).toBe(true);
    expect(await canAccessAlumni(session, 8340, { requireEdit: true })).toBe(false);
  });

  it("refuses roles without the alumni feature before looking the alumnus up", async () => {
    answer(row({ role: "teacher" }), { code: "70705", region: null });
    expect(await canAccessAlumni(session, 8340)).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("FROM alumni a"))).toBe(false);
  });

  it("lets admins in at every School, and refuses an unknown alumnus", async () => {
    answer(row({ role: "admin", level: 3, school_codes: null }), { code: "99999", region: null });
    expect(await canAccessAlumni(session, 8340, { requireEdit: true })).toBe(true);
    answer(row({ role: "admin", level: 3, school_codes: null }), null);
    expect(await canAccessAlumni(session, 8340)).toBe(false);
  });
});
