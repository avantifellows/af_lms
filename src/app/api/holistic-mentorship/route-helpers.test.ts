import { describe, expect, it } from "vitest";

import { holisticJsonProgramId, holisticProgramId } from "./route-helpers";

describe("Holistic Program parsing", () => {
  it.each([undefined, null, "", "null", 0, 999])(
    "rejects missing or unsupported URL Program context (%s)",
    (value) => {
      expect(holisticProgramId(value)).toBeNull();
    },
  );

  it.each([1, 74, 78, 88, 99, "1", "74", "78", "88", "99"])(
    "accepts an explicit supported URL Program (%s)",
    (value) => {
      expect(holisticProgramId(value)).toBe(Number(value));
    },
  );

  it.each([undefined, null, "", "1", 1.5, 999])(
    "rejects non-numeric or unsupported JSON Program context (%s)",
    (value) => {
      expect(holisticJsonProgramId(value)).toBeNull();
    },
  );

  it.each([1, 74, 78, 88, 99])("accepts an explicit numeric JSON Program (%s)", (value) => {
    expect(holisticJsonProgramId(value)).toBe(value);
  });
});
