import { describe, it, expect } from "vitest";
import { buildCentreSwitcherOptions, type CentreSwitcherEntry } from "./centre-switcher";

// A same-looking group: one Centre name, Program and School, told apart only
// by id and type/category labels.
const twin = (
  id: string,
  typeLabel: string | null,
  categoryLabel: string | null,
): CentreSwitcherEntry => ({
  id,
  name: "JNV Adilabad",
  programName: "JNV CoE",
  schoolName: "JNV Adilabad",
  schoolCode: "36001",
  typeLabel,
  categoryLabel,
});

const CURRENT: CentreSwitcherEntry = {
  id: "8",
  name: "JNV Bhavnagar CoE",
  programName: "JNV CoE",
  schoolName: "JNV Bhavnagar",
  schoolCode: "70705",
};

function disambiguatorsById(entries: CentreSwitcherEntry[]) {
  return Object.fromEntries(
    buildCentreSwitcherOptions(entries, CURRENT).map((option) => [option.id, option.disambiguator]),
  );
}

describe("Centre switcher disambiguation ladder", () => {
  it("shows labels where they suffice and the Centre ID only where entries still collide", () => {
    expect(
      disambiguatorsById([
        twin("30", "Residential", "Boys"),
        twin("31", "Residential", "Girls"),
        twin("32", "Residential", "Girls"),
      ]),
    ).toEqual({
      "8": undefined,
      "30": "Residential · Boys",
      "31": "Centre ID: 31",
      "32": "Centre ID: 32",
    });
  });

  it("falls back to the Centre ID for an entry with no labels", () => {
    expect(
      disambiguatorsById([twin("30", "Residential", null), twin("31", null, null)]),
    ).toEqual({ "8": undefined, "30": "Residential", "31": "Centre ID: 31" });
  });

  it("uses whichever single label is present", () => {
    expect(
      disambiguatorsById([twin("30", null, "Boys"), twin("31", null, "Girls")]),
    ).toEqual({ "8": undefined, "30": "Boys", "31": "Girls" });
  });

  it("treats a different School code as a different entry", () => {
    expect(
      disambiguatorsById([twin("30", null, null), { ...twin("31", null, null), schoolCode: "36002" }]),
    ).toEqual({ "8": undefined, "30": undefined, "31": undefined });
  });
});
