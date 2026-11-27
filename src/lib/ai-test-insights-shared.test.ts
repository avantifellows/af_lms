import { describe, expect, it } from "vitest";

import {
  AI_TEST_INSIGHTS_TEST_FORMATS,
  AI_TEST_INSIGHTS_TEST_FORMAT_LABELS,
  formatInsightRequestTime,
  formatInsightSessionDate,
} from "./ai-test-insights-shared";

describe("AI_TEST_INSIGHTS_TEST_FORMAT_LABELS", () => {
  it("names each picker format as the LMS's test format options do", () => {
    expect(AI_TEST_INSIGHTS_TEST_FORMAT_LABELS).toEqual({
      major_test: "Major Test",
      full_syllabus_test: "Full Syllabus Test",
      mock_test: "Mock Test",
    });
    expect(Object.keys(AI_TEST_INSIGHTS_TEST_FORMAT_LABELS)).toEqual([...AI_TEST_INSIGHTS_TEST_FORMATS]);
  });
});

describe("AI Test Insights dates", () => {
  it('write September as "Sep" in a date and in a time, never "Sept"', () => {
    expect(formatInsightSessionDate("2026-09-03")).toBe("3 Sep 2026");
    // 05:30 UTC is 11:00 on 5 Sep 2026 in India.
    expect(formatInsightRequestTime("2026-09-05T05:30:00Z")).toBe("5 Sep 2026, 11:00");
  });

  it("write every month by its three-letter name, and no date as empty", () => {
    const months = Array.from({ length: 12 }, (_, index) =>
      formatInsightSessionDate(`2026-${String(index + 1).padStart(2, "0")}-14`).split(" ")[1],
    );
    expect(months).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    expect(formatInsightSessionDate(null)).toBe("");
  });
});
