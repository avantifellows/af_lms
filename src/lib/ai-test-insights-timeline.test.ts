import { describe, expect, it } from "vitest";

import { orderTimeline, type TimelineOrderItem } from "./ai-test-insights-timeline";

// The History timeline's order rule (#576), against a hand-written list. The
// expected order is written out by hand from the PRD's rule: by day, newest
// first (a session's `session_date`, a Test Insight's `requested_at` day in
// India); within a day by moment, newest first (`submitted_at`,
// `requested_at`); then sessions before Test Insights; then id descending.
const session = (id: number, sessionDate: string, submittedAt: string): TimelineOrderItem => ({
  kind: "session",
  id,
  sessionDate,
  submittedAt,
});
const insight = (id: number, requestedAt: string): TimelineOrderItem => ({ kind: "test_insight", id, requestedAt });
const labels = (items: TimelineOrderItem[]) => items.map((item) => `${item.kind === "session" ? "S" : "T"}${item.id}`);

describe("orderTimeline", () => {
  it("puts newer days first, whatever the moment", () => {
    const items = [
      // Submitted late on a later day for an earlier conversation: the day decides.
      session(1, "2026-09-03", "2026-11-20T10:00:00Z"),
      session(2, "2026-11-14", "2026-11-14T08:00:00Z"),
      insight(3, "2026-10-01T05:00:00Z"),
    ];

    expect(labels(orderTimeline(items))).toEqual(["S2", "T3", "S1"]);
  });

  it("orders two sessions on one day by submit time, newest first", () => {
    const items = [session(5, "2026-11-14", "2026-11-14T06:00:00Z"), session(4, "2026-11-14", "2026-11-15T09:00:00Z")];

    expect(labels(orderTimeline(items))).toEqual(["S4", "S5"]);
  });

  it("orders a session and a Test Insight on one day by moment, newest first", () => {
    const items = [
      session(7, "2026-02-10", "2026-02-10T04:00:00Z"),
      // 09:00 UTC is 14:30 on 10 Feb 2026 in India: the same day, a later moment.
      insight(8, "2026-02-10T09:00:00Z"),
    ];

    expect(labels(orderTimeline(items))).toEqual(["T8", "S7"]);
  });

  it("breaks equal moments with sessions before Test Insights, then id descending", () => {
    const moment = "2026-11-14T05:00:00Z";
    const items = [
      insight(11, moment),
      session(12, "2026-11-14", moment),
      insight(30, moment),
      session(9, "2026-11-14", moment),
    ];

    expect(labels(orderTimeline(items))).toEqual(["S12", "S9", "T30", "T11"]);
  });

  it("dates a Test Insight by its day in India, which can be the next UTC day", () => {
    const items = [
      // 19:00 UTC on 27 Nov 2026 is 00:30 on 28 Nov 2026 in India.
      insight(21, "2026-11-27T19:00:00Z"),
      session(22, "2026-11-28", "2026-11-28T03:00:00Z"),
      session(23, "2026-11-27", "2026-11-27T20:00:00Z"),
    ];

    expect(labels(orderTimeline(items))).toEqual(["S22", "T21", "S23"]);
  });

  it("returns a new list and leaves the given one as it was", () => {
    const items = [session(1, "2026-01-01", "2026-01-01T00:00:00Z"), session(2, "2026-01-02", "2026-01-02T00:00:00Z")];

    const ordered = orderTimeline(items);

    expect(labels(ordered)).toEqual(["S2", "S1"]);
    expect(labels(items)).toEqual(["S1", "S2"]);
  });
});
