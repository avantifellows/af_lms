import { describe, expect, it } from "vitest";

import { AI_TEST_INSIGHTS_TEST_FORMATS, AI_TEST_INSIGHTS_TEST_FORMAT_LABELS } from "./ai-test-insights-shared";

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
