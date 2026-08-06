import { describe, expect, it } from "vitest";

import { CMS_EXAM_TRACKS, isCmsExamTrack } from "./cms-tests";

describe("CMS_EXAM_TRACKS", () => {
  it("keeps Quiz Session tracks independent from the wider Curriculum vocabulary", () => {
    expect(CMS_EXAM_TRACKS).toEqual(["jee_main", "jee_advanced", "neet"]);
  });
});

describe("isCmsExamTrack", () => {
  it("accepts only tracks supported by the Quiz Session CMS flow", () => {
    expect(isCmsExamTrack("jee_main")).toBe(true);
    expect(isCmsExamTrack("jee_advanced")).toBe(true);
    expect(isCmsExamTrack("neet")).toBe(true);
    expect(isCmsExamTrack("cet")).toBe(false);
    expect(isCmsExamTrack("math_foundation")).toBe(false);
    expect(isCmsExamTrack(undefined)).toBe(false);
  });
});
