import { describe, expect, it } from "vitest";

import {
  getHolisticOperationMode,
  getHolisticScriptArgument,
  isHistoricalHolisticNotesSource,
} from "./holistic-script";

const validSource = [{
  businessStudentId: "student-1",
  sourceRecordKey: "record-1",
  sourceMentorId: null,
  sourceStartedAt: "2025-12-17 10:00:00",
  sourceEndedAt: null,
  sourceTimezone: "Asia/Calcutta",
  questions: [{ position: 1, question: "Question 1", answer: "Answer 1" }],
}];

describe("Holistic operator script helpers", () => {
  it("preserves the scripts' equals-only argument parsing", () => {
    expect(getHolisticScriptArgument(["--source=first", "--source=second"], "--source"))
      .toBe("first");
    expect(getHolisticScriptArgument(["--source", "separate"], "--source")).toBeUndefined();
  });

  it("defaults to dry-run and rejects conflicting execution modes", () => {
    expect(getHolisticOperationMode([])).toBe("dry-run");
    expect(getHolisticOperationMode(["--apply"])).toBe("apply");
    expect(() => getHolisticOperationMode(["--apply", "--dry-run"]))
      .toThrow("Use either --apply or --dry-run, not both");
  });

  it("accepts only grouped Historical Notes records with valid Question fields", () => {
    expect(isHistoricalHolisticNotesSource(validSource)).toBe(true);
    expect(isHistoricalHolisticNotesSource([
      { ...validSource[0], businessStudentId: "" },
    ])).toBe(false);
    expect(isHistoricalHolisticNotesSource([
      { ...validSource[0], questions: [{ position: 1, question: "Q", answer: 1 }] },
    ])).toBe(false);
    expect(isHistoricalHolisticNotesSource([
      { ...validSource[0], questions: [{ position: 1, question: "   ", answer: null }] },
    ])).toBe(false);
    expect(isHistoricalHolisticNotesSource([{
      ...validSource[0],
      sourceStartedAt: "not-a-timestamp",
    }])).toBe(false);
    expect(isHistoricalHolisticNotesSource([{
      ...validSource[0],
      sourceEndedAt: "2025-12-17 09:59:59",
    }])).toBe(false);
  });
});
