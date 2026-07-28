import { describe, expect, it } from "vitest";

import { deriveLmsEnrollmentPeriod } from "./lms-enrollment-date";

describe("deriveLmsEnrollmentPeriod", () => {
  it("uses the current Asia/Kolkata date as start_date", () => {
    expect(
      deriveLmsEnrollmentPeriod(new Date("2026-07-01T03:00:00Z")),
    ).toEqual({ start_date: "2026-07-01", academic_year: "2026-2027" });
  });

  it("uses the previous academic year on March 31 IST and new year on April 1 IST", () => {
    expect(
      deriveLmsEnrollmentPeriod(new Date("2026-03-31T18:29:59Z")),
    ).toEqual({ start_date: "2026-03-31", academic_year: "2025-2026" });

    expect(
      deriveLmsEnrollmentPeriod(new Date("2026-03-31T18:30:00Z")),
    ).toEqual({ start_date: "2026-04-01", academic_year: "2026-2027" });
  });
});
