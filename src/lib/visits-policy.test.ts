import { describe, expect, it } from "vitest";

import type { UserPermission } from "@/lib/permissions";
import {
  buildVisitsActor,
  canAccessVisitSchoolScope,
  canEditCompletedActionData,
  canEditVisit,
  canViewVisit,
  enforceVisitWriteLock,
  isScopedVisitsRole,
} from "./visits-policy";

function makePermission(overrides: Partial<UserPermission> = {}): UserPermission {
  return {
    email: "user@avantifellows.org",
    level: 1,
    role: "program_manager",
    school_codes: ["70705"],
    regions: null,
    program_ids: [1],
    read_only: false,
    ...overrides,
  };
}

describe("visits-policy", () => {
  it("allows owner PM to view and edit own visit", () => {
    const permission = makePermission({
      email: "pm@avantifellows.org",
      role: "program_manager",
    });
    const actor = buildVisitsActor("pm@avantifellows.org", permission);

    expect(
      canViewVisit(actor, {
        pmEmail: "pm@avantifellows.org",
        schoolCode: "99999",
      })
    ).toBe(true);
    expect(
      canEditVisit(actor, {
        pmEmail: "pm@avantifellows.org",
        schoolCode: "99999",
      })
    ).toBe(true);
  });

  it("enforces scoped access for admin and program_admin", () => {
    const admin = buildVisitsActor(
      "admin@avantifellows.org",
      makePermission({
        role: "admin",
        level: 2,
        regions: ["North"],
      })
    );

    const programAdmin = buildVisitsActor(
      "pa@avantifellows.org",
      makePermission({
        role: "program_admin",
        level: 2,
        regions: ["North"],
      })
    );

    const inScope = { pmEmail: "pm@avantifellows.org", schoolCode: "70705", schoolRegion: "North" };
    const outOfScope = { pmEmail: "pm@avantifellows.org", schoolCode: "70705", schoolRegion: "South" };

    expect(canViewVisit(admin, inScope)).toBe(true);
    expect(canViewVisit(admin, outOfScope)).toBe(false);
    expect(canEditVisit(admin, inScope)).toBe(true);
    expect(canEditVisit(admin, outOfScope)).toBe(false);

    expect(canViewVisit(programAdmin, inScope)).toBe(true);
    expect(canViewVisit(programAdmin, outOfScope)).toBe(false);
    expect(canEditVisit(programAdmin, inScope)).toBe(false);
    expect(isScopedVisitsRole(admin)).toBe(true);
    expect(isScopedVisitsRole(programAdmin)).toBe(true);
    expect(canAccessVisitSchoolScope(admin, "70705", "North")).toBe(true);
    expect(canAccessVisitSchoolScope(admin, "70705", "South")).toBe(false);
  });

  it("does not mark PM as scoped-role reader", () => {
    const pm = buildVisitsActor(
      "pm@avantifellows.org",
      makePermission({ role: "program_manager", level: 2, regions: ["North"] })
    );
    expect(isScopedVisitsRole(pm)).toBe(false);
  });

  it("locks completed visits and restricts completed-action edits to admin", () => {
    const pm = buildVisitsActor("pm@avantifellows.org", makePermission({ role: "program_manager" }));
    const admin = buildVisitsActor("admin@avantifellows.org", makePermission({ role: "admin" }));

    const lockError = enforceVisitWriteLock("completed");
    expect(lockError?.status).toBe(409);
    expect(canEditCompletedActionData(pm)).toBe(false);
    expect(canEditCompletedActionData(admin)).toBe(true);
  });
});
