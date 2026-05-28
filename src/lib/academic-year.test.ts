import { describe, expect, it, vi } from "vitest";

import {
  getAcademicYearChoices,
  getCurrentAcademicYear,
  validateAcademicYear,
} from "./academic-year";

describe("getCurrentAcademicYear", () => {
  it("uses IST when applying the April academic-year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T18:30:00Z"));

    try {
      expect(getCurrentAcademicYear()).toBe("2026-2027");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the previous range for January through March in IST", () => {
    expect(getCurrentAcademicYear(new Date("2026-01-15T06:00:00Z"))).toBe("2025-2026");
    expect(getCurrentAcademicYear(new Date("2026-03-15T06:00:00Z"))).toBe("2025-2026");
  });

  it("returns the current range for April through December in IST", () => {
    expect(getCurrentAcademicYear(new Date("2026-04-01T06:00:00Z"))).toBe("2026-2027");
    expect(getCurrentAcademicYear(new Date("2026-12-15T06:00:00Z"))).toBe("2026-2027");
  });
});

describe("validateAcademicYear", () => {
  it("accepts a consecutive YYYY-YYYY academic year", () => {
    expect(validateAcademicYear("2026-2027")).toBe(true);
  });

  it("rejects malformed and non-consecutive academic years", () => {
    expect(validateAcademicYear("2026-2028")).toBe(false);
    expect(validateAcademicYear("abcd-efgh")).toBe(false);
    expect(validateAcademicYear("2026")).toBe(false);
    expect(validateAcademicYear("")).toBe(false);
  });
});

describe("getAcademicYearChoices", () => {
  it("returns the current academic year followed by two prior years", () => {
    expect(getAcademicYearChoices("2026-2027")).toEqual([
      "2026-2027",
      "2025-2026",
      "2024-2025",
    ]);
  });
});
