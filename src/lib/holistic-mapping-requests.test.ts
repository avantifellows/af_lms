import { describe, expect, it } from "vitest";

import {
  parseHolisticAdminAssign,
  parseHolisticAdminRemove,
  parseHolisticAdminReassign,
  parseHolisticMappingRosterFilters,
  parseHolisticTeacherClaim,
  parseHolisticTeacherRemoval,
} from "./holistic-mapping-requests";

const currentYear = "2026-2027";

describe("Holistic mapping request parsers", () => {
  it("parses current-year roster filters and trims search", () => {
    const result = parseHolisticMappingRosterFilters(new URLSearchParams({
      school_code: "SCH001",
      academic_year: currentYear,
      program_id: "78",
      grade: "12",
      search: "  asha  ",
    }));

    expect(result).toEqual({
      ok: true,
      value: {
        schoolCode: "SCH001",
        programId: 78,
        academicYear: currentYear,
        search: "asha",
        grade: 12,
      },
    });
  });

  it.each([
    ["missing Program", new URLSearchParams("school_code=SCH001&academic_year=2026-2027")],
    ["unsupported Program", new URLSearchParams("school_code=SCH001&academic_year=2026-2027&program_id=2")],
    ["historical year", new URLSearchParams("school_code=SCH001&academic_year=2025-2026&program_id=1")],
  ])("rejects %s roster filters", (_label, params) => {
    expect(parseHolisticMappingRosterFilters(params)).toEqual({
      ok: false,
      error: "Invalid roster filters",
    });
  });

  it("enforces the Teacher selection cap and duplicate detection", () => {
    const tooMany = parseHolisticTeacherClaim({
      school_code: "SCH001",
      program_id: 1,
      academic_year: currentYear,
      selections: Array.from({ length: 51 }, (_, index) => ({
        student_id: index + 1,
        expected_mapping_id: null,
      })),
    });
    expect(tooMany).toEqual({ ok: false, error: "Invalid Mapping selection" });

    const duplicate = parseHolisticTeacherClaim({
      school_code: "SCH001",
      program_id: 1,
      academic_year: currentYear,
      selections: [
        { student_id: 41, expected_mapping_id: null },
        { student_id: 41, expected_mapping_id: null },
      ],
    });
    expect(duplicate).toEqual({ ok: false, error: "Invalid Mapping selection" });
  });

  it("keeps Teacher removal confirmation and expected Mapping validation", () => {
    expect(parseHolisticTeacherRemoval({
      school_code: "SCH001",
      program_id: 1,
      academic_year: currentYear,
      confirmed: false,
      mappings: [{ student_id: 41, expected_mapping_id: 73 }],
    })).toEqual({ ok: false, error: "Invalid Mapping removal" });

    expect(parseHolisticTeacherRemoval({
      school_code: "SCH001",
      program_id: 1,
      academic_year: currentYear,
      confirmed: true,
      mappings: [{ student_id: 41, expected_mapping_id: null }],
    })).toEqual({ ok: false, error: "Invalid Mapping removal" });
  });

  it("trims Admin reasons and preserves the 500-character boundary", () => {
    const reason = "r".repeat(500);
    const result = parseHolisticAdminAssign({
      school_code: "SCH001",
      program_id: 1,
      academic_year: currentYear,
      student_id: 41,
      mentor_user_id: 27,
      expected_mapping_id: null,
      confirmed: true,
      reason: `  ${reason}  `,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        schoolCode: "SCH001",
        programId: 1,
        academicYear: currentYear,
        reason,
        studentId: 41,
        mentorUserId: 27,
        expectedMappingId: null,
      },
    });

    expect(parseHolisticAdminRemove({
      school_code: "SCH001",
      program_id: 1,
      academic_year: currentYear,
      student_id: 41,
      expected_mapping_id: 73,
      confirmed: true,
      reason: `${reason}x`,
    })).toEqual({
      ok: false,
      error: "Audit reason must be 500 characters or fewer",
    });
  });

  it("requires a current Mapping for Admin reassignment", () => {
    expect(parseHolisticAdminReassign({
      school_code: "SCH001",
      program_id: 78,
      academic_year: currentYear,
      student_id: 41,
      mentor_user_id: 27,
      expected_mapping_id: null,
      confirmed: true,
      reason: "Mentor handover",
    })).toEqual({ ok: false, error: "Invalid expected Mapping" });
  });
});
