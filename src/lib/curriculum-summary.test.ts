import { describe, it, expect } from "vitest";
import { normalizeCurriculumSummarySearchParams } from "./curriculum-summary";

const TODAY = "2026-10-19";

describe("normalizeCurriculumSummarySearchParams", () => {
  it("defaults to Grade 11, today, page 1 and 20 rows", () => {
    expect(normalizeCurriculumSummarySearchParams({}, TODAY)).toEqual({
      grade: 11,
      asOf: "2026-10-19",
      page: 1,
      pageSize: 20,
    });
  });

  it("keeps a valid Grade 12, as-of date, page and page size", () => {
    expect(
      normalizeCurriculumSummarySearchParams(
        { grade: "12", as_of: "2026-08-15", page: "3", limit: "50" },
        TODAY
      )
    ).toEqual({ grade: 12, asOf: "2026-08-15", page: 3, pageSize: 50 });
  });

  it("falls back for an unknown Grade, an impossible date, a bad page and an unsupported page size", () => {
    expect(
      normalizeCurriculumSummarySearchParams(
        { grade: "10", as_of: "2026-02-30", page: "-2", limit: "15" },
        TODAY
      )
    ).toEqual({ grade: 11, asOf: "2026-10-19", page: 1, pageSize: 20 });
  });

  it("ignores removed filters", () => {
    expect(
      normalizeCurriculumSummarySearchParams(
        { programs: "2", subjects: "4", exam_tracks: "neet", preset: "all", flagged: "true", sort: "school" },
        TODAY
      )
    ).toEqual({ grade: 11, asOf: "2026-10-19", page: 1, pageSize: 20 });
  });
});
