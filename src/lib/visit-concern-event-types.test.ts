import { describe, expect, it } from "vitest";

import { isVisitConcernAction, validateConcernEventBody } from "./visit-concern-event-types";

describe("validateConcernEventBody", () => {
  it("trims the note", () => {
    expect(validateConcernEventBody("  Lab kits delivered \n")).toEqual({ ok: true, body: "Lab kits delivered" });
  });

  it("accepts a 2000-character note after trimming", () => {
    const body = "a".repeat(2000);
    expect(validateConcernEventBody(`  ${body}  `)).toEqual({ ok: true, body });
  });

  it.each([
    ["an empty note", "", "Please write a note"],
    ["a whitespace-only note", " \n\t ", "Please write a note"],
    ["a 2001-character note", "a".repeat(2001), "Note must be at most 2000 characters"],
    ["a non-string", 42, "body must be a string"],
  ])("refuses %s", (_label, raw, error) => {
    expect(validateConcernEventBody(raw)).toEqual({ ok: false, error });
  });
});

describe("isVisitConcernAction", () => {
  it("accepts resolve, comment and reopen only", () => {
    expect(["resolve", "comment", "reopen", "dismiss", "", null, 1].map(isVisitConcernAction)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});
