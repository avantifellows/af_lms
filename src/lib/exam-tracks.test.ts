import { describe, expect, it } from "vitest";

import { EXAM_TRACKS, formatExamTrack, isExamTrack } from "./exam-tracks";

describe("EXAM_TRACKS", () => {
  it("lists the supported exam track codes in curriculum order", () => {
    expect(EXAM_TRACKS).toEqual(["jee_main", "jee_advanced", "neet"]);
  });
});

describe("isExamTrack", () => {
  it("accepts every supported code", () => {
    expect(isExamTrack("jee_main")).toBe(true);
    expect(isExamTrack("jee_advanced")).toBe(true);
    expect(isExamTrack("neet")).toBe(true);
  });

  it("rejects unknown, malformed and non-string values", () => {
    expect(isExamTrack("cet")).toBe(false);
    expect(isExamTrack("JEE Main")).toBe(false);
    expect(isExamTrack("")).toBe(false);
    expect(isExamTrack(undefined)).toBe(false);
    expect(isExamTrack(null)).toBe(false);
    expect(isExamTrack(1)).toBe(false);
  });
});

describe("formatExamTrack", () => {
  it("renders the display label for every supported code", () => {
    expect(formatExamTrack("jee_main")).toBe("JEE Main");
    expect(formatExamTrack("jee_advanced")).toBe("JEE Advanced");
    expect(formatExamTrack("neet")).toBe("NEET");
  });

  it("falls back to the raw value for an unknown code", () => {
    expect(formatExamTrack("cet")).toBe("cet");
  });
});
