import { describe, it, expect } from "vitest";
import {
  EXAM_TRACKS,
  curriculumIdForExamTrack,
  isExamTrack,
  streamForExamTrack,
} from "./curriculum-options";

describe("exam tracks", () => {
  it("maps each track to its CMS curriculum id", () => {
    // db-service /api/curriculum: JEE Mains=1, NEET=2, JEE Advanced=9, CET=10.
    expect(curriculumIdForExamTrack("jee_main")).toBe(1);
    expect(curriculumIdForExamTrack("neet")).toBe(2);
    expect(curriculumIdForExamTrack("jee_advanced")).toBe(9);
    expect(curriculumIdForExamTrack("cet")).toBe(10);
  });

  it("accepts cet as an exam track", () => {
    expect(isExamTrack("cet")).toBe(true);
    expect(EXAM_TRACKS).toContain("cet");
  });

  it("rejects an unknown track", () => {
    expect(isExamTrack("cuet")).toBe(false);
    expect(isExamTrack("")).toBe(false);
  });

  it("leaves cet unbound to a stream", () => {
    // CET papers are PCM/PCB/PCMB, so they serve engineering and medical batches
    // alike. An empty stream skips the stream-match guard in the from-cms route;
    // returning "engineering" would reject every valid medical pairing.
    expect(streamForExamTrack("cet")).toBe("");
    expect(streamForExamTrack("jee_main")).toBe("engineering");
    expect(streamForExamTrack("jee_advanced")).toBe("engineering");
    expect(streamForExamTrack("neet")).toBe("medical");
  });
});
