import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import type { UserPermission } from "@/lib/permissions";
import { getSchoolName, listAlumniSchools, schoolHasAlumni } from "./schools";

const mockQuery = vi.mocked(query);
const perm = (overrides: Partial<UserPermission>): UserPermission =>
  ({ email: "x@avantifellows.org", level: 3, role: "admin", read_only: false, ...overrides }) as UserPermission;

const ROWS = [
  { code: "59525", name: "JNV Adilabad", region: "Hyderabad", to_add: 2, alumni: 40 },
  { code: "3140103005", name: "RSMS Bathinda", region: null, to_add: 9, alumni: 7 },
  { code: "34092", name: "JNV Pune", region: "Pune", to_add: 2, alumni: 3 },
];

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue(ROWS as never);
});

describe("listAlumniSchools", () => {
  it("lists every school for all-schools access, most to add first, then by name", async () => {
    const schools = await listAlumniSchools(perm({}));
    expect(schools.map((s) => s.code)).toEqual(["3140103005", "59525", "34092"]);
    expect(schools[0]).toEqual({ code: "3140103005", name: "RSMS Bathinda", toAdd: 9, alumni: 7 });
  });

  it("narrows to the scope in SQL up front, not after counting every school", async () => {
    const level1 = perm({ role: "alumni_manager", level: 1, school_codes: ["3140103005"] });
    await listAlumniSchools(level1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("scoped_members AS MATERIALIZED");
    expect(sql).toContain("AND er.user_id IN (SELECT user_id FROM scoped_members)");
    expect(sql).toContain("WHERE (sc.code = ANY($4::text[]) OR sc.region = ANY($5::text[]))");
    expect((params as unknown[]).slice(3)).toEqual([["3140103005"], []]);

    mockQuery.mockClear();
    await listAlumniSchools(perm({ role: "alumni_manager", level: 2, regions: ["Pune"] }));
    expect((mockQuery.mock.calls[0][1] as unknown[]).slice(3)).toEqual([[], ["Pune"]]);
  });

  it("reads every school for all-schools access", async () => {
    await listAlumniSchools(perm({}));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("scoped_members");
    expect(params).toHaveLength(3);
  });

  it("counts pass-outs to add and alumni the way the school lists do", async () => {
    await listAlumniSchools(perm({}));
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("NOT is_alumni AND COALESCE(status, '') <> 'dropout'");
    expect(sql).toContain("FROM alumni a");
  });
});

describe("getSchoolName", () => {
  it("returns the name, or null for an unknown code", async () => {
    mockQuery.mockResolvedValueOnce([{ name: "RSMS Bathinda" }] as never).mockResolvedValueOnce([] as never);
    expect(await getSchoolName("3140103005")).toBe("RSMS Bathinda");
    expect(await getSchoolName("0")).toBeNull();
  });
});

describe("schoolHasAlumni", () => {
  it("is true when the school has alumni-program students or alumni, false for an NVS-only school", async () => {
    mockQuery.mockResolvedValueOnce([{ has_alumni: true }] as never).mockResolvedValueOnce([{ has_alumni: false }] as never);
    expect(await schoolHasAlumni(7)).toBe(true);
    expect(await schoolHasAlumni(8)).toBe(false);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("b.program_id = ANY($2::int[])");
    expect(sql).toContain("FROM alumni a");
    expect(params).toEqual([7, [1, 86, 87, 74, 2, 94]]);
  });

  it("is false when nothing comes back", async () => {
    mockQuery.mockResolvedValueOnce([] as never);
    expect(await schoolHasAlumni(9)).toBe(false);
  });
});
