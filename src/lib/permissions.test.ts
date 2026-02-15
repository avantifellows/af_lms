import { describe, it, expect } from "vitest";
import {
  getSchoolByPasscode,
  getFeatureAccess,
  ownsRecord,
  getProgramContextSync,
  PROGRAM_IDS,
  type UserPermission,
} from "./permissions";

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
