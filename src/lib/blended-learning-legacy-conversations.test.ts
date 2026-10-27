import { describe, expect, it } from "vitest";

import {
  parseLegacyConversationEntry,
  parseLegacyConversations,
  storedLegacyActionItems,
} from "./blended-learning-legacy-conversations";

// Synthetic summaries only.
const VALID = {
  occurredOn: "2026-09-17",
  summary: " Synthetic: planned the mocks. ",
  actionItems: [
    { text: " Synthetic: revise optics ", owner: "student" },
    { text: "Synthetic: call back", owner: "parent" },
  ],
};

describe("parseLegacyConversationEntry", () => {
  it("trims the summary and items", () => {
    expect(parseLegacyConversationEntry(VALID)).toEqual({
      occurredOn: "2026-09-17",
      summary: "Synthetic: planned the mocks.",
      actionItems: [
        { text: "Synthetic: revise optics", owner: "student" },
        { text: "Synthetic: call back", owner: "parent" },
      ],
    });
  });

  it("stores an empty action item list as none", () => {
    expect(parseLegacyConversationEntry({ ...VALID, actionItems: [] })).toMatchObject({ actionItems: null });
  });

  it.each([
    ["not an object", "text", "not_an_object"],
    ["a list", [], "not_an_object"],
    ["an impossible date", { ...VALID, occurredOn: "2026-02-30" }, "bad_occurred_on"],
    ["a blank summary", { ...VALID, summary: "   " }, "blank_summary"],
    ["a missing summary", { ...VALID, summary: undefined }, "blank_summary"],
    ["a too-long summary", { ...VALID, summary: "a".repeat(2001) }, "summary_too_long"],
    ["missing items", { ...VALID, actionItems: undefined }, "action_items_not_a_list"],
    ["eleven items", { ...VALID, actionItems: Array(11).fill(VALID.actionItems[0]) }, "too_many_action_items"],
    ["an unknown owner", { ...VALID, actionItems: [{ text: "x", owner: "teacher" }] }, "bad_action_item"],
    ["a blank item", { ...VALID, actionItems: [{ text: " ", owner: "mentor" }] }, "bad_action_item"],
    ["a too-long item", { ...VALID, actionItems: [{ text: "a".repeat(501), owner: "mentor" }] }, "bad_action_item"],
    ["an item that is not an object", { ...VALID, actionItems: ["x"] }, "bad_action_item"],
  ])("refuses %s", (_label, value, reason) => {
    expect(parseLegacyConversationEntry(value)).toEqual({ invalid: reason });
  });

  it("accepts the limits exactly", () => {
    const entry = parseLegacyConversationEntry({
      ...VALID,
      summary: "a".repeat(2000),
      actionItems: Array(10).fill({ text: "b".repeat(500), owner: "mentor" }),
    });
    expect(entry).toMatchObject({ summary: "a".repeat(2000) });
  });
});

describe("parseLegacyConversations", () => {
  it("splits valid and invalid entries by doc id", () => {
    const parsed = parseLegacyConversations({ "doc-a": VALID, "doc-b": { ...VALID, summary: "" } });
    expect([...parsed.entries.keys()]).toEqual(["doc-a"]);
    expect([...parsed.invalid]).toEqual([["doc-b", "blank_summary"]]);
  });

  it("refuses a file that is not an object keyed by doc id", () => {
    expect(() => parseLegacyConversations([VALID])).toThrow("must be a JSON object keyed by Drive file id");
    expect(() => parseLegacyConversations(null)).toThrow();
  });
});

describe("storedLegacyActionItems", () => {
  it("keeps only valid stored items", () => {
    expect(storedLegacyActionItems([{ text: "Synthetic: a", owner: "mentor" }, { text: "", owner: "x" }, 3])).toEqual([
      { text: "Synthetic: a", owner: "mentor" },
    ]);
    expect(storedLegacyActionItems(null)).toEqual([]);
  });
});
