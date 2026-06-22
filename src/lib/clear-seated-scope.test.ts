import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import { runClearSeatedScope } from "./clear-seated-scope";

const mockQuery = vi.mocked(query);

beforeEach(() => {
  mockQuery.mockReset();
});

const SEATED_ROWS = [
  // fully seat-covered: single-school teacher → clean per-user
  {
    user_id: "10",
    email: "teacher@af.org",
    school_codes: ["70705"],
    regions: null,
    seat_school_codes: ["70705"],
  },
  // partially covered: PM seated at 1 of 2 schools → "99999" is stranded
  {
    user_id: "20",
    email: "pm@af.org",
    school_codes: ["70705", "99999"],
    regions: null,
    seat_school_codes: ["70705"],
  },
];

describe("runClearSeatedScope", () => {
  it("dry-run reports who would be cleared + stranded, and issues NO update", async () => {
    mockQuery.mockResolvedValueOnce(SEATED_ROWS);

    const report = await runClearSeatedScope({ mode: "dry-run" });

    expect(mockQuery).toHaveBeenCalledTimes(1); // read only, no UPDATE
    expect(report.mode).toBe("dry-run");
    expect(report.usersWithExplicitScope).toBe(2);
    expect(report.usersCleared).toBe(2); // would-clear count
    expect(report.strandedUsers.map((u) => u.email)).toEqual(["pm@af.org"]);
    expect(report.strandedUsers[0].uncoveredCodes).toEqual(["99999"]);
  });

  it("apply issues the bulk clear and reports the RETURNING count", async () => {
    mockQuery
      .mockResolvedValueOnce(SEATED_ROWS) // read
      .mockResolvedValueOnce([{ user_id: 10 }, { user_id: 20 }]); // UPDATE ... RETURNING

    const report = await runClearSeatedScope({ mode: "apply" });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const updateSql = mockQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain("UPDATE user_permission");
    expect(updateSql).toContain("SET school_codes = NULL, regions = NULL");
    expect(report.usersCleared).toBe(2);
    expect(report.strandedUsers).toHaveLength(1);
  });

  it("is idempotent: no seated users with explicit scope → no UPDATE", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        user_id: "10",
        email: "teacher@af.org",
        school_codes: null,
        regions: null,
        seat_school_codes: ["70705"],
      },
    ]);

    const report = await runClearSeatedScope({ mode: "apply" });

    expect(mockQuery).toHaveBeenCalledTimes(1); // read only — nothing to clear
    expect(report.usersWithExplicitScope).toBe(0);
    expect(report.usersCleared).toBe(0);
    expect(report.strandedUsers).toHaveLength(0);
  });

  it("skips seated users whose seats cover no school (would-be-empty), issuing NO update", async () => {
    mockQuery.mockResolvedValueOnce([
      // seated only at an unlinked (school-less) centre → seat covers nothing
      {
        user_id: "40",
        email: "unlinked@af.org",
        school_codes: ["84082"],
        regions: null,
        seat_school_codes: null,
      },
    ]);

    const report = await runClearSeatedScope({ mode: "apply" });

    expect(mockQuery).toHaveBeenCalledTimes(1); // read only — nothing clearable
    expect(report.usersWithExplicitScope).toBe(1);
    expect(report.usersCleared).toBe(0);
    expect(report.skippedWouldBeEmpty.map((u) => u.email)).toEqual([
      "unlinked@af.org",
    ]);
    expect(report.strandedUsers).toHaveLength(0); // not cleared → not stranded
  });

  it("treats regions-only seated users as needing a clear", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          user_id: "30",
          email: "region@af.org",
          school_codes: null,
          regions: ["West"],
          seat_school_codes: ["70705"],
        },
      ])
      .mockResolvedValueOnce([{ user_id: 30 }]);

    const report = await runClearSeatedScope({ mode: "apply" });

    expect(report.usersWithExplicitScope).toBe(1);
    expect(report.usersCleared).toBe(1);
    expect(report.strandedUsers).toHaveLength(0); // no school_codes → nothing uncovered
  });
});
