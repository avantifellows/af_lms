import { describe, it, expect } from "vitest";
import { EXAM_TRACKS, isExamTrack } from "./exam-tracks";
import { curriculumIdForExamTrack } from "./curriculum-options";

describe("exam tracks", () => {
  it("maps only LMS content-ready tracks to curriculum ids", () => {
    expect(curriculumIdForExamTrack("jee_main")).toBe(1);
    expect(curriculumIdForExamTrack("neet")).toBe(2);
    expect(curriculumIdForExamTrack("jee_advanced")).toBe(9);
    expect(curriculumIdForExamTrack("cet")).toBeNull();
    expect(curriculumIdForExamTrack("math_foundation")).toBeNull();
  });

  it("accepts cet as an exam track", () => {
    expect(isExamTrack("cet")).toBe(true);
    expect(EXAM_TRACKS).toContain("cet");
  });

  it("rejects an unknown track", () => {
    expect(isExamTrack("cuet")).toBe(false);
    expect(isExamTrack("")).toBe(false);
  });
});
