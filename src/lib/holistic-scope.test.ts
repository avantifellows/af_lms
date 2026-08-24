import { describe, expect, it } from "vitest";

import { buildHolisticSchoolScopePredicate } from "./holistic-scope";
import type { UserPermission } from "./permissions";

function permission(overrides: Partial<UserPermission> = {}): UserPermission {
  return {
    email: "admin@example.com",
    level: 3,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: [1, 78],
    ...overrides,
  };
}

describe("buildHolisticSchoolScopePredicate", () => {
  it("keeps Admin and Holistic Mentorship Admin reads program-wide", () => {
    expect(buildHolisticSchoolScopePredicate(permission())).toEqual({
      clause: "",
      params: [],
    });
    expect(buildHolisticSchoolScopePredicate(permission({
      role: "holistic_mentorship_admin",
      level: 1,
      school_codes: [],
    }))).toEqual({ clause: "", params: [] });
  });

  it("keeps any level-3 resolved School scope program-wide", () => {
    expect(buildHolisticSchoolScopePredicate(permission({
      role: "program_manager",
      level: 3,
      program_ids: [1],
      scope: { schools: "all", centres: "all", programs: "all" },
    }))).toEqual({ clause: "", params: [] });
  });

  it("filters an explicit School-code scope", () => {
    const result = buildHolisticSchoolScopePredicate(permission({
      role: "program_manager",
      level: 1,
      school_codes: ["SCH001", "SCH002"],
    }), {
      startIndex: 4,
      schoolCodeColumn: "school.code",
    });

    expect(result).toEqual({
      clause: "school.code = ANY($4::text[])",
      params: [["SCH001", "SCH002"]],
    });
  });

  it("filters a region scope using the School region", () => {
    const result = buildHolisticSchoolScopePredicate(permission({
      role: "program_admin",
      level: 2,
      regions: ["North", "East"],
    }), {
      startIndex: 3,
      schoolRegionColumn: "school.region",
    });

    expect(result).toEqual({
      clause: "COALESCE(school.region, '') = ANY($3::text[])",
      params: [["North", "East"]],
    });
  });

  it("uses centre-seat-derived Schools from the resolved scope", () => {
    const result = buildHolisticSchoolScopePredicate(permission({
      role: "program_manager",
      level: 1,
      school_codes: [],
      scope: {
        schools: new Set(["SEAT001", "SEAT002"]),
        centres: new Set([17, 18]),
        programs: new Set([1]),
      },
    }), {
      schoolCodeColumn: "school.code",
    });

    expect(result).toEqual({
      clause: "school.code = ANY($1::text[])",
      params: [["SEAT001", "SEAT002"]],
    });
  });

  it("unions region and centre-seat-derived School access", () => {
    const result = buildHolisticSchoolScopePredicate(permission({
      role: "program_admin",
      level: 2,
      regions: ["North"],
      scope: {
        schools: new Set(["SEAT001"]),
        centres: new Set([17]),
        programs: new Set([78]),
      },
    }), {
      startIndex: 5,
      schoolCodeColumn: "school.code",
      schoolRegionColumn: "school.region",
    });

    expect(result).toEqual({
      clause: "(COALESCE(school.region, '') = ANY($5::text[]) OR school.code = ANY($6::text[]))",
      params: [["North"], ["SEAT001"]],
    });
  });

  it("fails closed for an empty School scope", () => {
    expect(buildHolisticSchoolScopePredicate(permission({
      role: "program_manager",
      level: 1,
      school_codes: [],
      scope: {
        schools: new Set(),
        centres: new Set(),
        programs: new Set(),
      },
    }))).toEqual({ clause: "1 = 0", params: [] });
  });
});
