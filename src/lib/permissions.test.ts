import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSchoolByPasscode,
  getFeatureAccess,
  ownsRecord,
  getProgramContextSync,
  PROGRAM_IDS,
  type UserPermission,
} from "./permissions";

// Mock the DB module for async function tests
vi.mock("./db", () => ({
  query: vi.fn(),
}));

import { query } from "./db";
const mockQuery = vi.mocked(query);

// Helper to build a permission object with defaults
function makePermission(overrides: Partial<UserPermission> = {}): UserPermission {
  return {
    email: "test@example.com",
    level: 1,
    role: "teacher",
    school_codes: ["70705"],
    regions: null,
    program_ids: [PROGRAM_IDS.COE, PROGRAM_IDS.NVS],
    read_only: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getSchoolByPasscode", () => {
  it("returns school code for a valid passcode", () => {
    expect(getSchoolByPasscode("70705123")).toBe("70705");
  });

  it("returns null for an invalid passcode", () => {
    expect(getSchoolByPasscode("00000000")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getSchoolByPasscode("")).toBeNull();
  });
});

describe("getProgramContextSync", () => {
  it("returns no access for null permission", () => {
    const ctx = getProgramContextSync(null);
    expect(ctx.hasAccess).toBe(false);
    expect(ctx.programIds).toEqual([]);
    expect(ctx.isNVSOnly).toBe(false);
    expect(ctx.hasCoEOrNodal).toBe(false);
  });

  it("gives admin full access regardless of program_ids", () => {
    const ctx = getProgramContextSync(makePermission({ role: "admin", program_ids: null }));
    expect(ctx.hasAccess).toBe(true);
    expect(ctx.hasCoEOrNodal).toBe(true);
    expect(ctx.isNVSOnly).toBe(false);
  });

  it("detects NVS-only user", () => {
    const ctx = getProgramContextSync(
      makePermission({ role: "teacher", program_ids: [PROGRAM_IDS.NVS] })
    );
    expect(ctx.hasAccess).toBe(true);
    expect(ctx.isNVSOnly).toBe(true);
    expect(ctx.hasCoEOrNodal).toBe(false);
  });

  it("detects CoE + NVS user as not NVS-only", () => {
    const ctx = getProgramContextSync(
      makePermission({ program_ids: [PROGRAM_IDS.COE, PROGRAM_IDS.NVS] })
    );
    expect(ctx.isNVSOnly).toBe(false);
    expect(ctx.hasCoEOrNodal).toBe(true);
  });

  it("detects Nodal user as having CoE/Nodal", () => {
    const ctx = getProgramContextSync(
      makePermission({ program_ids: [PROGRAM_IDS.NODAL] })
    );
    expect(ctx.hasCoEOrNodal).toBe(true);
    expect(ctx.isNVSOnly).toBe(false);
  });

  it("returns no access for non-admin with empty program_ids", () => {
    const ctx = getProgramContextSync(
      makePermission({ role: "teacher", program_ids: [] })
    );
    expect(ctx.hasAccess).toBe(false);
  });
});

