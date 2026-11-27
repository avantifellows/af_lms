import { afterEach, describe, expect, it, vi } from "vitest";

import { aiTestInsightsEnvironment, aiTestInsightsSetting, errorName } from "./ai-test-insights-env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("aiTestInsightsSetting", () => {
  it("trims the value and reads a blank one as unset", () => {
    vi.stubEnv("AI_TEST_INSIGHTS_S3_BUCKET", "  bucket-1 ");
    vi.stubEnv("AI_TEST_INSIGHTS_WAKE_URL", "   ");

    expect(aiTestInsightsSetting("AI_TEST_INSIGHTS_S3_BUCKET")).toBe("bucket-1");
    expect(aiTestInsightsSetting("AI_TEST_INSIGHTS_WAKE_URL")).toBeNull();
  });
});

describe("aiTestInsightsEnvironment", () => {
  it.each([
    ["staging", "staging"],
    [" production ", "production"],
    ["development", null],
    ["", null],
  ])("reads APP_ENV %j as %j", (value, expected) => {
    vi.stubEnv("APP_ENV", value);

    expect(aiTestInsightsEnvironment()).toBe(expected);
  });
});

describe("errorName", () => {
  it("gives an Error's name, never its message, and the fallback for anything else", () => {
    expect(errorName(new TypeError("row value"))).toBe("TypeError");
    expect(errorName("boom")).toBe("unknown");
    expect(errorName(null, "unknown error")).toBe("unknown error");
  });
});
