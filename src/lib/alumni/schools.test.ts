import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import type { UserPermission } from "@/lib/permissions";
import { getSchoolName, listAlumniSchools } from "./schools";

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

  it("keeps only the schools in scope", async () => {
    const level1 = perm({ role: "alumni_manager", level: 1, school_codes: ["3140103005"] });
    expect((await listAlumniSchools(level1)).map((s) => s.code)).toEqual(["3140103005"]);
    const level2 = perm({ role: "alumni_manager", level: 2, regions: ["Pune"] });
    expect((await listAlumniSchools(level2)).map((s) => s.code)).toEqual(["34092"]);
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