describe("getFeatureAccess", () => {
  describe("passcode users", () => {
    it("gives edit access to students", () => {
      const result = getFeatureAccess(null, "students", { isPasscodeUser: true });
      expect(result.access).toBe("edit");
      expect(result.canView).toBe(true);
      expect(result.canEdit).toBe(true);
    });

    it("gives no access to visits", () => {
      const result = getFeatureAccess(null, "visits", { isPasscodeUser: true });
      expect(result.access).toBe("none");
      expect(result.canView).toBe(false);
    });

    it("gives no access to curriculum", () => {
      const result = getFeatureAccess(null, "curriculum", { isPasscodeUser: true });
      expect(result.access).toBe("none");
    });
  });

  describe("null permission", () => {
    it("returns none for any feature", () => {
      expect(getFeatureAccess(null, "students").access).toBe("none");
      expect(getFeatureAccess(null, "visits").access).toBe("none");
    });
  });

  describe("role-based access", () => {
    it("gives teachers edit on students", () => {
      const perm = makePermission({ role: "teacher", program_ids: [PROGRAM_IDS.COE] });
      const result = getFeatureAccess(perm, "students");
      expect(result.canEdit).toBe(true);
    });

    it("gives teachers no access to visits", () => {
      const perm = makePermission({ role: "teacher", program_ids: [PROGRAM_IDS.COE] });
      const result = getFeatureAccess(perm, "visits");
      expect(result.access).toBe("none");
    });

    it("gives PMs edit on visits", () => {
      const perm = makePermission({ role: "program_manager", program_ids: [PROGRAM_IDS.COE] });
      const result = getFeatureAccess(perm, "visits");
      expect(result.canEdit).toBe(true);
    });

    it("gives program_admin view on visits", () => {
      const perm = makePermission({ role: "program_admin", program_ids: [PROGRAM_IDS.COE] });
      const result = getFeatureAccess(perm, "visits");
      expect(result.access).toBe("view");
      expect(result.canView).toBe(true);
      expect(result.canEdit).toBe(false);
    });

    it("gives admin edit on visits", () => {
      const perm = makePermission({ role: "admin" });
      const result = getFeatureAccess(perm, "visits");
      expect(result.canEdit).toBe(true);
    });
  });

  describe("NVS-only gating", () => {
    it("blocks NVS-only user from visits", () => {
      const perm = makePermission({
        role: "program_manager",
        program_ids: [PROGRAM_IDS.NVS],
      });
      const result = getFeatureAccess(perm, "visits");
      expect(result.access).toBe("none");
    });

    it("blocks NVS-only user from curriculum", () => {
      const perm = makePermission({
        role: "teacher",
        program_ids: [PROGRAM_IDS.NVS],
      });
      const result = getFeatureAccess(perm, "curriculum");
      expect(result.access).toBe("none");
    });

    it("allows CoE PM to access visits", () => {
      const perm = makePermission({
        role: "program_manager",
        program_ids: [PROGRAM_IDS.COE],
      });
      const result = getFeatureAccess(perm, "visits");
      expect(result.canEdit).toBe(true);
    });

    it("does not gate students (non-NVS-gated feature)", () => {
      const perm = makePermission({
        role: "teacher",
        program_ids: [PROGRAM_IDS.NVS],
      });
      const result = getFeatureAccess(perm, "students");
      expect(result.canEdit).toBe(true);
    });
  });

  describe("read_only downgrade", () => {
    it("downgrades edit to view for read_only users", () => {
      const perm = makePermission({ role: "teacher", read_only: true, program_ids: [PROGRAM_IDS.COE] });
      const result = getFeatureAccess(perm, "students");
      expect(result.access).toBe("view");
      expect(result.canView).toBe(true);
      expect(result.canEdit).toBe(false);
    });

    it("does not affect view-only features", () => {
      const perm = makePermission({ role: "teacher", read_only: true, program_ids: [PROGRAM_IDS.COE] });
      const result = getFeatureAccess(perm, "performance");
      expect(result.access).toBe("view");
    });
  });
});

describe("ownsRecord", () => {
  it("passcode users own all records", () => {
    expect(ownsRecord(null, 64, { isPasscodeUser: true })).toBe(true);
  });

  it("returns false for null permission (non-passcode)", () => {
    expect(ownsRecord(null, 64)).toBe(false);
  });

  it("admins own all records", () => {
    const perm = makePermission({ role: "admin" });
    expect(ownsRecord(perm, 999)).toBe(true);
  });

  it("returns true for null programId (unassigned records)", () => {
    const perm = makePermission({ program_ids: [PROGRAM_IDS.COE] });
    expect(ownsRecord(perm, null)).toBe(true);
  });

  it("returns true when user has the program", () => {
    const perm = makePermission({ program_ids: [PROGRAM_IDS.COE, PROGRAM_IDS.NVS] });
    expect(ownsRecord(perm, PROGRAM_IDS.NVS)).toBe(true);
  });

  it("returns false when user lacks the program", () => {
    const perm = makePermission({ program_ids: [PROGRAM_IDS.COE] });
    expect(ownsRecord(perm, PROGRAM_IDS.NVS)).toBe(false);
  });

  it("returns false for empty program_ids", () => {
    const perm = makePermission({ program_ids: [] });
    expect(ownsRecord(perm, PROGRAM_IDS.NVS)).toBe(false);
  });
});

// --- Async function tests (DB-dependent) ---

