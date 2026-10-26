import { describe, it, expect } from "vitest";
import { matchesStudentSearch } from "./stream-rules";

describe("matchesStudentSearch phone", () => {
  const student = { first_name: "Asha", last_name: "Rao", phone: "9876543210" };

  it("matches a phone typed with spaces or a country code", () => {
    for (const query of ["9876543210", "98765 43210", "+91 9876543210", "43210"]) {
      expect(matchesStudentSearch(student, query)).toBe(true);
    }
  });

  it("does not match short or different numbers", () => {
    expect(matchesStudentSearch(student, "12")).toBe(false);
    expect(matchesStudentSearch(student, "91234 56789")).toBe(false);
  });

  it("still matches names", () => {
    expect(matchesStudentSearch(student, "asha r")).toBe(true);
  });
});
