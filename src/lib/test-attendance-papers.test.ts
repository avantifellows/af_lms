import { beforeEach, describe, expect, it, vi } from "vitest";

// The Paper windows read with only the Postgres `query()` boundary stubbed.
// `session` times are IST wall clock; the windows are UTC.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { readPaperWindows } from "./test-attendance-papers";

const sessionRow = (
  platform_id: string,
  start_time: string | null,
  end_time: string | null,
  grade: string | null = "11",
  is_active: boolean | null = true,
) => ({ platform_id, start_time, end_time, grade, is_active });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("readPaperWindows", () => {
  it("asks nothing when there are no quiz ids", async () => {
    expect(await readPaperWindows([])).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("reads the session rows of the quiz ids with a parameter and gives each Paper its window in UTC", async () => {
    mockQuery.mockResolvedValue([sessionRow("q1", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "12")]);

    expect(await readPaperWindows(["q1", "q2"])).toEqual([
      { quizId: "q1", opensAt: "2026-10-05T23:30:00.000Z", closesAt: "2026-10-10T18:25:00.000Z", grade: 12, switchedOn: true },
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("platform_id = ANY($1::text[])");
    expect(sql).not.toContain("q1");
    expect(params).toEqual([["q1", "q2"]]);
  });

  it("takes the earliest opening, the latest closing and a grade from the switched-on rows of a quiz id", async () => {
    mockQuery.mockResolvedValue([
      sessionRow("q1", "2026-10-07 05:00:00", "2026-10-09 23:55:00", null),
      sessionRow("q1", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "11"),
      // Switched off: neither its earlier opening nor its later closing counts.
      sessionRow("q1", "2026-10-01 05:00:00", "2026-10-20 23:55:00", "12", false),
    ]);

    expect(await readPaperWindows(["q1"])).toEqual([
      { quizId: "q1", opensAt: "2026-10-05T23:30:00.000Z", closesAt: "2026-10-10T18:25:00.000Z", grade: 11, switchedOn: true },
    ]);
  });

  it("counts a row with no on/off value as switched on", async () => {
    mockQuery.mockResolvedValue([sessionRow("q1", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "11", null)]);

    expect((await readPaperWindows(["q1"]))[0].switchedOn).toBe(true);
  });

  it("reports a quiz id whose rows are all switched off as switched off, with their window", async () => {
    mockQuery.mockResolvedValue([sessionRow("q1", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "11", false)]);

    expect(await readPaperWindows(["q1"])).toEqual([
      { quizId: "q1", opensAt: "2026-10-05T23:30:00.000Z", closesAt: "2026-10-10T18:25:00.000Z", grade: 11, switchedOn: false },
    ]);
  });

  it("leaves a missing or unreadable time and a missing or non-whole grade empty", async () => {
    mockQuery.mockResolvedValue([
      sessionRow("q1", null, "not a time", " "),
      sessionRow("q2", "2026-10-06 05:00:00", null, "11.5"),
    ]);

    expect(await readPaperWindows(["q1", "q2"])).toEqual([
      { quizId: "q1", opensAt: null, closesAt: null, grade: null, switchedOn: true },
      { quizId: "q2", opensAt: "2026-10-05T23:30:00.000Z", closesAt: null, grade: null, switchedOn: true },
    ]);
  });

  it("throws when the read fails", async () => {
    mockQuery.mockRejectedValue(new Error("statement timeout"));

    await expect(readPaperWindows(["q1"])).rejects.toThrow("statement timeout");
  });
});
