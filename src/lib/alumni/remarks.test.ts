import { describe, expect, it } from "vitest";
import { OTHER_REMARK, REMARK_OPTIONS, remarkNote } from "./remarks";

describe("remarkNote", () => {
  it("no option = no remark", () => {
    expect(remarkNote({ option: "", details: "anything" })).toEqual({ note: null });
  });

  it("a plain option is saved as its label; stray details are dropped", () => {
    expect(remarkNote({ option: "Wrong Phone number", details: "ignored" })).toEqual({ note: "Wrong Phone number" });
  });

  it("an editable option adds its details, tidied", () => {
    expect(remarkNote({ option: "Preparing for other exams", details: "  GATE   2027 " })).toEqual({
      note: "Preparing for other exams: GATE 2027",
    });
    expect(remarkNote({ option: "College ID not found", details: "" })).toEqual({ note: "College ID not found" });
  });

  it("Other needs its text", () => {
    expect(remarkNote({ option: OTHER_REMARK, details: " " })).toEqual({ error: "Write the remark." });
    expect(remarkNote({ option: OTHER_REMARK, details: "Moved abroad" })).toEqual({ note: "Other: Moved abroad" });
  });

  it("refuses options not in the list and over-long details", () => {
    expect(remarkNote({ option: "Made up", details: "" })).toHaveProperty("error");
    expect(remarkNote({ option: OTHER_REMARK, details: "x".repeat(501) })).toHaveProperty("error");
  });

  it("has the team's 12 options plus Other, with boxes on 4, 11 and Other", () => {
    expect(REMARK_OPTIONS).toHaveLength(13);
    expect(REMARK_OPTIONS.filter((o) => o.details).map((o) => o.label)).toEqual([
      "College ID not found", "Preparing for other exams", OTHER_REMARK,
    ]);
  });
});
