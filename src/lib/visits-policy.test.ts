import { describe, expect, it } from "vitest";

import type { UserPermission } from "@/lib/permissions";
import {
  buildOwnOrManagedVisitPredicate,
  buildVisitSummaryScopePredicate,
  canViewVisitSummary,
  buildVisitScopePredicate,
  buildVisitsActor,
  canAccessVisitSchoolScope,
  canEditCompletedActionData,
  canEditVisit,
  requiresVisitActionsForCompletion,
  canViewVisit,
  enforceVisitWriteLock,
  isScopedVisitsRole,
  managesVisitSchool,
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
  it("requires completed actions only for program managers", () => {
    const actor = (role: "program_manager" | "program_admin" | "admin") =>
      buildVisitsActor(`${role}@avantifellows.org`, makePermission({ role }));

    expect(requiresVisitActionsForCompletion(actor("program_manager"))).toBe(true);
    expect(requiresVisitActionsForCompletion(actor("program_admin"))).toBe(false);
    expect(requiresVisitActionsForCompletion(actor("admin"))).toBe(false);
  });

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

  it("allows program_admin to edit only their own in-scope visit", () => {
    const actor = buildVisitsActor(
      " PA@AvantiFellows.org ",
      makePermission({
        role: "program_admin",
        level: 2,
        regions: ["North"],
      })
    );

    expect(
      canEditVisit(actor, {
        pmEmail: "pa@avantifellows.org",
        schoolCode: "70705",
        schoolRegion: "North",
      })
    ).toBe(true);
    expect(
      canEditVisit(actor, {
        pmEmail: "other@avantifellows.org",
        schoolCode: "70705",
        schoolRegion: "North",
      })
    ).toBe(false);
    expect(
      canEditVisit(actor, {
        pmEmail: "pa@avantifellows.org",
        schoolCode: "70705",
        schoolRegion: "South",
      })
    ).toBe(false);
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

describe("buildVisitScopePredicate (seat-aware list filter)", () => {
  it("returns no clause for level 3 (all access)", () => {
    const actor = buildVisitsActor("a@x.org", makePermission({ role: "admin", level: 3 }));
    expect(buildVisitScopePredicate(actor)).toEqual({ clause: "", params: [] });
  });

  it("level 1 falls back to raw school_codes when scope is unresolved", () => {
    const actor = buildVisitsActor("t@x.org", makePermission({ level: 1, school_codes: ["70705"] }));
    const scope = buildVisitScopePredicate(actor, { startIndex: 1, schoolCodeColumn: "v.school_code" });
    expect(scope.clause).toBe("v.school_code = ANY($1)");
    expect(scope.params).toEqual([["70705"]]);
  });

  it("level 1 uses the resolved scope set (explicit ∪ seats) when present", () => {
    const actor = buildVisitsActor(
      "t@x.org",
      makePermission({
        level: 1,
        school_codes: ["70705"],
        scope: { schools: new Set(["70705", "99999"]), centres: new Set([5]), programs: new Set([1]) },
      })
    );
    const scope = buildVisitScopePredicate(actor, { startIndex: 1, schoolCodeColumn: "v.school_code" });
    expect(scope.clause).toBe("v.school_code = ANY($1)");
    expect(new Set(scope.params[0] as string[])).toEqual(new Set(["70705", "99999"]));
  });

  it("level 2 with only regions filters by region", () => {
    const actor = buildVisitsActor(
      "a@x.org",
      makePermission({ role: "admin", level: 2, regions: ["North"], school_codes: null })
    );
    const scope = buildVisitScopePredicate(actor, {
      startIndex: 3,
      schoolRegionColumn: "s.region",
    });
    expect(scope.clause).toBe("COALESCE(s.region, '') = ANY($3)");
    expect(scope.params).toEqual([["North"]]);
  });

  it("level 2 with seats ORs region and seat-school membership", () => {
    const actor = buildVisitsActor(
      "a@x.org",
      makePermission({
        role: "admin",
        level: 2,
        regions: ["North"],
        school_codes: null,
        scope: { schools: new Set(["55555"]), centres: new Set([9]), programs: new Set([1]) },
      })
    );
    const scope = buildVisitScopePredicate(actor, {
      startIndex: 1,
      schoolCodeColumn: "v.school_code",
      schoolRegionColumn: "s.region",
    });
    expect(scope.clause).toBe(
      "(COALESCE(s.region, '') = ANY($1) OR v.school_code = ANY($2))"
    );
    expect(scope.params).toEqual([["North"], ["55555"]]);
  });

  it("returns an always-false clause when a scoped role has no scope at all", () => {
    const actor = buildVisitsActor(
      "t@x.org",
      makePermission({ level: 1, school_codes: [], scope: { schools: new Set(), centres: new Set(), programs: new Set() } })
    );
    expect(buildVisitScopePredicate(actor)).toEqual({ clause: "1 = 0", params: [] });
  });
});

// #291: PM/SPM/PH Centre seats let a Program Manager read every Visit at those
// Centres' Schools, whoever made it — never edit it.
describe("visit-manager Centre seats", () => {
  const manager = buildVisitsActor(
    "pm@avantifellows.org",
    makePermission({
      email: "pm@avantifellows.org",
      scope: {
        schools: new Set(["70705", "80808"]),
        centres: new Set([1, 2]),
        programs: new Set([1]),
        visitManagedSchools: new Set(["80808"]),
      },
    })
  );
  const reporteeVisit = { pmEmail: "apm@avantifellows.org", schoolCode: "80808" };

  it("reads another person's Visit at a managed School, but cannot edit it", () => {
    expect(managesVisitSchool(manager, "80808")).toBe(true);
    expect(canViewVisit(manager, reporteeVisit)).toBe(true);
    expect(canEditVisit(manager, reporteeVisit)).toBe(false);
  });

  it("does not read another person's Visit at a School it only has seat access to", () => {
    expect(managesVisitSchool(manager, "70705")).toBe(false);
    expect(canViewVisit(manager, { ...reporteeVisit, schoolCode: "70705" })).toBe(false);
  });

  it("manages nothing without a resolved scope", () => {
    const bare = buildVisitsActor("pm@avantifellows.org", makePermission());
    expect(managesVisitSchool(bare, "80808")).toBe(false);
    expect(canViewVisit(bare, reporteeVisit)).toBe(false);
  });

  it("opens the Visit Summary to a manager, scoped to managed Schools only", () => {
    expect(canViewVisitSummary(manager)).toBe(true);
    expect(buildVisitSummaryScopePredicate(manager, {
      startIndex: 4,
      schoolCodeColumn: "v.school_code",
    })).toEqual({ clause: "v.school_code = ANY($4)", params: [["80808"]] });
  });

  it("keeps the Visit Summary closed to a PM with no visit-manager seat", () => {
    const apm = buildVisitsActor("apm@avantifellows.org", makePermission({
      scope: {
        schools: new Set(["70705"]),
        centres: new Set([1]),
        programs: new Set([1]),
        visitManagedSchools: new Set(),
      },
    }));
    expect(canViewVisitSummary(apm)).toBe(false);
    expect(buildVisitSummaryScopePredicate(apm)).toEqual({ clause: "1 = 0", params: [] });
    expect(canViewVisitSummary(buildVisitsActor("pm@avantifellows.org", makePermission()))).toBe(false);
  });

  it("builds an own-or-managed list predicate", () => {
    expect(buildOwnOrManagedVisitPredicate(manager, {
      startIndex: 3,
      pmEmailColumn: "v.pm_email",
      schoolCodeColumn: "v.school_code",
    })).toEqual({
      clause: "(LOWER(TRIM(v.pm_email)) = $3 OR v.school_code = ANY($4))",
      params: ["pm@avantifellows.org", ["80808"]],
    });
  });

  it("falls back to own Visits only, with a normalized email, when nothing is managed", () => {
    const bare = buildVisitsActor(" PM@AvantiFellows.org ", makePermission());
    expect(buildOwnOrManagedVisitPredicate(bare)).toEqual({
      clause: "LOWER(TRIM(pm_email)) = $1",
      params: ["pm@avantifellows.org"],
    });
  });
});
