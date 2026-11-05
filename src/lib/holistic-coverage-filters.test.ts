import { describe, expect, it } from "vitest";

import {
  coveragePageKey,
  coverageReturnFor,
  coverageReturnQuery,
  DEFAULT_COVERAGE_FILTERS,
  hasActiveCoverageFilters,
  readCoverageFilters,
  splitCoverageReturn,
  writeCoverageFilters,
} from "./holistic-coverage-filters";
import { holisticStudentPhaseHref } from "./holistic-links";

describe("holistic coverage filters", () => {
  it("reads valid filters and falls back to defaults for missing or invalid ones", () => {
    expect(readCoverageFilters(new URLSearchParams(
      "hm_search=Asha&hm_grade=11&hm_mentor=42&hm_progress=no_active_phase&hm_assignment=unassigned",
    ))).toEqual({ search: "Asha", grade: "11", mentor: "42", progress: "no_active_phase" });
    for (const progress of ["assigned", "pending", "completed", "no_active_phase", "unassigned"] as const) {
      expect(readCoverageFilters(new URLSearchParams({ hm_progress: progress })).progress).toBe(progress);
    }
    expect(readCoverageFilters(new URLSearchParams(""))).toEqual(DEFAULT_COVERAGE_FILTERS);
    // "none" was this view's old No active phase value; "skipped" is S&P-only.
    for (const progress of ["Pending", "none", "skipped", "all"]) {
      expect(readCoverageFilters(new URLSearchParams({ hm_progress: progress }))).toEqual(DEFAULT_COVERAGE_FILTERS);
    }
    expect(readCoverageFilters(new URLSearchParams(
      "hm_grade=10&hm_mentor=0&hm_assignment=assigned&grade=11&q=x",
    ))).toEqual(DEFAULT_COVERAGE_FILTERS);
    expect(readCoverageFilters(new URLSearchParams({ hm_search: "x".repeat(150), hm_mentor: "1.5" })))
      .toEqual({ ...DEFAULT_COVERAGE_FILTERS, search: "x".repeat(100) });
  });

  it("writes only non-default filters and leaves other params alone", () => {
    const params = new URLSearchParams("tab=holistic_mentorship&hm_grade=12&grade=9");
    writeCoverageFilters(params, { ...DEFAULT_COVERAGE_FILTERS, mentor: "7", progress: "completed" });
    expect(params.toString()).toBe("tab=holistic_mentorship&grade=9&hm_mentor=7&hm_progress=completed");
    const retired = new URLSearchParams("tab=holistic_mentorship&hm_assignment=assigned&hm_other=1");
    writeCoverageFilters(retired, { ...DEFAULT_COVERAGE_FILTERS, progress: "assigned" });
    expect(retired.toString()).toBe("tab=holistic_mentorship&hm_progress=assigned");
    const searched = new URLSearchParams("hm_search=old");
    writeCoverageFilters(searched, { ...DEFAULT_COVERAGE_FILTERS, search: "  	 " });
    expect(searched.toString()).toBe("");
    writeCoverageFilters(searched, { ...DEFAULT_COVERAGE_FILTERS, search: " Ravi  Shah" });
    expect(searched.get("hm_search")).toBe(" Ravi  Shah");
  });

  it("treats any non-default filter, but not a blank search, as active", () => {
    expect(hasActiveCoverageFilters(DEFAULT_COVERAGE_FILTERS)).toBe(false);
    expect(hasActiveCoverageFilters({ ...DEFAULT_COVERAGE_FILTERS, search: "   " })).toBe(false);
    expect(hasActiveCoverageFilters({ ...DEFAULT_COVERAGE_FILTERS, search: "a" })).toBe(true);
    expect(hasActiveCoverageFilters({ ...DEFAULT_COVERAGE_FILTERS, mentor: "9" })).toBe(true);
    expect(hasActiveCoverageFilters({ ...DEFAULT_COVERAGE_FILTERS, progress: "no_active_phase" })).toBe(true);
    expect(hasActiveCoverageFilters({ ...DEFAULT_COVERAGE_FILTERS, progress: "assigned" })).toBe(true);
  });

  it("keys a page by path and non-filter params, ignoring the School tab", () => {
    const key = (url: string) => {
      const parsed = new URL(url, "http://lms.test");
      return coveragePageKey(parsed.pathname, parsed.searchParams);
    };
    expect(key("/school/S1?program_id=1&tab=holistic_mentorship&hm_search=a&hm_assignment=all"))
      .toBe(key("/school/S1?tab=enrollment&program_id=1"));
    expect(key("/school/S1?program_id=1")).not.toBe(key("/school/S1?program_id=78"));
    expect(key("/school/S1?program_id=1")).not.toBe(key("/school/S1"));
    expect(key("/centre/8?tab=holistic_mentorship")).not.toBe(key("/centre/9?tab=holistic_mentorship"));
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
