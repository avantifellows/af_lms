import { describe, expect, it } from "vitest";

import {
  parseLegacyConversationEntry,
  parseLegacyConversations,
  storedLegacyActionItems,
  withDoneCarriedOver,
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
        { text: "Synthetic: revise optics", owner: "student", done_at: null, done_by_email: null },
        { text: "Synthetic: call back", owner: "parent", done_at: null, done_by_email: null },
      ],
    });
  });

  it("accepts an item's done state, trimmed", () => {
    const entry = parseLegacyConversationEntry({
      ...VALID,
      actionItems: [{ text: "x", owner: "mentor", done_at: "2026-10-20T10:00:00+05:30", done_by_email: " m@test.local " }],
    });
    expect(entry).toMatchObject({
      actionItems: [{ text: "x", owner: "mentor", done_at: "2026-10-20T10:00:00+05:30", done_by_email: "m@test.local" }],
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
    ["a done_at that is not a timestamp", { ...VALID, actionItems: [{ text: "x", owner: "mentor", done_at: "2026-10-20" }] }, "bad_action_item"],
    ["an impossible done_at", { ...VALID, actionItems: [{ text: "x", owner: "mentor", done_at: "2026-13-40T00:00:00Z" }] }, "bad_action_item"],
    ["a blank done_by_email", { ...VALID, actionItems: [{ text: "x", owner: "mentor", done_at: "2026-10-20T00:00:00Z", done_by_email: " " }] }, "bad_action_item"],
    ["a done_by_email without done_at", { ...VALID, actionItems: [{ text: "x", owner: "mentor", done_by_email: "m@test.local" }] }, "bad_action_item"],
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
  it("keeps only valid stored items, each with its index in the stored array", () => {
    expect(
      storedLegacyActionItems([
        { text: "", owner: "x" },
        { text: "Synthetic: a", owner: "mentor", done_at: "2026-10-20T10:00:00+05:30", done_by_email: "m@test.local" },
        3,
      ])
    ).toEqual([
      { index: 1, text: "Synthetic: a", owner: "mentor", done_at: "2026-10-20T10:00:00+05:30", done_by_email: "m@test.local" },
    ]);
    expect(storedLegacyActionItems(null)).toEqual([]);
  });
});

describe("withDoneCarriedOver", () => {
  const open = (text: string, owner: "student" | "mentor" = "student") => ({ text, owner, done_at: null, done_by_email: null });
  const DONE = { done_at: "2026-10-20T10:00:00+05:30", done_by_email: "m@test.local" };

  it("keeps a stored done item's state for the same text and owner, each stored item once", () => {
    const stored = [
      { ...open("Synthetic: a"), ...DONE },
      { ...open("Synthetic: b"), ...DONE },
      open("Synthetic: c"),
    ];
    expect(
      withDoneCarriedOver([open("Synthetic: a"), open("Synthetic: a"), open("Synthetic: b", "mentor"), open("Synthetic: c")], stored)
    ).toEqual([
      { ...open("Synthetic: a"), ...DONE },
      // Only one stored "a" was done.
      open("Synthetic: a"),
      // A different owner is a different item.
      open("Synthetic: b", "mentor"),
      open("Synthetic: c"),
    ]);
  });

  it("changes nothing without stored items", () => {
    expect(withDoneCarriedOver([open("Synthetic: a")], null)).toEqual([open("Synthetic: a")]);
  });
});
