import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canAccessSchool,
  canAccessStudent,
  getBlendedLearningPermission,
  getFeatureAccess,
  getResolvedPermission,
  getUserPermission,
  isAdmin,
  isUserRole,
  type Feature,
  type UserPermission,
} from "./permissions";
import {
  BLENDED_ADMIN_ROLE,
  BLENDED_MENTOR_ROLE,
  BLENDED_ROLES,
  isBlendedRole,
} from "./constants";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
const mockQuery = vi.mocked(query);

beforeEach(() => {
  mockQuery.mockReset();
});

const EXISTING_FEATURES: Feature[] = [
  "students",
  "visits",
  "curriculum",
  "academic_mentorship",
  "holistic_mentorship",
  "performance",
  "summary_stats",
  "pm_dashboard",
  "quiz_sessions",
  "teacher_feedback",
];

function blendedPermission(
  role: "blended_mentor" | "blended_admin",
  overrides: Partial<UserPermission> = {},
): UserPermission {
  return {
    email: `${role}@avantifellows.org`,
    level: 1,
    role,
    school_codes: null,
    regions: null,
    program_ids: [],
    read_only: false,
    ...overrides,
  };
}

describe("Blended Learning roles", () => {
  it("are known roles with client-safe constants", () => {
    expect(BLENDED_MENTOR_ROLE).toBe("blended_mentor");
    expect(BLENDED_ADMIN_ROLE).toBe("blended_admin");
    expect([...BLENDED_ROLES]).toEqual(["blended_mentor", "blended_admin"]);
    expect(isBlendedRole("blended_mentor")).toBe(true);
    expect(isBlendedRole("blended_admin")).toBe(true);
    expect(isBlendedRole("admin")).toBe(false);
    expect(isBlendedRole(undefined)).toBe(false);
    expect(isUserRole("blended_mentor")).toBe(true);
    expect(isUserRole("blended_admin")).toBe(true);
  });
});

describe("blended_learning feature matrix", () => {
  it.each([
    ["blended_mentor", "edit"],
    ["blended_admin", "edit"],
    ["admin", "edit"],
    ["teacher", "none"],
    ["program_manager", "none"],
    ["program_admin", "none"],
    ["holistic_mentorship_admin", "none"],
    ["pmu_manager", "none"],
    ["pmu_govt_school_user", "none"],
  ] as const)("gives %s %s access", (role, access) => {
    const permission: UserPermission = {
      email: "someone@avantifellows.org",
      level: 3,
      role,
      program_ids: [1, 2, 64],
      read_only: false,
    };
    expect(getFeatureAccess(permission, "blended_learning").access).toBe(access);
  });

  it.each(["blended_mentor", "blended_admin", "admin"] as const)(
    "downgrades read-only %s to view",
    (role) => {
      const permission: UserPermission = {
        email: "someone@avantifellows.org",
        level: 1,
        role,
        program_ids: [],
        read_only: true,
      };
      expect(getFeatureAccess(permission, "blended_learning").access).toBe("view");
    },
  );

  it.each(["blended_mentor", "blended_admin"] as const)(
    "gives %s no access to any existing feature",
    (role) => {
      for (const feature of EXISTING_FEATURES) {
        expect(getFeatureAccess(blendedPermission(role), feature).access).toBe("none");
      }
    },
  );
});

// The user_permission row a Blended user signs in with. The shared lookup and
// every School/Student guard read it through the same query.
function permissionRow(role: string, readOnly = false) {
  return {
    email: "mentor@avantifellows.org",
    level: 3,
    role,
    school_codes: null,
    regions: null,
    program_ids: [1, 2, 64],
    read_only: readOnly,
    user_id: 501,
  };
}

function withPermissionRow(row: ReturnType<typeof permissionRow>) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM user_permission")) return [row];
    // getStudentSchool: the Student sits in an in-scope School.
    if (sql.includes("FROM student s")) return [{ code: "70705", region: "AHMEDABAD", program_id: 1 }];
    return [];
  });
}

describe("deny-by-default for Blended Learning roles", () => {
  it.each(["blended_mentor", "blended_admin"])(
    "the shared lookup and every existing guard deny %s",
    async (role) => {
      // Even a row that (wrongly) carries level 3 and every Program is denied.
      withPermissionRow(permissionRow(role));
      const session = { user: { email: "mentor@avantifellows.org" } };

      expect(await getUserPermission("mentor@avantifellows.org")).toBeNull();
      expect(await getResolvedPermission("mentor@avantifellows.org")).toBeNull();
      expect(await canAccessSchool("mentor@avantifellows.org", "70705", "AHMEDABAD")).toBe(false);
      expect(await canAccessStudent(session, 42)).toBe(false);
      expect(await isAdmin("mentor@avantifellows.org")).toBe(false);
    },
  );

  it("still resolves an LMS admin through the shared lookup", async () => {
    withPermissionRow(permissionRow("admin"));
    expect(await isAdmin("mentor@avantifellows.org")).toBe(true);
    expect(await canAccessSchool("mentor@avantifellows.org", "70705", "AHMEDABAD")).toBe(true);
  });

  it("Blended Learning code reads the blended row through its own lookup", async () => {
    withPermissionRow(permissionRow("blended_admin", true));
    expect(await getBlendedLearningPermission("mentor@avantifellows.org")).toMatchObject({
      email: "mentor@avantifellows.org",
      role: "blended_admin",
      read_only: true,
      user_id: 501,
    });
  });

  it("the Blended Learning lookup returns null when no live row exists", async () => {
    mockQuery.mockResolvedValue([]);
    expect(await getBlendedLearningPermission("nobody@avantifellows.org")).toBeNull();
  });
});
