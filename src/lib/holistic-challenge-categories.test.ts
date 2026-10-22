import { describe, expect, it } from "vitest";

import {
  HOLISTIC_CHALLENGE_CATEGORIES,
  groupHolisticChallengeCategories,
  holisticChallengeCategoryPercent,
  joinHolisticChallengeCategoryLabels,
  placeHolisticChallengeCategories,
  toggleHolisticChallengeCategory,
  validateHolisticChallengeCategories,
} from "./holistic-challenge-categories";

describe("HOLISTIC_CHALLENGE_CATEGORIES", () => {
  it("lists the 16 Challenge Categories in display order", () => {
    expect(HOLISTIC_CHALLENGE_CATEGORIES).toEqual([
      { code: "academic.subject_concept", group: "academic", label: "Subject/concept issues", shortLabel: "Subject" },
      { code: "academic.backlogs_workload", group: "academic", label: "Backlogs, revision & workload", shortLabel: "Backlogs" },
      { code: "academic.exam_related", group: "academic", label: "Exam/Test related issues", shortLabel: "Exams" },
      { code: "academic.test_preparation", group: "academic", label: "Test performance & preparation", shortLabel: "Test prep" },
      { code: "academic.other", group: "academic", label: "Other", shortLabel: "Other" },
      { code: "academic.no_major_issue", group: "academic", label: "No major issue reported", shortLabel: "No issue" },
      { code: "non_academic.time_management", group: "non_academic", label: "Time management & distractions", shortLabel: "Time" },
      { code: "non_academic.confidence_motivation", group: "non_academic", label: "Low confidence/motivation", shortLabel: "Confidence" },
      { code: "non_academic.adjustment", group: "non_academic", label: "Adjustment difficulties", shortLabel: "Adjustment" },
      { code: "non_academic.wellness", group: "non_academic", label: "Wellness (health, sleep etc.)", shortLabel: "Wellness" },
      { code: "non_academic.emotional_social", group: "non_academic", label: "Emotional & social stress", shortLabel: "Emotional" },
      { code: "non_academic.career_uncertainty", group: "non_academic", label: "Career uncertainty", shortLabel: "Career" },
      { code: "non_academic.financial", group: "non_academic", label: "Financial challenges", shortLabel: "Financial" },
      { code: "non_academic.communication_language", group: "non_academic", label: "Communication & language", shortLabel: "Language" },
      { code: "non_academic.other", group: "non_academic", label: "Other", shortLabel: "Other" },
      { code: "non_academic.no_major_issue", group: "non_academic", label: "No major issue reported", shortLabel: "No issue" },
    ]);
  });
});

describe("validateHolisticChallengeCategories", () => {
  it("accepts an empty or partial draft set, trimming codes", () => {
    expect(validateHolisticChallengeCategories([], { final: false })).toEqual({ ok: true, codes: [] });
    expect(validateHolisticChallengeCategories([" non_academic.financial "], { final: false })).toEqual({
      ok: true, codes: ["non_academic.financial"],
    });
  });

  it.each([true, false])("rejects unknown and non-string codes (final: %s)", (final) => {
    const unknown = { ok: false, error: "Unknown Challenge Category" };
    expect(validateHolisticChallengeCategories(["academic.bullying"], { final })).toEqual(unknown);
    expect(validateHolisticChallengeCategories(["Subject/concept issues"], { final })).toEqual(unknown);
    expect(validateHolisticChallengeCategories([7], { final })).toEqual(unknown);
    expect(validateHolisticChallengeCategories([null], { final })).toEqual(unknown);
    expect(validateHolisticChallengeCategories(["   "], { final })).toEqual(unknown);
  });

  it.each([true, false])("rejects duplicate codes, including after trimming (final: %s)", (final) => {
    expect(validateHolisticChallengeCategories(
      ["academic.other", "non_academic.wellness", " academic.other"], { final }
    )).toEqual({ ok: false, error: "Unknown Challenge Category" });
  });

  it.each([true, false])("rejects No major issue reported mixed with another code in its group (final: %s)", (final) => {
    const mixed = { ok: false, error: "Choose either No major issue reported or other Challenge Categories" };
    expect(validateHolisticChallengeCategories(
      ["academic.no_major_issue", "academic.exam_related", "non_academic.no_major_issue"], { final }
    )).toEqual(mixed);
    expect(validateHolisticChallengeCategories(
      ["academic.other", "non_academic.financial", "non_academic.no_major_issue"], { final }
    )).toEqual(mixed);
  });

  it("accepts No major issue reported alongside codes from the other group", () => {
    expect(validateHolisticChallengeCategories(
      ["academic.no_major_issue", "non_academic.career_uncertainty", "non_academic.financial"], { final: true }
    )).toEqual({
      ok: true, codes: ["academic.no_major_issue", "non_academic.career_uncertainty", "non_academic.financial"],
    });
  });

  it("with final, rejects a set that leaves a group empty and names that group", () => {
    const groupMessage = "Choose at least one Academic and one Non-academic Challenge Category";
    expect(validateHolisticChallengeCategories(["academic.subject_concept"], { final: true })).toEqual({
      ok: false, error: groupMessage, emptyGroup: "non_academic",
    });
    expect(validateHolisticChallengeCategories(["non_academic.no_major_issue"], { final: true })).toEqual({
      ok: false, error: groupMessage, emptyGroup: "academic",
    });
    expect(validateHolisticChallengeCategories([], { final: true })).toEqual({
      ok: false, error: groupMessage, emptyGroup: "academic",
    });
  });

  it("without final, accepts a set that leaves a group empty", () => {
    expect(validateHolisticChallengeCategories(["academic.subject_concept"], { final: false })).toEqual({
      ok: true, codes: ["academic.subject_concept"],
    });
  });
});

