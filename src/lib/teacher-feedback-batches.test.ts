import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => mockQuery(...args) }));

import {
  centreOwnsAllBatches,
  getBatchesForCentre,
  getCentreScope,
} from "./teacher-feedback-batches";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getCentreScope", () => {
  it("coerces bigint columns that node-pg returns as strings", async () => {
    // centres.id / school_id / program_id are bigints, so pg hands back strings.
    // Leaving them as strings makes later `===` comparisons silently false.
    mockQuery.mockResolvedValueOnce([{ id: "38", school_id: "393", program_id: "1" }]);
    const scope = await getCentreScope(38);
    expect(scope).toEqual({ centreId: 38, schoolId: 393, programId: 1 });
  });

  it("returns null for a missing or inactive centre", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await getCentreScope(999)).toBeNull();
  });

  it("returns null for a centre with no school (online / city centres)", async () => {
    mockQuery.mockResolvedValueOnce([{ id: "29", school_id: null, program_id: null }]);
    expect(await getCentreScope(29)).toBeNull();
  });

  it("keeps a null programme as null rather than coercing to 0", async () => {
    // Number(null) is 0, which is a real-looking program id — it must stay null
    // so getBatchesForCentre can fail closed.
    mockQuery.mockResolvedValueOnce([{ id: "16", school_id: "336", program_id: null }]);
    expect(await getCentreScope(16)).toEqual({
      centreId: 16,
      schoolId: 336,
      programId: null,
    });
  });
});

describe("getBatchesForCentre", () => {
  it("scopes batches to the centre's school AND programme", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 1008, name: "CoE JNV Chandrapur 2028 Engineering", batch_id: "ES_C008", parent_id: 958, program_id: 1 },
    ]);
    mockQuery.mockResolvedValueOnce([
      { id: 958, name: "JNV CoE 2028 Engineering Quiz Batch", batch_id: "EN-TP-2028-engg-C01", parent_id: null, program_id: 1 },
    ]);

    const batches = await getBatchesForCentre({ centreId: 38, schoolId: 393, programId: 1 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("sb.school_id = $1");
    expect(sql).toContain("b.program_id = $2");
    expect(params).toEqual([393, 1]);
    // Parent batch is pulled in so the picker can tell class batches apart.
    expect(batches.map((b) => b.id)).toEqual([1008, 958]);
  });

  it("returns [] for a centre with no programme instead of every school batch", async () => {
    // The whole point: without a programme there is nothing to tell a school's
    // CoE cohort from its Nodal one, and listing both is the cross-centre leak.
    const batches = await getBatchesForCentre({
      centreId: 16,
      schoolId: 336,
      programId: null,
    });
    expect(batches).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("casts the parent lookup to bigint[], matching batch.id", async () => {
    // batch.id and session.id are bigints; an ::int[] cast throws
    // "integer out of range" once an id exceeds 2^31. Plenty of headroom today,
    // but the cast should agree with the column type.
    mockQuery.mockResolvedValueOnce([
      { id: 1008, name: "b", batch_id: "B", parent_id: 958, program_id: 1 },
    ]);
    mockQuery.mockResolvedValueOnce([]);
    await getBatchesForCentre({ centreId: 38, schoolId: 393, programId: 1 });
    expect(mockQuery.mock.calls[1][0]).toContain("::bigint[]");
  });

  it("skips the parent lookup when no parents are missing", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 958, name: "Parent", batch_id: "P1", parent_id: null, program_id: 1 },
    ]);
    await getBatchesForCentre({ centreId: 38, schoolId: 393, programId: 1 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("centreOwnsAllBatches", () => {
  it("accepts a selection wholly inside the centre's cohort", async () => {
    mockQuery.mockResolvedValueOnce([{ batch_id: "A" }, { batch_id: "B" }]);
    expect(
      await centreOwnsAllBatches({ centreId: 38, schoolId: 393, programId: 1 }, ["A", "B"])
    ).toBe(true);
  });

  it("rejects a selection mixing a valid batch with a foreign one", async () => {
    // The crafted-payload case: "A" is in scope, "NODAL_X" is another centre's.
    // An EXISTS-style check would pass this and surface the form to the wrong
    // students, so every id must match.
    mockQuery.mockResolvedValueOnce([{ batch_id: "A" }]);
    expect(
      await centreOwnsAllBatches({ centreId: 38, schoolId: 393, programId: 1 }, [
        "A",
        "NODAL_X",
      ])
    ).toBe(false);
  });

  it("rejects an empty selection", async () => {
    expect(
      await centreOwnsAllBatches({ centreId: 38, schoolId: 393, programId: 1 }, [])
    ).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects everything when the centre has no programme", async () => {
    expect(
      await centreOwnsAllBatches({ centreId: 16, schoolId: 336, programId: null }, ["A"])
    ).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("filters on school, programme and the submitted ids together", async () => {
    mockQuery.mockResolvedValueOnce([{ batch_id: "A" }]);
    await centreOwnsAllBatches({ centreId: 38, schoolId: 393, programId: 2 }, ["A"]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("sb.school_id = $1");
    expect(sql).toContain("b.program_id = $2");
    expect(sql).toContain("b.batch_id = ANY($3::text[])");
    expect(params).toEqual([393, 2, ["A"]]);
  });
});
