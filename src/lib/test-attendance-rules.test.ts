import { describe, expect, it } from "vitest";

import { examPreparingFor } from "./test-attendance-rules";

describe("examPreparingFor", () => {
  it.each([
    ["Engineering", "Engineering"],
    ["engineering", "Engineering"],
    ["  MEDICAL ", "Medical"],
    ["clat", "CLAT"],
    ["Ca", "CA"],
    ["nda", "NDA"],
  ])("matches %j without regard to case as %s", (raw, expected) => {
    expect(examPreparingFor(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [""], ["   "], ["Science"], ["JEE"], ["Engineering and NDA"]])(
    "treats %j as none",
    (raw) => {
      expect(examPreparingFor(raw)).toBeNull();
    },
  );
});
