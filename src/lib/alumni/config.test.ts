import { describe, expect, it } from "vitest";
import { academicYearEnd, currentAcademicYear } from "./config";

describe("currentAcademicYear", () => {
  it("starts the year on 1 April in India, whatever the server's clock", () => {
    // 31 March 18:29 UTC = 23:59 IST: still the old year.
    expect(currentAcademicYear(new Date("2027-03-31T18:29:00Z"))).toBe("2026-2027");
    // 31 March 18:30 UTC = 1 April 00:00 IST: the new year.
    expect(currentAcademicYear(new Date("2027-03-31T18:30:00Z"))).toBe("2027-2028");
  });

  it("is the same all year round", () => {
    expect(currentAcademicYear(new Date("2026-10-21T12:00:00Z"))).toBe("2026-2027");
    expect(currentAcademicYear(new Date("2027-01-15T12:00:00Z"))).toBe("2026-2027");
  });
});

describe("academicYearEnd", () => {
  it("takes the second year", () => {
    expect(academicYearEnd("2025-2026")).toBe("2026");
    expect(academicYearEnd("")).toBe("");
  });
});
