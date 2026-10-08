import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/bigquery", () => ({
  getBigQueryClient: () => ({ query: mockQuery }),
}));

import { getTeacherFeedbackReport, getTeacherFeedbackSummaries } from "./teacher-feedback-bq";
import {
  FEEDBACK_QUESTIONS,
  OPEN_QUESTIONS,
  SCORED_QUESTIONS,
} from "./teacher-feedback-form";

// Rows are keyed by question TEXT and option LABEL, mirroring what the ETL
// writes to all_responses_form_level — never by position or option index.
function scoredRow(
  userId: string,
  question: (typeof SCORED_QUESTIONS)[number],
  optionIndex: number
) {
  const option = question.options[optionIndex];
  return {
    test_id: "quiz_x",
    user_id: userId,
    question_text: question.text,
    user_response: String(optionIndex),
    user_response_labels: option.text,
  };
}

function openRow(
  userId: string,
  role: "liked" | "improve",
  text: string
) {
  const question = OPEN_QUESTIONS.find((q) => q.role === role)!;
  return {
    test_id: "quiz_x",
    user_id: userId,
    question_text: question.text,
    user_response: text,
    user_response_labels: text,
  };
}

/** One student answering every scored question at `optionIndex`, plus both open ones. */
function fullResponseRows(userId: string, optionIndex: number) {
  const rows = SCORED_QUESTIONS.map((q) => scoredRow(userId, q, optionIndex));
  rows.push(openRow(userId, "liked", "Great teacher"));
  rows.push(openRow(userId, "improve", "no"));
  return rows;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getTeacherFeedbackReport", () => {
  it("scores a perfect response as 28/28 = 100% and extracts the meaningful comment", async () => {
    mockQuery.mockResolvedValueOnce([fullResponseRows("u1", 0)]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.responseCount).toBe(1);
    expect(r.totalScore).toBe(28);
    expect(r.maxTotalScore).toBe(28);
    expect(r.percentage).toBe(100);
    // "Great teacher" is meaningful; "no" is counted, not listed
    expect(r.comments).toEqual([{ role: "liked", text: "Great teacher" }]);
    expect(r.nothingCounts).toEqual({ liked: 0, improve: 1 });
  });

  it("averages across students (worst option = score 0 -> 0%)", async () => {
    mockQuery.mockResolvedValueOnce([[
      ...fullResponseRows("u1", 0), // 28
      ...fullResponseRows("u2", 2), // 0
    ]]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.responseCount).toBe(2);
    expect(r.totalScore).toBe(14); // avg of 28 and 0
    expect(r.percentage).toBe(50);
  });


  it("averages a parameter over only the students who rated it (skips don't dilute)", async () => {
    // Two Planning questions exist. u1 answers everything at the best option
    // (score 2 each). u2 answers only the FIRST Planning question, skipping the rest.
    const planningQuestions = SCORED_QUESTIONS.filter((q) => q.parameter === "Planning");
    expect(planningQuestions.length).toBe(2);

    const rows = [
      ...fullResponseRows("u1", 0),
      scoredRow("u2", planningQuestions[0], 0),
    ];
    mockQuery.mockResolvedValueOnce([rows]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.responseCount).toBe(2);

    const planning = r.parameters.find((p) => p.parameter === "Planning")!;
    // Q1 rated by both (2 + 2), Q2 by u1 only (2) → total 6, over 2 raters = 3.0
    expect(planning.answeredBy).toBe(2);
    expect(planning.score).toBe(3);

    // A parameter only u1 answered is averaged over 1, not 2 (not halved by u2's skip).
    const learning = r.parameters.find((p) => p.parameter === "Learning Outcome")!;
    expect(learning.answeredBy).toBe(1);
    expect(learning.score).toBe(2);
  });

  it("marks a parameter no one rated as answeredBy 0 / score 0", async () => {
    const rows = [
      openRow("u1", "liked", "Nice"),
      openRow("u1", "improve", "More PYQs"),
    ];
    mockQuery.mockResolvedValueOnce([rows]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.responseCount).toBe(1);
    for (const p of r.parameters) {
      expect(p.answeredBy).toBe(0);
      expect(p.score).toBe(0);
    }
  });

  it("returns zeros when there are no responses", async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.responseCount).toBe(0);
    expect(r.totalScore).toBe(0);
    expect(r.percentage).toBe(0);
    expect(r.comments).toEqual([]);
  });

  // --- the drift cases this scorer exists to survive -------------------------

  it("scores correctly when the quiz reordered the questions", async () => {
    // Same answers, rows delivered in reverse order. Positional scoring would
    // attribute each answer to the wrong parameter; text matching must not care.
    const forward = fullResponseRows("u1", 0);
    mockQuery.mockResolvedValueOnce([[...forward].reverse()]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.totalScore).toBe(28);
    expect(r.percentage).toBe(100);
  });

  it("scores by option label, ignoring a stale option index", async () => {
    // user_response says "0" (the best option) but the chosen LABEL is the worst.
    // The label is what the student actually saw, so it must win.
    const q = SCORED_QUESTIONS[0];
    const rows = [
      {
        test_id: "quiz_x",
        user_id: "u1",
        question_text: q.text,
        user_response: "0",
        user_response_labels: q.options[2].text, // score 0
      },
    ];
    mockQuery.mockResolvedValueOnce([rows]);
    const r = await getTeacherFeedbackReport("quiz_x");
    const param = r.parameters.find((p) => p.parameter === q.parameter)!;
    expect(param.answeredBy).toBe(1);
    expect(param.score).toBe(0);
  });

  it("skips responses to questions absent from this form version", async () => {
    // A question from an older generation of the form. It must not be scored
    // against whatever now sits at its position.
    const rows = [
      ...fullResponseRows("u1", 0),
      {
        test_id: "quiz_x",
        user_id: "u1",
        question_text: "Does the teacher bring snacks?",
        user_response: "0",
        user_response_labels: "Always",
      },
    ];
    mockQuery.mockResolvedValueOnce([rows]);
    const r = await getTeacherFeedbackReport("quiz_x");
    // Unchanged from the clean perfect-score case.
    expect(r.totalScore).toBe(28);
    expect(r.percentage).toBe(100);
  });

  it("tolerates whitespace and smart-quote drift in question text", async () => {
    // The pipeline round-trips text through CSV/JSON/Mongo, so apostrophes and
    // whitespace vary. One form question genuinely contains a curly apostrophe.
    const q = SCORED_QUESTIONS.find((x) => /[’']/.test(x.text))!;
    const mangled = q.text.replace(/[’']/g, "'").replace(/ /g, "  ");
    const rows = [
      {
        test_id: "quiz_x",
        user_id: "u1",
        question_text: `  ${mangled} `,
        user_response: "0",
        user_response_labels: q.options[0].text,
      },
    ];
    mockQuery.mockResolvedValueOnce([rows]);
    const r = await getTeacherFeedbackReport("quiz_x");
    const param = r.parameters.find((p) => p.parameter === q.parameter)!;
    expect(param.answeredBy).toBe(1);
    expect(param.score).toBe(2);
  });

  it("every form question is uniquely identifiable by its text", async () => {
    // The guarantee the whole approach rests on: no two questions share text.
    const texts = FEEDBACK_QUESTIONS.map((q) => q.text.trim());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("each scored question's options are uniquely identifiable by their text", async () => {
    // Likewise for options, or a label could not pick out one score.
    for (const q of SCORED_QUESTIONS) {
      const labels = q.options.map((o) => o.text.trim());
      expect(new Set(labels).size, `duplicate option text in: ${q.text}`).toBe(
        labels.length
      );
    }
  });
});

describe("question-level detail and splits", () => {
  it("gives each parameter a % and each question its % and option counts", async () => {
    const [q] = SCORED_QUESTIONS;
    mockQuery.mockResolvedValueOnce([[scoredRow("u1", q, 0), scoredRow("u2", q, 1), scoredRow("u3", q, 1)]]);
    const r = await getTeacherFeedbackReport("quiz_x");

    const param = r.parameters.find((p) => p.parameter === q.parameter)!;
    const question = param.questions.find((x) => x.text === q.text)!;
    expect(question).toMatchObject({ questionTag: q.questionTag, answeredBy: 3, optionCounts: [1, 2, 0] });
    expect(question.percentage).toBeCloseTo((4 / 3 / 2) * 100);
    expect(param.percentage).toBeCloseTo((param.score / param.maxScore) * 100);
  });

  it("splits by gender, leaving out a group too small to stay anonymous", async () => {
    const girls = ["f1", "f2", "f3", "f4", "f5"];
    mockQuery.mockResolvedValueOnce([[
      ...girls.flatMap((u) => fullResponseRows(u, 0)),
      ...fullResponseRows("m1", 2),
    ]]);
    const genderOf = vi.fn(async (ids: string[]) =>
      new Map(ids.map((id) => [id, id.startsWith("f") ? ("female" as const) : ("male" as const)]))
    );
    const r = await getTeacherFeedbackReport("quiz_x", genderOf);

    expect(r.byGender.female).toMatchObject({ responseCount: 5, percentage: 100 });
    expect(r.byGender.male).toBeUndefined();
    expect(genderOf).toHaveBeenCalledWith(expect.arrayContaining([...girls, "m1"]));
  });

  it("summarises several quizzes from one query, excluding the admin test user", async () => {
    mockQuery.mockResolvedValueOnce([[
      ...fullResponseRows("u1", 0),
      ...fullResponseRows("u2", 2).map((row) => ({ ...row, test_id: "quiz_y" })),
    ]]);
    const byQuiz = await getTeacherFeedbackSummaries(["quiz_x", "quiz_y", "quiz_z"]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0].query).toContain("test_admin");
    expect(byQuiz.get("quiz_x")).toMatchObject({ responseCount: 1, percentage: 100 });
    expect(byQuiz.get("quiz_y")).toMatchObject({ responseCount: 1, percentage: 0 });
    expect(byQuiz.get("quiz_z")).toMatchObject({ responseCount: 0 });
  });

  it("counts \"nothing\"-style answers instead of listing each one", async () => {
    mockQuery.mockResolvedValueOnce([[
      openRow("u1", "improve", "Nothing"),
      openRow("u2", "improve", "nothing sir."),
      openRow("u3", "improve", "No comments"),
      openRow("u4", "improve", "Nothing to improve"),
      openRow("u5", "improve", "Do some more PYQs"),
    ]]);
    const r = await getTeacherFeedbackReport("quiz_x");

    expect(r.nothingCounts.improve).toBe(4);
    expect(r.comments).toEqual([{ role: "improve", text: "Do some more PYQs" }]);
  });
});