describe("getUserPermission", () => {
  // Import dynamically to use the mocked db
  let getUserPermission: typeof import("./permissions").getUserPermission;

  beforeEach(async () => {
    const mod = await import("./permissions");
    getUserPermission = mod.getUserPermission;
  });

  it("returns permission object for valid email", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        email: "pm@avantifellows.org",
        level: 3,
        role: "program_manager",
        school_codes: null,
        regions: ["West"],
        program_ids: [1, 64],
        read_only: false,
      },
    ]);

    const result = await getUserPermission("pm@avantifellows.org");
    expect(result).toEqual({
      email: "pm@avantifellows.org",
      level: 3,
      role: "program_manager",
      school_codes: null,
      regions: ["West"],
      program_ids: [1, 64],
      read_only: false,
    });
  });

  it("returns null when no rows found", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await getUserPermission("unknown@example.com");
    expect(result).toBeNull();
  });

  it("defaults role to 'teacher' when DB role is empty", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        email: "user@example.com",
        level: 1,
        role: "",
        school_codes: ["70705"],
        regions: null,
        program_ids: null,
        read_only: false,
      },
    ]);

    const result = await getUserPermission("user@example.com");
    expect(result!.role).toBe("teacher");
  });

  it("casts level to AccessLevel", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        email: "admin@avantifellows.org",
        level: 4,
        role: "admin",
        school_codes: null,
        regions: null,
        program_ids: [1, 2, 64],
        read_only: false,
      },
    ]);

    const result = await getUserPermission("admin@avantifellows.org");
    expect(result!.level).toBe(4);
  });
});

describe("canAccessSchool", () => {
  let canAccessSchool: typeof import("./permissions").canAccessSchool;

  beforeEach(async () => {
    const mod = await import("./permissions");
    canAccessSchool = mod.canAccessSchool;
  });

  it("returns false for null email", async () => {
    const result = await canAccessSchool(null, "70705");
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns false for unknown email", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await canAccessSchool("unknown@example.com", "70705");
    expect(result).toBe(false);
  });

  it("returns true for level 4 (admin)", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "admin@af.org", level: 4, role: "admin", school_codes: null, regions: null, program_ids: null, read_only: false },
    ]);
    const result = await canAccessSchool("admin@af.org", "70705");
    expect(result).toBe(true);
  });

  it("returns true for level 3 (all schools)", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "pm@af.org", level: 3, role: "program_manager", school_codes: null, regions: null, program_ids: null, read_only: false },
    ]);
    const result = await canAccessSchool("pm@af.org", "12345");
    expect(result).toBe(true);
  });

  it("returns true for level 2 with matching region", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "pm@af.org", level: 2, role: "program_manager", school_codes: null, regions: ["West"], program_ids: null, read_only: false },
    ]);
    const result = await canAccessSchool("pm@af.org", "12345", "West");
    expect(result).toBe(true);
  });

  it("returns false for level 2 with non-matching region", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "pm@af.org", level: 2, role: "program_manager", school_codes: null, regions: ["West"], program_ids: null, read_only: false },
    ]);
    const result = await canAccessSchool("pm@af.org", "12345", "East");
    expect(result).toBe(false);
  });

  it("level 2 queries DB for region when not provided", async () => {
    // First call: getUserPermission
    mockQuery.mockResolvedValueOnce([
      { email: "pm@af.org", level: 2, role: "program_manager", school_codes: null, regions: ["West"], program_ids: null, read_only: false },
    ]);
    // Second call: school region lookup
    mockQuery.mockResolvedValueOnce([{ region: "West" }]);

    const result = await canAccessSchool("pm@af.org", "12345");
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns true for level 1 with matching school_code", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "t@af.org", level: 1, role: "teacher", school_codes: ["70705", "14042"], regions: null, program_ids: null, read_only: false },
    ]);
    const result = await canAccessSchool("t@af.org", "70705");
    expect(result).toBe(true);
  });

  it("returns false for level 1 with non-matching school_code", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "t@af.org", level: 1, role: "teacher", school_codes: ["70705"], regions: null, program_ids: null, read_only: false },
    ]);
    const result = await canAccessSchool("t@af.org", "99999");
    expect(result).toBe(false);
  });

  it("returns false for level 1 with null school_codes", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "t@af.org", level: 1, role: "teacher", school_codes: null, regions: null, program_ids: null, read_only: false },
    ]);
    const result = await canAccessSchool("t@af.org", "70705");
    expect(result).toBe(false);
  });

  it("returns false for level 2 with null regions", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "pm@af.org", level: 2, role: "program_manager", school_codes: null, regions: null, program_ids: null, read_only: false },
    ]);
    const result = await canAccessSchool("pm@af.org", "12345", "West");
    expect(result).toBe(false);
  });

  it("returns false for unexpected permission level (default case)", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "t@af.org", level: 99, role: "teacher", school_codes: null, regions: null, program_ids: null, read_only: false },
    ]);
    const result = await canAccessSchool("t@af.org", "70705");
    expect(result).toBe(false);
  });
});

