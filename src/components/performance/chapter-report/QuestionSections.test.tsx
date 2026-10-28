import { describe, it, expect } from "vitest";
import { difficultySentence as diffSegments, segmentsText, topicSentence as topicSegments } from "./QuestionSections";
import type { QuestionGroupStat } from "@/types/question-analytics";
import type { InsightKind } from "@/lib/question-aggregates";

const topicSentence = (groups: QuestionGroupStat[], kind: InsightKind) => {
  const s = topicSegments(groups, kind);
  return s && segmentsText(s);
};
const difficultySentence = (groups: QuestionGroupStat[], kind: InsightKind) => {
  const s = diffSegments(groups, kind);
  return s && segmentsText(s);
};

function g(label: string, skip: number, accuracy: number | null, questions = 1): QuestionGroupStat {
  return {
    label, questions, responses: 100, attempted: 100 - skip, correct: 0, incorrect: 0, skipped: skip,
    skip_pct: skip, accuracy_pct: accuracy,
  };
}

// EMRS Bhopal 12P24 (Wave Optics), from Poojita's report.
const TOPICS = [
  g("Huygen's Wave Theory", 78, 48),
  g("Polarisation of Light", 73, 44),
  g("Diffraction", 58, 44),
  g("Interference", 55, 71),
  g("Young's Double-Slit Experiment", 48, 71),
  g("Coherent Sources", 31, 76),
  g("Wavefronts", 31, 59),
];
const LEVELS = [g("easy", 38, 67), g("medium", 56, 64), g("hard", 85, 41)];

describe("topicSentence", () => {
  it("names the two most and two least skipped topics", () => {
    expect(topicSentence(TOPICS, "skipped")).toBe(
      "By topic, Huygen's Wave Theory (78%) and Polarisation of Light (73%) were skipped the most; " +
        "Wavefronts and Coherent Sources (31% each) the least."
    );
  });

  it("names the two weakest and two strongest topics", () => {
    expect(topicSentence(TOPICS, "incorrect")).toBe(
      "By topic, Diffraction and Polarisation of Light (44% each) had the lowest accuracy."
    );
    expect(topicSentence(TOPICS, "correct")).toBe(
      "By topic, Coherent Sources (76%) and Interference (71%) had the highest accuracy."
    );
  });

  it("does not repeat a top topic in the least-skipped part", () => {
    expect(topicSentence(TOPICS.slice(0, 3), "skipped")).toBe(
      "By topic, Huygen's Wave Theory (78%) and Polarisation of Light (73%) were skipped the most; Diffraction (58%) the least."
    );
    expect(topicSentence(TOPICS.slice(0, 1), "skipped")).toBe("By topic, Huygen's Wave Theory (78%) was skipped the most.");
  });

  it("is null without topics", () => {
    expect(topicSentence([], "skipped")).toBeNull();
  });
});

describe("difficultySentence", () => {
  it("lists every level's percentage, easy to hard", () => {
    expect(difficultySentence(LEVELS, "skipped")).toBe("By difficulty: Easy 38%, Medium 56%, Hard 85% skipped.");
    expect(difficultySentence(LEVELS, "incorrect")).toBe(
      "By difficulty, Hard had the lowest accuracy: Easy 67%, Medium 64%, Hard 41%."
    );
    expect(difficultySentence(LEVELS, "correct")).toBe(
      "By difficulty, Easy had the highest accuracy: Easy 67%, Medium 64%, Hard 41%."
    );
  });
});

describe("bold runs", () => {
  it("bolds topic and difficulty names and their percentages only", () => {
    const bold = (segments: ReturnType<typeof topicSegments>) =>
      (segments ?? []).filter((x) => x.bold).map((x) => x.text);
    expect(bold(topicSegments(TOPICS, "correct"))).toEqual(["Coherent Sources", "76%", "Interference", "71%"]);
    expect(bold(diffSegments(LEVELS, "skipped"))).toEqual(["Easy", "38%", "Medium", "56%", "Hard", "85%"]);
  });
});
