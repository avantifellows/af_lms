import { describe, it, expect } from "vitest";
import { reconcileGrade, KEEP_GRADE, effectiveSelection } from "./usePerformanceFilters";

// The rule that decides which grade the Performance tab lands on when the
// available grades change under it — extracted from the fetch effect so it can
// be checked directly rather than through a mocked response.
describe("reconcileGrade", () => {
  it("keeps a selection that is still available", () => {
    expect(reconcileGrade([11, 12], 11)).toBe(KEEP_GRADE);
    expect(reconcileGrade([11, 12], 12)).toBe(KEEP_GRADE);
  });

  it("prefers grade 12 when nothing is selected", () => {
    expect(reconcileGrade([11, 12], null)).toBe(12);
  });

  it("picks the only grade when there is just one", () => {
    expect(reconcileGrade([11], null)).toBe(11);
  });

  // The case this logic exists for: a PM scoped to a program that only has
  // grade 11, carrying a 12 chosen against another program's grade list.
  it("replaces a selection that the narrowed program no longer offers", () => {
    expect(reconcileGrade([11], 12)).toBe(11);
  });

  it("prefers 12 over a stale selection when both are on offer", () => {
    expect(reconcileGrade([10, 12], 11)).toBe(12);
  });

  it("clears a stale selection when nothing is auto-pickable", () => {
    // Several grades, none is 12, and the current pick is gone — the user
    // must choose again rather than silently landing on someone else's grade.
    expect(reconcileGrade([9, 10, 11], 12)).toBeNull();
  });

  it("leaves the URL alone when there is nothing to pick and nothing selected", () => {
    expect(reconcileGrade([9, 10, 11], null)).toBe(KEEP_GRADE);
  });

  it("clears a selection when the school has no grades at all", () => {
    expect(reconcileGrade([], 12)).toBeNull();
    expect(reconcileGrade([], null)).toBe(KEEP_GRADE);
  });
});

// JNV NVS renders only per-test full tests with no Subject or Test grade
// filter, whatever an old shared link asked for.
describe("effectiveSelection", () => {
  const fromOldLink = {
    testCategory: "chapter" as const,
    fullTestView: "cumulative" as const,
    subject: "Physics",
    testGrade: 11,
  };

  it("forces NVS onto per-test full tests with no subject or test grade", () => {
    expect(effectiveSelection(true, fromOldLink)).toEqual({
      testCategory: "full",
      fullTestView: "per_test",
      subject: null,
      testGrade: null,
    });
  });

  it("leaves every other program's selection as it is", () => {
    expect(effectiveSelection(false, fromOldLink)).toEqual({
      testCategory: "chapter",
      fullTestView: "cumulative",
      subject: "Physics",
      testGrade: 11,
    });
  });
});
