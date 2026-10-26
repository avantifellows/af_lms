import { describe, expect, it } from "vitest";

import { describeSession } from "./blended-learning-format";

describe("describeSession", () => {
  it.each([
    [{ mode: "call", spokeWith: "student", durationMinutes: 20 }, "Call · 20 min · Spoke with student"],
    [{ mode: "in_person", spokeWith: "parent_or_sibling", durationMinutes: 15 }, "In person · 15 min · Spoke with parent or sibling"],
    [{ mode: "call", spokeWith: "both", durationMinutes: 35 }, "Call · 35 min · Spoke with student and parent"],
  ] as const)("describes %o as the detail page's entry header", (session, expected) => {
    expect(describeSession(session)).toBe(expected);
  });
});
