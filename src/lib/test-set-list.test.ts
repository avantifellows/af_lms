import { beforeEach, describe, expect, it, vi } from "vitest";

// The NVS Monthly Test reader with its one edge stubbed: the Postgres `query()`.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { academicYearBounds, getNvsTestSets, testSetsFrom } from "./test-set-list";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getNvsTestSets", () => {
  it("reads switched-on Grade 11 and 12 mandated NVS sessions of the current academic year", async () => {
    mockQuery.mockResolvedValue([]);
    await getNvsTestSets();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("meta_data->>'test_purpose' = $1");
    expect(sql).toContain("meta_data->>'group' = $2");
    expect(sql).toContain("meta_data->>'grade' = ANY($3::text[])");
    expect(sql).toContain("is_active = true");
    expect(sql).toContain("start_time >= $4::timestamp");
    expect(sql).toContain("start_time < $5::timestamp");
    expect(sql).toContain("ORDER BY start_time");
    expect(params).toEqual([
      "system_wide_mandated",
      "EnableStudents",
      ["11", "12"],
      "2026-04-01 00:00:00",
      "2027-04-01 00:00:00",
    ]);
  });

  it("groups the Papers into Monthly Tests named after their start month, oldest first", async () => {
    mockQuery.mockResolvedValue([
      { platform_id: "jul-g12", month: "2026-07" },
      { platform_id: "aug-g12", month: "2026-08" },
      { platform_id: "aug-g11", month: "2026-08" },
      { platform_id: "sep-g12", month: "2026-09" },
    ]);
    expect(await getNvsTestSets()).toEqual([
      { label: "July", quizIds: ["jul-g12"] },
      { label: "August", quizIds: ["aug-g12", "aug-g11"] },
      { label: "September", quizIds: ["sep-g12"] },
    ]);
  });

  it("returns an empty list when no session matches", async () => {
    mockQuery.mockResolvedValue([]);
    expect(await getNvsTestSets()).toEqual([]);
  });

  it("throws when the session read fails", async () => {
    mockQuery.mockRejectedValue(new Error("connection refused"));
    await expect(getNvsTestSets()).rejects.toThrow("connection refused");
  });
});

describe("testSetsFrom", () => {
  it("puts a quiz id with rows in two months only in the earlier one", () => {
    expect(
      testSetsFrom([
        { platform_id: "q1", month: "2026-09" },
        { platform_id: "q2", month: "2026-09" },
        { platform_id: "q1", month: "2026-10" },
      ]),
    ).toEqual([{ label: "September", quizIds: ["q1", "q2"] }]);
  });

  it("trims quiz ids and skips empty ones", () => {
    expect(
      testSetsFrom([
        { platform_id: " q1 ", month: "2026-07" },
        { platform_id: "  ", month: "2026-07" },
      ]),
    ).toEqual([{ label: "July", quizIds: ["q1"] }]);
  });

  it("orders January to March after the months of the year before", () => {
    expect(
      testSetsFrom([
        { platform_id: "jan", month: "2027-01" },
        { platform_id: "dec", month: "2026-12" },
      ]).map((set) => set.label),
    ).toEqual(["December", "January"]);
  });
});

describe("academicYearBounds", () => {
  it("runs from 1 April to the next 1 April, as IST wall clock", () => {
    expect(academicYearBounds("2026-2027")).toEqual({ from: "2026-04-01 00:00:00", to: "2027-04-01 00:00:00" });
  });

  it.each(["2026", "2026-2028", "26-27", ""])("rejects %j", (year) => {
    expect(() => academicYearBounds(year)).toThrow("Unexpected academic year");
  });
});
