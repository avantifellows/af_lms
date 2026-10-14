import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./teacher-feedback-bq", () => ({
  summarizeRows: (rows: unknown[]) => ({ responseCount: rows.length, percentage: rows.length ? 90 : 0, parameters: [] }),
}));

import { query } from "./db";
import { getGenders, getRoundContext, getTeacherRounds, scoreRounds } from "./teacher-feedback-history";

const mockQuery = vi.mocked(query);

function round(quizId: string, cycleLabel: string, batches: string[]) {
  return {
    setup_run_id: `run-${quizId}`,
    cycle_label: cycleLabel,
    centre_name: "JNV Kurnool CoE",
    batch_class_ids: batches,
    start_time: "2026-09-17 11:32:28",
    end_time: "2026-09-18 11:32:28",
    quiz_id: quizId,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getRoundContext", () => {
  it("labels the round with its batch names, falling back to ids", async () => {
    mockQuery
      .mockResolvedValueOnce([round("q1", "Sep 2026", ["B27", "B99"])])
      .mockResolvedValueOnce([{ batch_id: "B27", name: "2027 Engineering" }]);

    expect(await getRoundContext("q1")).toEqual({
      setupRunId: "run-q1",
      cycleLabel: "Sep 2026",
      centreName: "JNV Kurnool CoE",
      batchNames: ["2027 Engineering", "B99"],
      startTime: "2026-09-17 11:32:28",
      endTime: "2026-09-18 11:32:28",
    });
  });

  it("is null for an unknown quiz", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await getRoundContext("nope")).toBeNull();
  });
});

describe("getTeacherRounds", () => {
  const params = { schoolCode: "59324", centreId: 7, teacherId: "T1", teacherName: "Indrani Khan" };

  it("lists the teacher's rounds at the centre with sorted batch names", async () => {
    mockQuery
      .mockResolvedValueOnce([round("a", "Aug 2026", ["B28", "B27"])])
      .mockResolvedValueOnce([
        { batch_id: "B27", name: "2027 Engineering" },
        { batch_id: "B28", name: "2028 Engineering" },
      ]);

    expect(await getTeacherRounds(params)).toEqual([
      {
        quizId: "a",
        setupRunId: "run-a",
        cycleLabel: "Aug 2026",
        startTime: "2026-09-17 11:32:28",
        batchNames: ["2027 Engineering", "2028 Engineering"],
      },
    ]);
    // Matched by teacher id, falling back to name; scoped to the same centre.
    expect(mockQuery.mock.calls[0][1]).toEqual(["59324", 7, "T1", "Indrani Khan"]);
    expect(mockQuery.mock.calls[0][0]).toContain("tf.teacher_id = $3");
  });
});

describe("scoreRounds", () => {
  it("scores each round from fetched rows and drops rounds nobody answered", () => {
    const rounds = ["a", "b", "c"].map((quizId) => ({
      quizId,
      setupRunId: `run-${quizId}`,
      cycleLabel: "Aug 2026",
      startTime: null,
      batchNames: ["2027 Engineering"],
    }));
    const rows = new Map([["a", [{}, {}]], ["b", []]]) as never;

    expect(scoreRounds(rounds, rows).map((h) => [h.quizId, h.responseCount])).toEqual([["a", 2]]);
  });
});

describe("getGenders", () => {
  it("keeps male and female only, and skips non-numeric ids", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: "1", gender: "female" },
      { id: "2", gender: "male" },
      { id: "3", gender: "other" },
      { id: "4", gender: null },
    ]);

    const genders = await getGenders(["1", "2", "3", "4", "test_admin"]);

    expect([...genders]).toEqual([["1", "female"], ["2", "male"]]);
    expect(mockQuery.mock.calls[0][1]).toEqual([["1", "2", "3", "4"]]);
  });

  it("skips the query when there's nobody to look up", async () => {
    expect((await getGenders(["test_admin"])).size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
