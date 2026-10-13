import { describe, it, expect } from "vitest";
import {
  AIAT_SURVEY_QUIZ_IDS,
  isAiatTestName,
  surveyQuizIdForAiat,
  aiatNextStep,
} from "@/lib/aiat-survey";

describe("isAiatTestName", () => {
  it("matches AIAT in various real test-name shapes", () => {
    for (const name of [
      "AIAT-01-G12-PCB",
      "G12-AIAT-02-NEET",
      "JNV-G12-MT-02-PCB (CET-AIAT 03)",
      "MUM-12: MT AIAT-2",
      "Pune 12 - AIAT 1",
      "aiat lowercase",
    ]) {
      expect(isAiatTestName(name)).toBe(true);
    }
  });

  it("does not match non-AIAT names or embedded substrings", () => {
    for (const name of [
      "G11 NEET PT - 10",
      "Chapter Test Physics",
      "RADIATION basics", // must not match the AIAT substring inside a word
      "",
      null,
      undefined,
    ]) {
      expect(isAiatTestName(name)).toBe(false);
    }
  });
});

describe("surveyQuizIdForAiat", () => {
  it("routes EMRS medical -> PCB survey", () => {
    expect(surveyQuizIdForAiat("EMRSStudents", "medical")).toBe(
      AIAT_SURVEY_QUIZ_IDS.emrsMedical
    );
  });

  it("routes EMRS engineering -> PCM survey", () => {
    expect(surveyQuizIdForAiat("EMRSStudents", "engineering")).toBe(
      AIAT_SURVEY_QUIZ_IDS.emrsEngineering
    );
  });

  it("routes EMRS with empty stream (CET) -> PCM survey by default", () => {
    expect(surveyQuizIdForAiat("EMRSStudents", "")).toBe(
      AIAT_SURVEY_QUIZ_IDS.emrsEngineering
    );
  });

  it("routes every other group -> report-only survey", () => {
    expect(surveyQuizIdForAiat("EnableStudents", "medical")).toBe(
      AIAT_SURVEY_QUIZ_IDS.reportOnly
    );
    expect(surveyQuizIdForAiat("EnableStudents", "engineering")).toBe(
      AIAT_SURVEY_QUIZ_IDS.reportOnly
    );
    expect(surveyQuizIdForAiat(null, "")).toBe(AIAT_SURVEY_QUIZ_IDS.reportOnly);
  });
});

describe("aiatNextStep", () => {
  it("returns null for a non-AIAT test", () => {
    expect(
      aiatNextStep({ testName: "G11 NEET PT - 10", group: "EMRSStudents", stream: "medical" })
    ).toBeNull();
  });

  it("builds a before-scorecard next step pointing at the routed survey", () => {
    const step = aiatNextStep({
      testName: "AIAT-01-G12-PCB",
      group: "EMRSStudents",
      stream: "medical",
    });
    expect(step).not.toBeNull();
    expect(step!.next_step_before_scores).toBe(true);
    expect(step!.next_step_autostart).toBe(true);
    expect(step!.next_step_url).toContain(`/form/${AIAT_SURVEY_QUIZ_IDS.emrsMedical}`);
    // templating the frontend fills; no real id leaked in
    expect(step!.next_step_url).toContain("apiKey={apiKey}");
    expect(step!.next_step_url).toContain("return_to={quizId}");
    // autoStart must NOT be in the URL — the player appends it from next_step_autostart,
    // and a duplicate param would disable auto-start in the router.
    expect(step!.next_step_url).not.toContain("autoStart");
    expect(step!.next_step_autostart).toBe(true);
  });

  it("routes a broad EnableStudents AIAT to the report-only survey", () => {
    const step = aiatNextStep({
      testName: "G12-AIAT-02-NEET",
      group: "EnableStudents",
      stream: "medical",
    });
    expect(step!.next_step_url).toContain(`/form/${AIAT_SURVEY_QUIZ_IDS.reportOnly}`);
  });
});
