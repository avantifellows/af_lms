import { describe, expect, it } from "vitest";

import {
  isDurationMinutes,
  requiredDateError,
  requiredSessionErrors,
  validateSessionDetails,
} from "./blended-learning-session-details";

const TODAY = "2026-10-22";

describe("isDurationMinutes", () => {
  it.each([1, 45, 240])("accepts %s minutes", (value) => {
    expect(isDurationMinutes(value)).toBe(true);
  });

  it.each([0, 241, 12.5, "30", null])("rejects %s", (value) => {
    expect(isDurationMinutes(value)).toBe(false);
  });
});

describe("requiredDateError", () => {
  it("accepts today and earlier", () => {
    expect(requiredDateError(TODAY, TODAY)).toBeNull();
    expect(requiredDateError("2026-10-01", TODAY)).toBeNull();
  });

  it("asks for a date when there is none or it isn't a calendar date", () => {
    expect(requiredDateError(undefined, TODAY)).toBe("Enter the date.");
    expect(requiredDateError("2026-02-31", TODAY)).toBe("Enter the date.");
  });

  it("refuses a future date", () => {
    expect(requiredDateError("2026-10-23", TODAY)).toBe("The date can't be in the future.");
  });
});

describe("requiredSessionErrors", () => {
  it("has no errors for complete, valid details", () => {
    expect(
      requiredSessionErrors(
        { occurredOn: TODAY, mode: "call", spokeWith: "both", durationMinutes: 30 },
        TODAY
      )
    ).toEqual({});
  });

  it("requires every field, in field order", () => {
    const errors = requiredSessionErrors({}, TODAY);
    expect(Object.keys(errors)).toEqual(["occurredOn", "mode", "spokeWith", "durationMinutes"]);
    expect(errors).toEqual({
      occurredOn: "Enter the date.",
      mode: "Choose call or in person.",
      spokeWith: "Choose who you spoke with.",
      durationMinutes: "Duration must be between 1 and 240 minutes.",
    });
  });

  it("treats empty strings as missing", () => {
    expect(requiredSessionErrors({ occurredOn: TODAY, mode: "", spokeWith: "student", durationMinutes: 5 }, TODAY)).toEqual({
      mode: "Choose call or in person.",
    });
  });
});

describe("validateSessionDetails", () => {
  it("leaves every absent detail as null", () => {
    expect(validateSessionDetails({ occurredOn: "", mode: null }, TODAY)).toEqual({
      ok: true,
      details: { occurredOn: null, mode: null, spokeWith: null, durationMinutes: null },
    });
  });

  it("keeps the details the Mentor entered", () => {
    expect(
      validateSessionDetails(
        { occurredOn: "2026-10-20", mode: "in_person", spokeWith: "parent_or_sibling", durationMinutes: 240 },
        TODAY
      )
    ).toEqual({
      ok: true,
      details: { occurredOn: "2026-10-20", mode: "in_person", spokeWith: "parent_or_sibling", durationMinutes: 240 },
    });
  });

  it("reports each entered detail that is invalid", () => {
    expect(
      validateSessionDetails({ occurredOn: "20-10-2026", mode: "video", spokeWith: "teacher", durationMinutes: 0 }, TODAY)
    ).toEqual({
      ok: false,
      fieldErrors: {
        occurredOn: "Enter a valid date.",
        mode: "Choose call or in person.",
        spokeWith: "Choose who you spoke with.",
        durationMinutes: "Duration must be between 1 and 240 minutes.",
      },
    });
  });

  it("refuses a future date", () => {
    expect(validateSessionDetails({ occurredOn: "2026-11-01" }, TODAY)).toEqual({
      ok: false,
      fieldErrors: { occurredOn: "The date can't be in the future." },
    });
  });
});
