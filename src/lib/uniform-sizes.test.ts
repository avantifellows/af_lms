import { describe, expect, it } from "vitest";

import {
  OFFERED_UNIFORM_SIZES,
  UNIFORM_SIZES,
  formatTrackPantSize,
  formatTshirtSize,
  isOfferedUniformSize,
  trackPantSizeOptions,
  tshirtSizeOptions,
} from "./uniform-sizes";

describe("uniform sizes", () => {
  it("offers the vendor chart and keeps XXS storable but unoffered", () => {
    expect(OFFERED_UNIFORM_SIZES).toEqual(["XS", "S", "M", "L", "XL", "XXL", "XXXL"]);
    expect(UNIFORM_SIZES).toContain("XXS");
    expect(OFFERED_UNIFORM_SIZES.every((size) => UNIFORM_SIZES.includes(size))).toBe(true);
    expect(isOfferedUniformSize("XXS")).toBe(false);
    expect(isOfferedUniformSize("M")).toBe(true);
    expect(isOfferedUniformSize("m")).toBe(false);
    expect(isOfferedUniformSize(null)).toBe(false);
  });

  it("labels every offered size with its chest or waist measurement", () => {
    expect(OFFERED_UNIFORM_SIZES.map(formatTshirtSize)).toEqual([
      'XS (Chest 34")',
      'S (Chest 36")',
      'M (Chest 38–40")',
      'L (Chest 40–42")',
      'XL (Chest 42–44")',
      'XXL (Chest 44–46")',
      'XXXL (Chest 46–48")',
    ]);
    expect(OFFERED_UNIFORM_SIZES.map(formatTrackPantSize)).toEqual([
      'XS (Waist 26")',
      'S (Waist 28")',
      'M (Waist 30–32")',
      'L (Waist 32–34")',
      'XL (Waist 34–36")',
      'XXL (Waist 36–38")',
      'XXXL (Waist 38–40")',
    ]);
  });

  it("renders an unoffered stored code as-is instead of dropping it", () => {
    expect(formatTshirtSize("XXS")).toBe("XXS");
    expect(formatTrackPantSize("XXS")).toBe("XXS");
  });

  it("builds select options that submit the bare code", () => {
    expect(tshirtSizeOptions()[2]).toEqual({ value: "M", label: 'M (Chest 38–40")' });
    expect(trackPantSizeOptions()[2]).toEqual({ value: "M", label: 'M (Waist 30–32")' });
    expect(tshirtSizeOptions().map((option) => option.value)).toEqual([
      ...OFFERED_UNIFORM_SIZES,
    ]);
  });
});
