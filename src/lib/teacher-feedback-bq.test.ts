import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/bigquery", () => ({
  getBigQueryClient: () => ({ query: mockQuery }),
}));

import { getTeacherFeedbackReport } from "./teacher-feedback-bq";

// One student answering all 14 scored questions with option 0 (= score 2 each)
// plus the two open-ended. qpi 0-13 scored, 14/15 subjective.
function fullResponseRows(userId: string, batch: string, optionIndex: string) {
  const rows = [];
  for (let qpi = 0; qpi < 14; qpi++) {
    rows.push({ user_id: userId, batch, qpi, user_response: optionIndex, user_response_labels: "opt" });
  }
  rows.push({ user_id: userId, batch, qpi: 14, user_response: "Great teacher", user_response_labels: "Great teacher" });
  rows.push({ user_id: userId, batch, qpi: 15, user_response: "no", user_response_labels: "no" });
  return rows;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getTeacherFeedbackReport", () => {
  it("scores a perfect response as 28/28 = 100% and extracts the meaningful comment", async () => {
    mockQuery.mockResolvedValueOnce([fullResponseRows("u1", "BATCH_A", "0")]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.responseCount).toBe(1);
    expect(r.totalScore).toBe(28);
    expect(r.maxTotalScore).toBe(28);
    expect(r.percentage).toBe(100);
    // "Great teacher" is meaningful; "no" is filtered out
    expect(r.comments).toEqual([{ role: "liked", text: "Great teacher" }]);
    expect(r.batches).toEqual([{ batch: "BATCH_A", batchName: "BATCH_A", responseCount: 1 }]);
  });

  it("averages across students (option 2 = score 0 -> 0%)", async () => {
    mockQuery.mockResolvedValueOnce([[
      ...fullResponseRows("u1", "BATCH_A", "0"), // 28
      ...fullResponseRows("u2", "BATCH_A", "2"), // 0
    ]]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.responseCount).toBe(2);
    expect(r.totalScore).toBe(14); // avg of 28 and 0
    expect(r.percentage).toBe(50);
  });

  it("reports per-batch response counts", async () => {
    mockQuery.mockResolvedValueOnce([[
      ...fullResponseRows("u1", "BATCH_A", "0"),
      ...fullResponseRows("u2", "BATCH_B", "1"),
      ...fullResponseRows("u3", "BATCH_B", "1"),
    ]]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.responseCount).toBe(3);
    expect(r.batches).toEqual([
      { batch: "BATCH_B", batchName: "BATCH_B", responseCount: 2 },
      { batch: "BATCH_A", batchName: "BATCH_A", responseCount: 1 },
    ]);
  });

  it("averages a parameter over only the students who rated it (skips don't dilute)", async () => {
    // Two students. u1 answers everything (option 0 → score 2 on qpi 0 & 1,
    // both "Planning"). u2 answers ONLY qpi 0 (score 2) and skips the rest.
    const rows = [
      ...fullResponseRows("u1", "BATCH_A", "0"),
      { user_id: "u2", batch: "BATCH_A", qpi: 0, user_response: "0", user_response_labels: "opt" },
    ];
    mockQuery.mockResolvedValueOnce([rows]);
    const r = await getTeacherFeedbackReport("quiz_x");
    expect(r.responseCount).toBe(2);

    const planning = r.parameters.find((p) => p.parameter === "Planning")!;
    // qpi 0 rated by both (2 + 2), qpi 1 rated by u1 only (2) → total 6, over 2 raters = 3.0
    expect(planning.answeredBy).toBe(2);
    expect(planning.score).toBe(3);

    // A parameter only u1 answered is averaged over 1, not 2 (not halved by u2's skip).
    const learning = r.parameters.find((p) => p.parameter === "Learning Outcome")!;
    expect(learning.answeredBy).toBe(1);
    expect(learning.score).toBe(2);
  });

  it("marks a parameter no one rated as answeredBy 0 / score 0", async () => {
    // Single student who answers only the two open-ended questions, no scored ones.
    const rows = [
      { user_id: "u1", batch: "BATCH_A", qpi: 14, user_response: "Nice", user_response_labels: "Nice" },
      { user_id: "u1", batch: "BATCH_A", qpi: 15, user_response: "More PYQs", user_response_labels: "More PYQs" },
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
});
