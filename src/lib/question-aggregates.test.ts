import { describe, it, expect } from "vitest";
import {
  byDifficulty,
  byTopic,
  combineCohorts,
  pct,
  questionLabel,
  rankGroups,
  rankQuestions,
} from "./question-aggregates";
import type { QuestionStat } from "@/types/question-analytics";

function q(overrides: Partial<QuestionStat>): QuestionStat {
  return {
    question_id: "q",
    cms_question_id: null,
    position: 0,
    difficulty: null,
    subject: "Physics",
    topics: [],
    responses: 10,
    attempted: 0,
    correct: 0,
    incorrect: 0,
    skipped: 10,
    avg_time_seconds: null,
    ...overrides,
  };
}

const Q1 = q({ question_id: "a", position: 0, difficulty: "easy", topics: ["Interference"], attempted: 9, correct: 8, incorrect: 1, skipped: 1 });
const Q2 = q({ question_id: "b", position: 1, difficulty: "hard", topics: ["Interference", "Diffraction"], attempted: 2, correct: 1, incorrect: 1, skipped: 8 });
const Q3 = q({ question_id: "c", position: 2, difficulty: "medium", topics: ["Diffraction"], attempted: 5, correct: 2, incorrect: 3, skipped: 5 });
const Q4 = q({ question_id: "d", position: 3, difficulty: null, topics: [], attempted: 0, correct: 0, incorrect: 0, skipped: 10 });

describe("pct", () => {
  it("rounds to one decimal and is 0 for an empty whole", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(5, 0)).toBe(0);
  });
});

describe("byTopic", () => {
  it("counts a multi-topic question under each of its topics", () => {
    const groups = byTopic([Q1, Q2, Q3]);
    const interference = groups.find((g) => g.label === "Interference")!;
    const diffraction = groups.find((g) => g.label === "Diffraction")!;
    expect(interference.questions).toBe(2);
    expect(interference.responses).toBe(20);
    expect(interference.skip_pct).toBe(45);
    expect(interference.accuracy_pct).toBe(81.8);
    expect(diffraction.questions).toBe(2);
    expect(diffraction.correct).toBe(3);
  });

  it("leaves untagged questions out", () => {
    expect(byTopic([Q4])).toEqual([]);
  });

  it("does not double-count a topic repeated on one question", () => {
    const dup = q({ topics: ["Wavefronts", "Wavefronts"], attempted: 1, correct: 1, skipped: 9 });
    expect(byTopic([dup])[0].questions).toBe(1);
  });
});

describe("byDifficulty", () => {
  it("orders easy, medium, hard and leaves untagged questions out", () => {
    expect(byDifficulty([Q2, Q4, Q3, Q1]).map((g) => g.label)).toEqual(["easy", "medium", "hard"]);
  });
});

describe("rankGroups", () => {
  const groups = byDifficulty([Q1, Q2, Q3]);

  it("puts the most skipped first", () => {
    expect(rankGroups(groups, "skipped").map((g) => g.label)).toEqual(["hard", "medium", "easy"]);
  });

  it("puts the lowest accuracy first for incorrect and the highest for correct", () => {
    expect(rankGroups(groups, "incorrect").map((g) => g.label)).toEqual(["medium", "hard", "easy"]);
    expect(rankGroups(groups, "correct").map((g) => g.label)).toEqual(["easy", "hard", "medium"]);
  });

  it("leaves groups with nothing attempted out of the accuracy lists", () => {
    const none = byTopic([q({ topics: ["Unseen"] })]);
    expect(rankGroups(none, "correct")).toEqual([]);
    expect(rankGroups(none, "skipped")).toHaveLength(1);
  });
});

describe("rankQuestions", () => {
  it("ranks by the count and breaks ties in test order", () => {
    expect(rankQuestions([Q1, Q2, Q3, Q4], "skipped").map((x) => x.question_id)).toEqual(["d", "b", "c", "a"]);
    expect(rankQuestions([Q1, Q2, Q3], "incorrect").map((x) => x.question_id)).toEqual(["c", "a", "b"]);
    expect(rankQuestions([Q1, Q2, Q3], "correct").map((x) => x.question_id)).toEqual(["a", "c", "b"]);
  });
});

describe("combineCohorts", () => {
  it("weights each slice by its students", () => {
    const all = combineCohorts([
      { students: 1, avg_attempt_rate: 40, avg_accuracy: 90, avg_score: 30 },
      { students: 3, avg_attempt_rate: 60, avg_accuracy: 50, avg_score: 10 },
    ]);
    expect(all).toEqual({ students: 4, avg_attempt_rate: 55, avg_accuracy: 60, avg_score: 15 });
  });

  it("weights accuracy by the students who have one", () => {
    // Girls: 100% and one who attempted nothing; boys: 0%. The class is 50%, not 66.7%.
    const all = combineCohorts([
      { students: 2, avg_attempt_rate: 50, avg_accuracy: 100, avg_score: 40, accuracy_students: 1 },
      { students: 1, avg_attempt_rate: 50, avg_accuracy: 0, avg_score: 0, accuracy_students: 1 },
    ]);
    expect(all.avg_accuracy).toBe(50);
  });

  it("is all zeros for no students", () => {
    expect(combineCohorts([])).toEqual({ students: 0, avg_attempt_rate: 0, avg_accuracy: 0, avg_score: 0 });
  });
});

describe("questionLabel", () => {
  it("is 1-based from the position, else from the index", () => {
    expect(questionLabel(Q3, 0)).toBe("Q3");
    expect(questionLabel(q({ position: null }), 4)).toBe("Q5");
  });
});
