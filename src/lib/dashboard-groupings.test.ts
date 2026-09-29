import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { getAccessibleCentresWithCounts, resolveCentreAccess } from "./dashboard-groupings";

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