describe("groupHolisticChallengeCategories", () => {
  it("splits codes into Academic and Non-academic entries in catalogue order", () => {
    expect(groupHolisticChallengeCategories([
      "non_academic.other", "academic.other", "non_academic.time_management", "academic.subject_concept",
    ])).toEqual({
      academic: [
        { code: "academic.subject_concept", group: "academic", label: "Subject/concept issues", shortLabel: "Subject" },
        { code: "academic.other", group: "academic", label: "Other", shortLabel: "Other" },
      ],
      nonAcademic: [
        { code: "non_academic.time_management", group: "non_academic", label: "Time management & distractions", shortLabel: "Time" },
        { code: "non_academic.other", group: "non_academic", label: "Other", shortLabel: "Other" },
      ],
    });
  });

  it("returns empty groups for no codes", () => {
    expect(groupHolisticChallengeCategories([])).toEqual({ academic: [], nonAcademic: [] });
  });
});

describe("toggleHolisticChallengeCategory", () => {
  it("selects and deselects a code, keeping catalogue order", () => {
    expect(toggleHolisticChallengeCategory(["non_academic.financial"], "academic.exam_related"))
      .toEqual(["academic.exam_related", "non_academic.financial"]);
    expect(toggleHolisticChallengeCategory(["academic.exam_related", "non_academic.financial"], "academic.exam_related"))
      .toEqual(["non_academic.financial"]);
  });

  it("selecting No major issue reported clears the rest of its group only", () => {
    expect(toggleHolisticChallengeCategory(
      ["academic.subject_concept", "academic.other", "non_academic.wellness"], "academic.no_major_issue"
    )).toEqual(["academic.no_major_issue", "non_academic.wellness"]);
  });

  it("selecting another code clears that group's No major issue reported only", () => {
    expect(toggleHolisticChallengeCategory(
      ["academic.no_major_issue", "non_academic.no_major_issue"], "non_academic.adjustment"
    )).toEqual(["academic.no_major_issue", "non_academic.adjustment"]);
  });

  it("deselects No major issue reported", () => {
    expect(toggleHolisticChallengeCategory(["academic.no_major_issue"], "academic.no_major_issue")).toEqual([]);
  });
});

