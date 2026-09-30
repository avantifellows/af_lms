import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import {
  getAccessibleCentresWithCounts,
  getCentreWithSchool,
  resolveCentreAccess,
} from "./dashboard-groupings";

describe("dashboard centre-list scoping", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQuery.mockResolvedValue([{ id: "8", name: "Centre 8" }]);
  });

  // PMU roles have no centre access at all (ADR 0007) — not even the
  // seatless-manager fallback to centres at their accessible Schools.
  for (const role of ["pmu_manager", "pmu_govt_school_user"] as const) {
    for (const codes of [["70705"], "all"] as const) {
      it(`gives a ${role} with School scope ${JSON.stringify(codes)} no centres`, async () => {
        const permission = {
          email: "pmu@avantifellows.org",
          level: codes === "all" ? 3 : 1,
          role,
          school_codes: codes === "all" ? null : [...codes],
          regions: null,
          program_ids: [64],
        } as const;

        const centres = await getAccessibleCentresWithCounts(
          resolveCentreAccess(permission as never, codes === "all" ? "all" : [...codes]),
        );

        expect(centres).toEqual([]);
        expect(mockQuery).not.toHaveBeenCalled();
      });
    }
  }

  it("still lists centres at a seatless Program Manager's Schools", async () => {
    const permission = {
      email: "pm@avantifellows.org",
      level: 1,
      role: "program_manager",
      school_codes: ["70705"],
      regions: null,
      program_ids: [1],
    };

    const centres = await getAccessibleCentresWithCounts(
      resolveCentreAccess(permission as never, ["70705"]),
    );

    expect(centres).toHaveLength(1);
  });
});

describe("getCentreWithSchool", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null for an unknown or inactive centre", async () => {
    mockQuery.mockResolvedValue([]);

    await expect(getCentreWithSchool("999")).resolves.toBeNull();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE c.id = $1 AND c.is_active"),
      ["999"],
    );
  });

  it("coerces the numeric program id and resolves the parent school", async () => {
    mockQuery.mockResolvedValue([
      {
        id: "8",
        name: "Centre 8",
        program_id: "1",
        program_name: "CoE",
        school_id: "42",
        school_name: "JNV Pune",
        school_code: "70705",
        udise_code: "27250100101",
        district: "Pune",
        state: "Maharashtra",
        region: "West",
      },
    ]);

    await expect(getCentreWithSchool(8)).resolves.toEqual({
      id: "8",
      name: "Centre 8",
      program_id: 1,
      program_name: "CoE",
      school: {
        id: "42",
        name: "JNV Pune",
        code: "70705",
        udise_code: "27250100101",
        district: "Pune",
        state: "Maharashtra",
        region: "West",
      },
    });
  });

  it("defaults missing school text fields to empty strings", async () => {
    mockQuery.mockResolvedValue([
      {
        id: "9",
        name: "Centre 9",
        program_id: 2,
        program_name: null,
        school_id: "43",
        school_name: null,
        school_code: null,
        udise_code: null,
        district: null,
        state: null,
        region: null,
      },
    ]);

    const centre = await getCentreWithSchool("9");

    expect(centre?.program_id).toBe(2);
    expect(centre?.school).toEqual({
      id: "43",
      name: "",
      code: "",
      udise_code: null,
      district: "",
      state: "",
      region: null,
    });
  });

  it("returns a null program and school for a school-less city centre", async () => {
    mockQuery.mockResolvedValue([
      {
        id: "10",
        name: "City Centre",
        program_id: null,
        program_name: null,
        school_id: null,
        school_name: null,
        school_code: null,
        udise_code: null,
        district: null,
        state: null,
        region: null,
      },
    ]);

    await expect(getCentreWithSchool("10")).resolves.toEqual({
      id: "10",
      name: "City Centre",
      program_id: null,
      program_name: null,
      school: null,
    });
  });
});
