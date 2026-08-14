import { describe, expect, it } from "vitest";

import {
  CMS_EXAM_TRACKS,
  curriculumIdForCmsExamTrack,
  isCmsExamTrack,
  parseCmsCurriculumScope,
  streamForCmsExamTrack,
} from "./cms-tests";

describe("CMS_EXAM_TRACKS", () => {
  it("keeps Quiz Session tracks independent from the wider Curriculum vocabulary", () => {
    expect(CMS_EXAM_TRACKS).toEqual(["jee_main", "jee_advanced", "neet", "cet"]);
  });
});

describe("isCmsExamTrack", () => {
  it("accepts only tracks supported by the Quiz Session CMS flow", () => {
    expect(isCmsExamTrack("jee_main")).toBe(true);
    expect(isCmsExamTrack("jee_advanced")).toBe(true);
    expect(isCmsExamTrack("neet")).toBe(true);
    expect(isCmsExamTrack("cet")).toBe(true);
    expect(isCmsExamTrack("math_foundation")).toBe(false);
    expect(isCmsExamTrack(undefined)).toBe(false);
  });
});

describe("CMS Exam Track mappings", () => {
  it("maps CET to CMS curriculum 10 and allows either batch stream", () => {
    expect(curriculumIdForCmsExamTrack("cet")).toBe(10);
    expect(streamForCmsExamTrack("cet")).toBe("");
  });

  it("keeps the JEE and NEET mappings and stream guards", () => {
    expect(curriculumIdForCmsExamTrack("jee_main")).toBe(1);
    expect(curriculumIdForCmsExamTrack("jee_advanced")).toBe(9);
    expect(curriculumIdForCmsExamTrack("neet")).toBe(2);
    expect(streamForCmsExamTrack("jee_main")).toBe("engineering");
    expect(streamForCmsExamTrack("jee_advanced")).toBe("engineering");
    expect(streamForCmsExamTrack("neet")).toBe("medical");
  });
});

describe("parseCmsCurriculumScope", () => {
  it("parses a supported track and grade", () => {
    expect(
      parseCmsCurriculumScope(new URLSearchParams("exam_track=neet&grade=12"))
    ).toEqual({ ok: true, examTrack: "neet", grade: 12 });
  });

  it("rejects invalid scope values", () => {
    expect(parseCmsCurriculumScope(new URLSearchParams("grade=11"))).toEqual({
      ok: false,
      error: "Invalid or missing exam_track",
    });
    expect(
      parseCmsCurriculumScope(new URLSearchParams("exam_track=jee_main&grade=10"))
    ).toEqual({ ok: false, error: "grade must be 11 or 12" });
  });
});
