import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { PROGRAM_IDS, PROGRAM_IDS_ORDERED } from "@/lib/constants";
import {
  getLmsSupportedProgramIds,
  resetLmsSupportedProgramIdsCache,
} from "@/lib/lms-programs";

beforeEach(() => {
  vi.clearAllMocks();
  resetLmsSupportedProgramIdsCache();
});

describe("getLmsSupportedProgramIds", () => {
  it("keeps NVS, which has no centres row — the reason this is a union and not a replacement", async () => {
    // A pure centres-derived list would drop 64 and hide every NVS student
    // from the Enrollment tab.
    mockQuery.mockResolvedValueOnce([{ program_id: 1 }, { program_id: 78 }]);
    const ids = await getLmsSupportedProgramIds();
    expect(ids).toContain(PROGRAM_IDS.NVS);
  });

  it("appends centre programs that aren't compiled in, so a newly onboarded program needs no code edit (D22c)", async () => {
    mockQuery.mockResolvedValueOnce([
      { program_id: 1 },
      { program_id: 101 },
      { program_id: 102 },
    ]);
    const ids = await getLmsSupportedProgramIds();
    expect(ids).toEqual([...PROGRAM_IDS_ORDERED, 101, 102]);
  });

  it("preserves canonical order and sorts the DB-only extras by id", async () => {
    mockQuery.mockResolvedValueOnce([{ program_id: 300 }, { program_id: 200 }]);
    const ids = await getLmsSupportedProgramIds();
    expect(ids.slice(0, PROGRAM_IDS_ORDERED.length)).toEqual(PROGRAM_IDS_ORDERED);
    expect(ids.slice(PROGRAM_IDS_ORDERED.length)).toEqual([200, 300]);
  });

  it("is a no-op when every centre program is already compiled in", async () => {
    mockQuery.mockResolvedValueOnce(
      PROGRAM_IDS_ORDERED.map((id) => ({ program_id: id })),
    );
    await expect(getLmsSupportedProgramIds()).resolves.toEqual(PROGRAM_IDS_ORDERED);
  });

  it("coerces bigint program_id strings pg hands back, and never duplicates", async () => {
    mockQuery.mockResolvedValueOnce([
      { program_id: "1" },
      { program_id: "97" },
      { program_id: "97" },
    ]);
    const ids = await getLmsSupportedProgramIds();
    expect(ids.filter((id) => id === PROGRAM_IDS.KARNATAKA_COE)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to the compiled-in list when the centres read fails, rather than emptying the roster", async () => {
    mockQuery.mockRejectedValueOnce(new Error("pg down"));
    await expect(getLmsSupportedProgramIds()).resolves.toEqual(PROGRAM_IDS_ORDERED);
  });

  it("does not cache a failure — the next call retries", async () => {
    mockQuery.mockRejectedValueOnce(new Error("transient"));
    await getLmsSupportedProgramIds();
    mockQuery.mockResolvedValueOnce([{ program_id: 101 }]);
    await expect(getLmsSupportedProgramIds()).resolves.toEqual([
      ...PROGRAM_IDS_ORDERED,
      101,
    ]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("caches a success — the centres read happens once", async () => {
    mockQuery.mockResolvedValueOnce([{ program_id: 101 }]);
    await getLmsSupportedProgramIds();
    await getLmsSupportedProgramIds();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("skips the stray centre row that has no program", async () => {
    mockQuery.mockResolvedValueOnce([{ program_id: 97 }, { program_id: null }]);
    const ids = await getLmsSupportedProgramIds();
    expect(ids).not.toContain(NaN);
    expect(ids.every((id) => Number.isFinite(id))).toBe(true);
  });
});

describe("PROGRAM_IDS registration", () => {
  it("carries the three centre programs that were live in prod but unregistered", async () => {
    // GPUC Shimoga (97) rendered an empty Enrollment tab because of this;
    // 99/100 are the same bug latent on the Maharashtra coaching centres.
    expect(PROGRAM_IDS.KARNATAKA_COE).toBe(97);
    expect(PROGRAM_IDS.MAHARASHTRA_COACHING_TESTPREP).toBe(99);
    expect(PROGRAM_IDS.MAHARASHTRA_COACHING_FOUNDATION).toBe(100);
  });

  it("gives each program a label, since PROGRAM_ID_TO_LABEL feeds the BigQuery student_program lookup", async () => {
    const { PROGRAM_ID_TO_LABEL } = await import("@/lib/constants");
    for (const id of PROGRAM_IDS_ORDERED) {
      expect(PROGRAM_ID_TO_LABEL[id], `label missing for program ${id}`).toBeTruthy();
    }
    // Must match program.name in Postgres / student_program in BigQuery.
    expect(PROGRAM_ID_TO_LABEL[97]).toBe("Karnataka CoE");
  });
});
