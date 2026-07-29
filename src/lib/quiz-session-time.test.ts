import { describe, it, expect } from "vitest";

import { istWallClockWindowEnd, utcToISTDate } from "./quiz-session-time";

describe("istWallClockWindowEnd", () => {
  // This codebase stores IST wall-clock re-stamped with a `Z` that no longer means UTC.
  // quiz-backend parses a naive datetime, so the window end it receives must be the bare
  // IST wall-clock — the `Z` dropped, and NO quiz-duration offset applied (quiz-backend adds
  // `time_limit.max` itself; pre-offsetting here would double it).
  it("shifts a true-UTC instant into IST wall-clock and drops the Z", () => {
    // 08:30 UTC + 5:30 = 14:00 IST
    expect(istWallClockWindowEnd("2026-04-15T08:30:00.000Z")).toBe(
      "2026-04-15T14:00:00"
    );
  });

  it("keeps the same wall-clock the session row and occurrence store, minus the Z", () => {
    const utcIso = "2026-04-15T06:00:00.000Z";
    // The session row / session_occurrence keep the Z-suffixed form...
    expect(utcToISTDate(utcIso)).toBe("2026-04-15T11:30:00.000Z");
    // ...and the quiz doc gets the identical instant without it.
    expect(istWallClockWindowEnd(utcIso)).toBe("2026-04-15T11:30:00");
  });

  it("rolls over the date when the IST shift crosses midnight", () => {
    // 20:00 UTC + 5:30 = 01:30 IST the next day
    expect(istWallClockWindowEnd("2026-04-15T20:00:00.000Z")).toBe(
      "2026-04-16T01:30:00"
    );
  });

  it("emits no fractional seconds (quiz-backend parses a naive datetime)", () => {
    expect(istWallClockWindowEnd("2026-04-15T08:30:00.123Z")).not.toMatch(/\./);
  });
});
