import { describe, expect, it } from "vitest";

import {
  compareTalkToFirst,
  latestEntryKind,
  talkedToInLastWeek,
  talkToFirst,
} from "./blended-learning-talk-to-first";

// Expected values are hand-counted IST calendar days from the PRD rules
// (days_since = today_IST − date), never recomputed the way the code does it.
describe("talkToFirst", () => {
  it("leaves a Mentee talked to 10 days ago, whose latest entry is that Conversation, out of Talk to First", () => {
    expect(
      talkToFirst({
        latestEntryKind: "conversation",
        lastConversationOn: "2026-10-12",
        legacyMonth: null,
        today: "2026-10-22",
      })
    ).toEqual({ inTalkToFirst: false, reasons: [], daysSince: 10 });
  });

  it.each([
    // 2026-09-22 → 2026-10-22 is 30 days (September has 30).
    ["2026-09-22", { inTalkToFirst: true, reasons: ["gap_30"], daysSince: 30 }],
    ["2026-09-23", { inTalkToFirst: false, reasons: [], daysSince: 29 }],
  ])("puts a Mentee last talked to on %s in Talk to First only at 30+ days (today 2026-10-22)", (on, expected) => {
    expect(
      talkToFirst({
        latestEntryKind: "conversation",
        lastConversationOn: on,
        legacyMonth: null,
        today: "2026-10-22",
      })
    ).toEqual(expected);
  });

  it.each([
    [
      "latest entry an Attempt after a Conversation 10 days ago",
      { latestEntryKind: "attempt", lastConversationOn: "2026-10-12" },
      { inTalkToFirst: true, reasons: ["attempt"], daysSince: 10 },
    ],
    [
      "nothing logged and no legacy month",
      { latestEntryKind: null, lastConversationOn: null },
      { inTalkToFirst: true, reasons: ["no_contact"], daysSince: null },
    ],
    [
      "only an Attempt and no legacy month",
      { latestEntryKind: "attempt", lastConversationOn: null },
      { inTalkToFirst: true, reasons: ["attempt", "no_contact"], daysSince: null },
    ],
    [
      "latest entry an Attempt after a Conversation 45 days ago",
      { latestEntryKind: "attempt", lastConversationOn: "2026-09-07" },
      { inTalkToFirst: true, reasons: ["attempt", "gap_30"], daysSince: 45 },
    ],
  ] as const)("gives the right Why now reasons for %s", (_label, entries, expected) => {
    expect(talkToFirst({ ...entries, legacyMonth: null, today: "2026-10-22" })).toEqual(expected);
  });

  it.each([
    // August 2026 counts as 31 Aug: 30 days to 30 Sep, then 22 more.
    ["2026-08-01", "2026-10-22", { inTalkToFirst: true, reasons: ["gap_30"], daysSince: 52 }],
    // September 2026 counts as 30 Sep: 22 days, and no "no_contact".
    ["2026-09-01", "2026-10-22", { inTalkToFirst: false, reasons: [], daysSince: 22 }],
    // 30 Sep → 30 Oct is exactly 30 days.
    ["2026-09-01", "2026-10-30", { inTalkToFirst: true, reasons: ["gap_30"], daysSince: 30 }],
    // February 2027 counts as 28 Feb: 31 days to 31 Mar.
    ["2027-02-01", "2027-03-31", { inTalkToFirst: true, reasons: ["gap_30"], daysSince: 31 }],
  ] as const)("treats legacy month %s as its last day (today %s)", (legacyMonth, today, expected) => {
    expect(
      talkToFirst({ latestEntryKind: null, lastConversationOn: null, legacyMonth, today })
    ).toEqual(expected);
  });

  it("ignores a legacy month once a real Conversation exists, even an older one", () => {
    // 10 May → 22 Oct 2026: 31 + 30 + 31 + 31 + 30 + 12 = 165 days.
    expect(
      talkToFirst({
        latestEntryKind: "conversation",
        lastConversationOn: "2026-05-10",
        legacyMonth: "2026-09-01",
        today: "2026-10-22",
      })
    ).toEqual({ inTalkToFirst: true, reasons: ["gap_30"], daysSince: 165 });
  });

  it("uses the real Conversation, not an older legacy month", () => {
    expect(
      talkToFirst({
        latestEntryKind: "conversation",
        lastConversationOn: "2026-10-20",
        legacyMonth: "2026-06-01",
        today: "2026-10-22",
      })
    ).toEqual({ inTalkToFirst: false, reasons: [], daysSince: 2 });
  });

  it("keeps the Attempt reason for a legacy-seeded Mentee whose latest entry is an Attempt", () => {
    expect(
      talkToFirst({
        latestEntryKind: "attempt",
        lastConversationOn: null,
        legacyMonth: "2026-09-01",
        today: "2026-10-22",
      })
    ).toEqual({ inTalkToFirst: true, reasons: ["attempt"], daysSince: 22 });
  });

  it("counts calendar days across a month end", () => {
    expect(
      talkToFirst({
        latestEntryKind: "conversation",
        lastConversationOn: "2026-09-30",
        legacyMonth: null,
        today: "2026-10-01",
      }).daysSince
    ).toBe(1);
  });
});

