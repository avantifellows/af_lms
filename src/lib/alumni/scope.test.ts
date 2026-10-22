import { describe, expect, it } from "vitest";
import type { UserPermission } from "@/lib/permissions";
import { reachesAllSchools, schoolScopeSql } from "./scope";

const perm = (overrides: Partial<UserPermission>): UserPermission =>
  ({ email: "x@avantifellows.org", level: 1, role: "alumni_manager", read_only: false, ...overrides }) as UserPermission;

describe("schoolScopeSql", () => {
  it("doesn't filter level 3", () => {
    expect(schoolScopeSql(perm({ level: 3 }), "sc.code", "sc.region", 4)).toEqual({ sql: "TRUE", params: [] });
    expect(reachesAllSchools(perm({ level: 3 }))).toBe(true);
  });

  it("matches the School codes at level 1, numbering params from `first`", () => {
    expect(schoolScopeSql(perm({ school_codes: ["59525", "3140103005"] }), "sch.code", "sch.region", 2)).toEqual({
      sql: "(sch.code = ANY($2::text[]) OR sch.region = ANY($3::text[]))",
      params: [["59525", "3140103005"], []],
    });
    expect(reachesAllSchools(perm({}))).toBe(false);
  });

  it("matches the regions at level 2, and only at level 2", () => {
    expect(schoolScopeSql(perm({ level: 2, regions: ["Pune"] }), "c", "r", 1).params).toEqual([[], ["Pune"]]);
    expect(schoolScopeSql(perm({ level: 1, regions: ["Pune"] }), "c", "r", 1).params).toEqual([[], []]);
  });

  it("adds seat Schools from a resolved scope, without duplicates", () => {
    const seated = perm({
      school_codes: ["1"],
      scope: { schools: new Set(["1", "2"]), centres: new Set(), programs: new Set() },
    } as Partial<UserPermission>);
    expect(schoolScopeSql(seated, "c", "r", 1).params[0]).toEqual(["1", "2"]);
  });
});
