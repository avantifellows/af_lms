import { describe, expect, it } from "vitest";

import type { MenteeRow } from "@/lib/blended-learning-mentees";

import { daysAgo, shortDate, whyNowTags } from "./menteeListCopy";

const BASE: MenteeRow = {
  studentId: 1, name: "Asha Rao", gender: null, grade: 12, programId: 80, programName: null,
  lastContact: "2026-10-12", lastContactSource: "conversation", latestEntryKind: "attempt",
  openDraftState: null, reasons: [], daysSince: 10, lastAttemptOn: null,
};

describe("shortDate", () => {
  it("drops the year for this year's dates only", () => {
    expect(shortDate("2026-10-04", "2026-10-22")).toBe("4 Oct");
    expect(shortDate("2025-12-30", "2026-01-02")).toBe("30 Dec 2025");
    expect(shortDate("2026-10-04")).toBe("4 Oct 2026");
  });
});

describe("daysAgo", () => {
  it.each([
    [0, "Today"],
    [1, "Yesterday"],
    [27, "27 days ago"],
  ])("%i days → %s", (days, text) => {
    expect(daysAgo(days)).toBe(text);
  });
});

describe("whyNowTags", () => {
  it("dates the failed try, and keeps the reasons' order", () => {
    const mentee: MenteeRow = {
      ...BASE, lastContact: null, daysSince: null, reasons: ["attempt", "no_contact"], lastAttemptOn: "2026-10-04",
    };
    expect(whyNowTags(mentee, "2026-10-22")).toEqual([
      { reason: "attempt", text: "Not reachable, 4 Oct", tone: "danger" },
      { reason: "no_contact", text: "No conversation yet", tone: "warning" },
    ]);
  });

  it("falls back to undated wording when the Attempt's date is missing", () => {
    expect(whyNowTags({ ...BASE, reasons: ["attempt"] })[0].text).toBe("Not reachable on the last try");
  });

  it("counts days since a Conversation, but names a legacy month", () => {
    expect(whyNowTags({ ...BASE, reasons: ["gap_30"], daysSince: 46 })[0].text).toBe("Not contacted in 46 days");
    expect(
      whyNowTags({ ...BASE, reasons: ["gap_30"], lastContact: "2026-06-30", lastContactSource: "legacy" })[0].text
    ).toBe("Not contacted since Jun 2026");
  });
});
