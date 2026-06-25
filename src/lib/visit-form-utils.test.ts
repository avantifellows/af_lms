import { describe, it, expect } from "vitest";
import {
  ACTION_ADDITIONAL_NOTES_KEY,
  appendActionAdditionalNotes,
  isPlainObject,
  readActionAdditionalNotes,
  validateActionAdditionalNotes,
} from "./visit-form-utils";

describe("isPlainObject", () => {
  it("returns true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isPlainObject("string")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe("action additional notes helpers", () => {
  it("reads and appends action-level notes", () => {
    const target: Record<string, unknown> = {};

    expect(readActionAdditionalNotes(null)).toBe("");
    expect(readActionAdditionalNotes({ [ACTION_ADDITIONAL_NOTES_KEY]: 123 })).toBe("");
    expect(readActionAdditionalNotes({ [ACTION_ADDITIONAL_NOTES_KEY]: "Follow up" })).toBe(
      "Follow up"
    );

    appendActionAdditionalNotes(target, { [ACTION_ADDITIONAL_NOTES_KEY]: "Follow up" });
    expect(target).toEqual({ [ACTION_ADDITIONAL_NOTES_KEY]: "Follow up" });
  });

  it("allows missing or string notes and rejects non-string notes", () => {
    expect(validateActionAdditionalNotes({})).toEqual([]);
    expect(validateActionAdditionalNotes({ [ACTION_ADDITIONAL_NOTES_KEY]: "" })).toEqual([]);
    expect(validateActionAdditionalNotes({ [ACTION_ADDITIONAL_NOTES_KEY]: 42 })).toEqual([
      "additional_notes must be a string",
    ]);
  });
});