describe("latestEntryKind", () => {
  it.each([
    [
      "an Attempt logged after a Conversation on the same day",
      { occurredOn: "2026-10-20", id: 11 },
      { occurredOn: "2026-10-20", id: 12 },
      "attempt",
    ],
    [
      "a Conversation logged after an Attempt on the same day",
      { occurredOn: "2026-10-20", id: 13 },
      { occurredOn: "2026-10-20", id: 12 },
      "conversation",
    ],
    [
      "a later-dated Conversation with a lower id than the Attempt",
      { occurredOn: "2026-10-21", id: 5 },
      { occurredOn: "2026-10-20", id: 40 },
      "conversation",
    ],
    ["only an Attempt", null, { occurredOn: "2026-10-20", id: 3 }, "attempt"],
    ["only a Conversation", { occurredOn: "2026-10-20", id: 3 }, null, "conversation"],
    ["nothing logged", null, null, null],
  ] as const)("is the highest (occurred_on, id) entry: %s", (_label, conversation, attempt, expected) => {
    expect(latestEntryKind(conversation, attempt)).toBe(expected);
  });
});

describe("talkedToInLastWeek", () => {
  it.each([
    // 2026-10-16 → 2026-10-22 is 6 days; 2026-10-15 is 7.
    ["2026-10-16", true],
    ["2026-10-15", false],
    ["2026-10-22", true],
  ])("is days_since < 7: last talked to %s, today 2026-10-22 → %s", (on, expected) => {
    const { daysSince } = talkToFirst({
      latestEntryKind: "conversation",
      lastConversationOn: on,
      legacyMonth: null,
      today: "2026-10-22",
    });
    expect(talkedToInLastWeek(daysSince)).toBe(expected);
  });

  it("is false without a Last Contact", () => {
    expect(talkedToInLastWeek(null)).toBe(false);
  });
});

describe("compareTalkToFirst", () => {
  it("orders Attempt-latest first, then more reasons, then the larger gap (none is largest), then name A–Z", () => {
    const mentees = [
      { name: "Bina", latestEntryKind: "conversation", reasons: ["gap_30"], daysSince: 30 },
      { name: "Esha", latestEntryKind: "attempt", reasons: ["attempt"], daysSince: 5 },
      { name: "Anil", latestEntryKind: "conversation", reasons: ["gap_30"], daysSince: 30 },
      { name: "Dev", latestEntryKind: "attempt", reasons: ["attempt", "gap_30"], daysSince: 40 },
      { name: "Hari", latestEntryKind: "conversation", reasons: ["gap_30"], daysSince: 90 },
      { name: "Gita", latestEntryKind: null, reasons: ["no_contact"], daysSince: null },
      { name: "Farhan", latestEntryKind: "attempt", reasons: ["attempt", "no_contact"], daysSince: null },
    ] as const;

    expect([...mentees].sort(compareTalkToFirst).map((mentee) => mentee.name)).toEqual([
      "Farhan",
      "Dev",
      "Esha",
      "Gita",
      "Hari",
      "Anil",
      "Bina",
    ]);
  });

  it("orders Mentees outside Talk to First by the larger gap, then name A–Z", () => {
    const mentees = [
      { name: "rohan", latestEntryKind: "conversation", reasons: [], daysSince: 3 },
      { name: "Zoya", latestEntryKind: "conversation", reasons: [], daysSince: 29 },
      { name: "Aditi", latestEntryKind: "conversation", reasons: [], daysSince: 3 },
    ] as const;

    expect([...mentees].sort(compareTalkToFirst).map((mentee) => mentee.name)).toEqual([
      "Zoya",
      "Aditi",
      "rohan",
    ]);
  });
});
