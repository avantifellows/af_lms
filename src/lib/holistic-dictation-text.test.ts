import { describe, expect, it } from "vitest";

import { appendDictation } from "./holistic-dictation-text";

describe("appendDictation", () => {
  it("adds the dictated words after existing text with one space", () => {
    expect(appendDictation("Met parents", " met the student ")).toEqual({
      ok: true,
      value: "Met parents met the student",
    });
  });

  it("starts a blank answer with the dictated words alone", () => {
    expect(appendDictation("", "\tMet parents\n")).toEqual({ ok: true, value: "Met parents" });
  });

  it("adds no extra space after a trailing space", () => {
    expect(appendDictation("Met parents ", "met the student")).toEqual({
      ok: true,
      value: "Met parents met the student",
    });
  });

  it("adds no extra space after a trailing newline", () => {
    expect(appendDictation("Met parents\n", "met the student")).toEqual({
      ok: true,
      value: "Met parents\nmet the student",
    });
  });

  it("leaves the answer unchanged when the dictated text is only whitespace", () => {
    expect(appendDictation("Met parents", " \n ")).toEqual({ ok: true, value: "Met parents" });
  });

  it("accepts text that lands exactly on 10,000 characters", () => {
    const result = appendDictation("a".repeat(9_994), "hello");
    expect(result.ok && result.value.length).toBe(10_000);
  });

  it("refuses text that would go past 10,000 characters", () => {
    expect(appendDictation("a".repeat(9_995), "hello")).toEqual({ ok: false, reason: "too_long" });
  });
});