describe("getAccessibleSchoolCodes", () => {
  let getAccessibleSchoolCodes: typeof import("./permissions").getAccessibleSchoolCodes;

  beforeEach(async () => {
    const mod = await import("./permissions");
    getAccessibleSchoolCodes = mod.getAccessibleSchoolCodes;
  });

  it("returns 'all' for level 4", async () => {
    const perm = makePermission({ level: 4, role: "admin" });
    const result = await getAccessibleSchoolCodes("admin@af.org", perm);
    expect(result).toBe("all");
  });

  it("returns 'all' for level 3", async () => {
    const perm = makePermission({ level: 3 });
    const result = await getAccessibleSchoolCodes("pm@af.org", perm);
    expect(result).toBe("all");
  });

  it("returns school_codes array for level 1", async () => {
    const perm = makePermission({ level: 1, school_codes: ["70705", "14042"] });
    const result = await getAccessibleSchoolCodes("t@af.org", perm);
    expect(result).toEqual(["70705", "14042"]);
  });

  it("returns empty array for level 1 with null school_codes", async () => {
    const perm = makePermission({ level: 1, school_codes: null });
    const result = await getAccessibleSchoolCodes("t@af.org", perm);
    expect(result).toEqual([]);
  });

  it("queries DB for level 2 with regions", async () => {
    const perm = makePermission({ level: 2, regions: ["West"] });
    mockQuery.mockResolvedValueOnce([{ code: "70705" }, { code: "14042" }]);
    const result = await getAccessibleSchoolCodes("pm@af.org", perm);
    expect(result).toEqual(["70705", "14042"]);
  });

  it("returns empty array for null permission", async () => {
    const result = await getAccessibleSchoolCodes("unknown@af.org", null);
    expect(result).toEqual([]);
  });

  it("returns empty array for level 2 with null regions", async () => {
    const perm = makePermission({ level: 2, regions: null });
    const result = await getAccessibleSchoolCodes("pm@af.org", perm);
    expect(result).toEqual([]);
  });

  it("returns empty array for level 2 with empty regions", async () => {
    const perm = makePermission({ level: 2, regions: [] });
    const result = await getAccessibleSchoolCodes("pm@af.org", perm);
    expect(result).toEqual([]);
  });

  it("fetches permission from DB when not provided", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "admin@af.org", level: 4, role: "admin", school_codes: null, regions: null, program_ids: null, read_only: false },
    ]);
    const result = await getAccessibleSchoolCodes("admin@af.org");
    expect(result).toBe("all");
  });
});

describe("isAdmin", () => {
  let isAdmin: typeof import("./permissions").isAdmin;

  beforeEach(async () => {
    const mod = await import("./permissions");
    isAdmin = mod.isAdmin;
  });

  it("returns true for level 4", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "admin@af.org", level: 4, role: "admin", school_codes: null, regions: null, program_ids: null, read_only: false },
    ]);
    expect(await isAdmin("admin@af.org")).toBe(true);
  });

  it("returns false for non-level-4", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "pm@af.org", level: 3, role: "program_manager", school_codes: null, regions: null, program_ids: null, read_only: false },
    ]);
    expect(await isAdmin("pm@af.org")).toBe(false);
  });

  it("returns false for unknown email", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await isAdmin("nobody@example.com")).toBe(false);
  });
});

describe("getProgramContext", () => {
  let getProgramContext: typeof import("./permissions").getProgramContext;

  beforeEach(async () => {
    const mod = await import("./permissions");
    getProgramContext = mod.getProgramContext;
  });

  it("delegates to getUserPermission + getProgramContextSync", async () => {
    mockQuery.mockResolvedValueOnce([
      { email: "pm@af.org", level: 2, role: "program_manager", school_codes: null, regions: ["West"], program_ids: [PROGRAM_IDS.COE, PROGRAM_IDS.NVS], read_only: false },
    ]);

    const result = await getProgramContext("pm@af.org");
    expect(result.hasAccess).toBe(true);
    expect(result.hasCoEOrNodal).toBe(true);
    expect(result.isNVSOnly).toBe(false);
    expect(result.programIds).toEqual([PROGRAM_IDS.COE, PROGRAM_IDS.NVS]);
  });

  it("returns no-access for unknown email", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await getProgramContext("unknown@example.com");
    expect(result.hasAccess).toBe(false);
    expect(result.programIds).toEqual([]);
  });
});
