import { describe, expect, it } from "vitest";
import { quizDurationSeconds } from "./quiz-duration";

describe("quizDurationSeconds", () => {
  it("uses time_limit.max", () => {
    expect(quizDurationSeconds({ time_limit: { min: 0, max: 10800 } })).toBe(10800);
  });

  it("records an untimed test as 0", () => {
    expect(quizDurationSeconds({ time_limit: null })).toBe(0);
    expect(quizDurationSeconds({ time_limit: { min: 0, max: 0 } })).toBe(0);
  });

  it("leaves the duration unknown when quiz-backend sent no time_limit", () => {
    expect(quizDurationSeconds({})).toBeUndefined();
  });
});
