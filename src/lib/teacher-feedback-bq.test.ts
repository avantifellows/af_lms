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
    expect(r.batches).toEqual([{ batch: "BATCH_A", responseCount: 1 }]);
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
      { batch: "BATCH_B", responseCount: 2 },
      { batch: "BATCH_A", responseCount: 1 },
    ]);
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