describe("placeHolisticChallengeCategories", () => {
  it("places each group under the matching current prod Question", () => {
    expect(placeHolisticChallengeCategories([
      { questionId: 501, position: 1, text: "What did the student share about their week?" },
      { questionId: 502, position: 2, text: "Describe the academic challenges the student is facing." },
      { questionId: 503, position: 3, text: "Describe any non-academic challenges the student mentioned." },
      { questionId: 504, position: 4, text: "What support did you agree on?" },
    ])).toEqual({ academicQuestionId: 502, nonAcademicQuestionId: 503 });
  });

  it("treats a Question mentioning both phrases as Non-academic only", () => {
    expect(placeHolisticChallengeCategories([
      { questionId: 11, position: 1, text: "Academic challenges and non-academic challenges discussed" },
      { questionId: 12, position: 2, text: "Describe the academic challenges in detail" },
    ])).toEqual({ academicQuestionId: 12, nonAcademicQuestionId: 11 });
  });

  it("matches case variants", () => {
    expect(placeHolisticChallengeCategories([
      { questionId: 21, position: 1, text: "NON-ACADEMIC CHALLENGES" },
      { questionId: 22, position: 2, text: "Academic Challenge areas" },
    ])).toEqual({ academicQuestionId: 22, nonAcademicQuestionId: 21 });
  });

  it("uses the first match by position, not by array order", () => {
    expect(placeHolisticChallengeCategories([
      { questionId: 31, position: 4, text: "Describe the academic challenges again" },
      { questionId: 32, position: 3, text: "Describe any non-academic challenges again" },
      { questionId: 33, position: 2, text: "Describe the academic challenges" },
      { questionId: 34, position: 1, text: "Describe any non-academic challenges" },
    ])).toEqual({ academicQuestionId: 33, nonAcademicQuestionId: 34 });
  });

  it("only counts the hyphenated non-academic as Non-academic", () => {
    expect(placeHolisticChallengeCategories([
      { questionId: 41, position: 1, text: "Describe any non academic challenges" },
      { questionId: 42, position: 2, text: "Describe any nonacademic challenges" },
    ])).toEqual({ academicQuestionId: 41, nonAcademicQuestionId: null });
  });

  it("leaves a group unplaced when no Question matches", () => {
    expect(placeHolisticChallengeCategories([
      { questionId: 51, position: 1, text: "Academic progress so far" },
      { questionId: 52, position: 2, text: "Non-academic support offered" },
    ])).toEqual({ academicQuestionId: null, nonAcademicQuestionId: null });
    expect(placeHolisticChallengeCategories([])).toEqual({ academicQuestionId: null, nonAcademicQuestionId: null });
  });
});

describe("joinHolisticChallengeCategoryLabels", () => {
  it("joins labels with a semicolon in catalogue order", () => {
    expect(joinHolisticChallengeCategoryLabels([
      "academic.other", "academic.subject_concept", "academic.backlogs_workload",
    ])).toBe("Subject/concept issues; Backlogs, revision & workload; Other");
    expect(joinHolisticChallengeCategoryLabels(["non_academic.no_major_issue"])).toBe("No major issue reported");
  });

  it("is empty when there are no codes", () => {
    expect(joinHolisticChallengeCategoryLabels([])).toBe("");
  });
});

describe("holisticChallengeCategoryPercent", () => {
  it("rounds count / n x 100 half-up to one decimal", () => {
    expect(holisticChallengeCategoryPercent(1, 3)).toBe(33.3);
    expect(holisticChallengeCategoryPercent(2, 3)).toBe(66.7);
    expect(holisticChallengeCategoryPercent(1, 8)).toBe(12.5);
    expect(holisticChallengeCategoryPercent(3, 4)).toBe(75);
    expect(holisticChallengeCategoryPercent(5, 5)).toBe(100);
  });

  it("rounds an exact half-tenth up rather than to even or down", () => {
    // 1 / 16 = 6.25% and 1 / 80 = 1.25%: both sit exactly on the half.
    expect(holisticChallengeCategoryPercent(1, 16)).toBe(6.3);
    expect(holisticChallengeCategoryPercent(1, 80)).toBe(1.3);
    // 1 / 400 = 0.25%, and 3 / 400 = 0.75%.
    expect(holisticChallengeCategoryPercent(1, 400)).toBe(0.3);
    expect(holisticChallengeCategoryPercent(3, 400)).toBe(0.8);
  });

  it("is 0 for no Students", () => {
    expect(holisticChallengeCategoryPercent(0, 0)).toBe(0);
    expect(holisticChallengeCategoryPercent(0, 7)).toBe(0);
  });
});
