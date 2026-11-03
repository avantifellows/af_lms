import { describe, expect, it } from "vitest";

import {
  coverageReturnFor,
  coverageReturnQuery,
  DEFAULT_COVERAGE_FILTERS,
  readCoverageFilters,
  splitCoverageReturn,
  writeCoverageFilters,
} from "./holistic-coverage-filters";
import { holisticStudentPhaseHref } from "./holistic-links";

describe("holistic coverage filters", () => {
  it("reads valid filters and falls back to defaults for missing or invalid ones", () => {
    expect(readCoverageFilters(new URLSearchParams(
      "hm_search=Asha&hm_grade=11&hm_mentor=42&hm_progress=none&hm_assignment=unassigned",
    ))).toEqual({ search: "Asha", grade: "11", mentor: "42", progress: "none", assignment: "unassigned" });
    expect(readCoverageFilters(new URLSearchParams(""))).toEqual(DEFAULT_COVERAGE_FILTERS);
    expect(readCoverageFilters(new URLSearchParams(
      "hm_grade=10&hm_mentor=0&hm_progress=Pending&hm_assignment=all&grade=11&q=x",
    ))).toEqual(DEFAULT_COVERAGE_FILTERS);
    expect(readCoverageFilters(new URLSearchParams({ hm_search: "x".repeat(150), hm_mentor: "1.5" })))
      .toEqual({ ...DEFAULT_COVERAGE_FILTERS, search: "x".repeat(100) });
  });

  it("writes only non-default filters and leaves other params alone", () => {
    const params = new URLSearchParams("tab=holistic_mentorship&hm_grade=12&grade=9");
    writeCoverageFilters(params, { ...DEFAULT_COVERAGE_FILTERS, mentor: "7", progress: "completed" });
    expect(params.toString()).toBe("tab=holistic_mentorship&grade=9&hm_mentor=7&hm_progress=completed");
    const searched = new URLSearchParams("hm_search=old");
    writeCoverageFilters(searched, { ...DEFAULT_COVERAGE_FILTERS, search: "  	 " });
    expect(searched.toString()).toBe("");
    writeCoverageFilters(searched, { ...DEFAULT_COVERAGE_FILTERS, search: " Ravi  Shah" });
    expect(searched.get("hm_search")).toBe(" Ravi  Shah");
  });

  it("builds and splits a sanitized coverage return query", () => {
    expect(coverageReturnFor({ ...DEFAULT_COVERAGE_FILTERS, search: "Ravi" }, 30))
      .toBe("centre_id=30&hm_search=Ravi");
    expect(coverageReturnFor(DEFAULT_COVERAGE_FILTERS)).toBe("");
    expect(coverageReturnFor(DEFAULT_COVERAGE_FILTERS, Number.NaN)).toBe("");
    expect(coverageReturnQuery(new URLSearchParams("centre_id=-1&hm_grade=12&school_code=X")))
      .toBe("hm_grade=12");
    expect(splitCoverageReturn("centre_id=30&hm_grade=12&junk=1"))
      .toEqual({ centreId: "30", filterQuery: "hm_grade=12" });
    expect(splitCoverageReturn()).toEqual({ centreId: null, filterQuery: "" });
  });

  it("adds the sanitized return query to Student/Phase links", () => {
    expect(holisticStudentPhaseHref({
      studentId: 41,
      phaseId: 73,
      schoolCode: "SCH001",
      academicYear: "2026-2027",
      programId: 1,
      source: "school",
      returnQuery: "centre_id=30&hm_mentor=9&school_code=EVIL&source=progress",
    })).toBe(
      "/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027&program_id=1" +
        "&source=school&centre_id=30&hm_mentor=9",
    );
  });
});
