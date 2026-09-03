import { describe, expect, it } from "vitest";

import {
  getHistoricalImportBaseline,
  getHolisticHistoricalImportProgramId,
  getHolisticMentorshipProgramId,
  getHolisticOperationMode,
  getHolisticScriptArgument,
  isHistoricalHolisticNotesSource,
  requireHolisticScriptArgument,
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
    expect(requireHolisticScriptArgument(
      ["--source=history.json"],
      "--source",
      "source required",
    )).toBe("history.json");
    expect(() => requireHolisticScriptArgument([], "--source", "source required"))
      .toThrow("source required");
  });

  it("accepts all supported Holistic Mentorship Programs", () => {
    expect(getHolisticMentorshipProgramId([])).toBe(1);
    expect(getHolisticMentorshipProgramId(["--program-id=74"])).toBe(74);
    expect(getHolisticMentorshipProgramId(["--program-id=94"])).toBe(94);
    expect(getHolisticMentorshipProgramId(["--program-id=78"])).toBe(78);
    expect(getHolisticMentorshipProgramId(["--program-id=88"])).toBe(88);
    expect(getHolisticMentorshipProgramId(["--program-id=99"])).toBe(99);
    expect(() => getHolisticMentorshipProgramId(["--program-id=64"]))
      .toThrow("supported Holistic Mentorship Program");
  });

  it.each([74, 94, 88, 99])(
    "rejects newly enabled Program %s from Historical Notes operations",
    (programId) => {
      expect(() => getHolisticHistoricalImportProgramId([`--program-id=${programId}`]))
        .toThrow("--program-id must be 1 or 78");
    },
  );

  it("keeps Historical Notes parsing limited to Programs 1 and 78", () => {
    expect(getHolisticHistoricalImportProgramId([])).toBe(1);
    expect(getHolisticHistoricalImportProgramId(["--program-id=78"])).toBe(78);
  });

  it("defaults to dry-run and rejects conflicting execution modes", () => {
    expect(getHolisticOperationMode([])).toBe("dry-run");
    expect(getHolisticOperationMode(["--apply"])).toBe("apply");
    expect(() => getHolisticOperationMode(["--apply", "--dry-run"]))
      .toThrow("Use either --apply or --dry-run, not both");
  });

  it("parses reviewed Historical import counts and rejects malformed values", () => {
    expect(getHistoricalImportBaseline([
      "--approved-counts=11/10/1/2/0",
    ])).toEqual({
      safeCandidates: 11,
      substantive: 10,
      emptySkips: 1,
      nullableMentors: 2,
      quarantinedUnmatched: 0,
    });
    expect(getHistoricalImportBaseline([])).toBeUndefined();
    expect(() => getHistoricalImportBaseline([
      "--approved-counts=11/10/2/2/0",
    ])).toThrow(
      "--approved-counts must be safe/substantive/empty/nullable/unmatched"
    );
    expect(() => getHistoricalImportBaseline([
      "--approved-counts=////",
    ])).toThrow(
      "--approved-counts must be safe/substantive/empty/nullable/unmatched"
    );
    expect(() => getHistoricalImportBaseline([
      "--approved-counts=0/0/0/0/0",
    ])).toThrow(
      "--approved-counts must be safe/substantive/empty/nullable/unmatched"
    );
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
