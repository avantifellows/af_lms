import { describe, expect, it } from "vitest";

import { describeSession, shortProgramName } from "./blended-learning-format";

describe("describeSession", () => {
  it.each([
    [{ mode: "call", spokeWith: "student", durationMinutes: 20 }, "Call · 20 min · Spoke with student"],
    [{ mode: "in_person", spokeWith: "parent_or_sibling", durationMinutes: 15 }, "In person · 15 min · Spoke with parent or sibling"],
    [{ mode: "call", spokeWith: "both", durationMinutes: 35 }, "Call · 35 min · Spoke with student and parent"],
  ] as const)("describes %o as the detail page's entry header", (session, expected) => {
    expect(describeSession(session)).toBe(expected);
  });
});

describe("shortProgramName", () => {
  it.each([
    ["STP Voucher Delhi", "Voucher DL"],
    ["STP Dropper Himachal Pradesh", "Dropper HP"],
    ["STP Dropper Punjab", "Dropper PB"],
    ["STP Voucher Uttarakhand", "Voucher UK"],
  ])("shortens %s to %s", (name, expected) => {
    expect(shortProgramName(name)).toBe(expected);
  });

  it.each(["STP Voucher Haryana", "Voucher Delhi", "STP Delhi", "JNV Enable Students"])(
    "keeps %s as it is",
    (name) => {
      expect(shortProgramName(name)).toBe(name);
    }
  );
});
