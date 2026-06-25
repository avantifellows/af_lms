import { describe, it, expect } from "vitest";

import {
  FEEDBACK_QUESTIONS,
  SCORED_QUESTIONS,
  OPEN_QUESTIONS,
  PARAMETERS,
  MAX_TOTAL_SCORE,
  MAX_QUESTION_SCORE,
  OPTION_SCORES,
  maxScoreForParameter,
  scoreUserResponse,
  buildFeedbackQuizBody,
  FEEDBACK_FORM_VERSION,
} from "./teacher-feedback-form";

describe("teacher-feedback-form config integrity", () => {
  it("has 16 questions: 14 scored + 2 open, in order", () => {
    expect(FEEDBACK_QUESTIONS).toHaveLength(16);
    expect(SCORED_QUESTIONS).toHaveLength(14);
    expect(OPEN_QUESTIONS).toHaveLength(2);
    // open-ended come last (positions 14, 15)
    expect(FEEDBACK_QUESTIONS[14].kind).toBe("open");
    expect(FEEDBACK_QUESTIONS[15].kind).toBe("open");
  });

  it("each scored question has exactly 3 options with scores 2/1/0", () => {
    for (const q of SCORED_QUESTIONS) {
      expect(q.options).toHaveLength(3);
      expect(q.options.map((o) => o.score)).toEqual([...OPTION_SCORES]);
      for (const o of q.options) {
        expect(o.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("max total score is 28 (14 × 2)", () => {
    expect(MAX_QUESTION_SCORE).toBe(2);
    expect(MAX_TOTAL_SCORE).toBe(28);
  });

  it("exposes the 7 parameter categories in first-appearance order", () => {
    expect(PARAMETERS).toEqual([
      "Planning",
      "Concept",
      "Curiosity",
      "Class Structure",
      "Communication",
      "Inclusive and Equitable Classroom",
      "Learning Outcome",
    ]);
  });

  it("parameter max scores sum to the total", () => {
    const sum = PARAMETERS.reduce((acc, p) => acc + maxScoreForParameter(p), 0);
    expect(sum).toBe(MAX_TOTAL_SCORE);
    // spot check the CSV layout: Concept has 3 questions → max 6
    expect(maxScoreForParameter("Concept")).toBe(6);
    expect(maxScoreForParameter("Planning")).toBe(4);
    expect(maxScoreForParameter("Learning Outcome")).toBe(2);
  });

  it("open questions are tagged liked then improve", () => {
    expect(OPEN_QUESTIONS.map((q) => q.role)).toEqual(["liked", "improve"]);
  });
});

describe("scoreUserResponse", () => {
  it("maps option index → score (0→2, 1→1, 2→0) for scored questions", () => {
    expect(scoreUserResponse(0, "0")).toBe(2);
    expect(scoreUserResponse(0, "1")).toBe(1);
    expect(scoreUserResponse(0, "2")).toBe(0);
  });

  it("returns null for unanswered, invalid, or open-ended positions", () => {
    expect(scoreUserResponse(0, null)).toBeNull();
    expect(scoreUserResponse(0, undefined)).toBeNull();
    expect(scoreUserResponse(0, "")).toBeNull();
    expect(scoreUserResponse(0, "3")).toBeNull(); // out of range
    expect(scoreUserResponse(0, "x")).toBeNull(); // not a number
    expect(scoreUserResponse(14, "0")).toBeNull(); // open-ended position
    expect(scoreUserResponse(99, "0")).toBeNull(); // out of bounds
  });

  it("reproduces the real JNV Palghar pilot total (Manjit Kumar = 19/28 = 67.86%)", () => {
    // Real responses pulled from BigQuery all_responses_form_level
    // (test_id 6a15ebf89c38a322dd2137fd, user 1049283716), qpi → user_response.
    const responses: Record<number, string> = {
      0: "0", 1: "0", 2: "0", 3: "0", 4: "0", 5: "0", 6: "0",
      7: "0", 8: "2", 9: "2", 10: "2", 11: "1", 12: "2", 13: "0",
      14: "no", 15: "ya",
    };
    let total = 0;
    for (let i = 0; i < FEEDBACK_QUESTIONS.length; i++) {
      total += scoreUserResponse(i, responses[i]) ?? 0;
    }
    expect(total).toBe(19);
    expect(Number(((total / MAX_TOTAL_SCORE) * 100).toFixed(2))).toBeCloseTo(67.86, 2);
  });
});

describe("buildFeedbackQuizBody", () => {
  const body = buildFeedbackQuizBody({
    title: "Student Feedback - Jun 2026 - JNV Palghar - Manjit Kumar",
    grade: "11",
    sourceId: "teacher-feedback:v2:34054:2026-06",
    nextStepUrl: "https://auth.avantifellows.org/?sessionId=NEXT",
    nextStepText: "Continue to next teacher feedback",
  });

  it("is a form quiz with canonical metadata", () => {
    const meta = body.metadata as Record<string, unknown>;
    expect(meta.quiz_type).toBe("form");
    expect(meta.test_format).toBe("questionnaire");
    expect(meta.source_id).toBe("teacher-feedback:v2:34054:2026-06");
    expect(meta.next_step_url).toBe("https://auth.avantifellows.org/?sessionId=NEXT");
    expect(body.show_scores).toBe(false);
    expect(body.review_immediate).toBe(true);
    expect(body.num_graded_questions).toBe(0);
  });

  it("emits 16 questions: single-choice with scored options + subjective open-ended", () => {
    const sets = body.question_sets as Array<Record<string, unknown>>;
    const questions = sets[0].questions as Array<Record<string, unknown>>;
    expect(questions).toHaveLength(16);

    const scored = questions[0];
    expect(scored.type).toBe("single-choice");
    expect(scored.graded).toBe(false);
    const opts = scored.options as Array<{ metadata: { score: number } }>;
    expect(opts.map((o) => o.metadata.score)).toEqual([2, 1, 0]);

    const openQ = questions[14];
    expect(openQ.type).toBe("subjective");
    expect(openQ.options).toEqual([]);
    expect(openQ.max_char_limit).toBe(700);
  });

  it("tags each question's source_id with the form version + 1-based index", () => {
    const sets = body.question_sets as Array<Record<string, unknown>>;
    const questions = sets[0].questions as Array<Record<string, unknown>>;
    expect(questions[0].source_id).toBe(`teacher-feedback-form:${FEEDBACK_FORM_VERSION}:1`);
    expect(questions[15].source_id).toBe(`teacher-feedback-form:${FEEDBACK_FORM_VERSION}:16`);
  });
});
