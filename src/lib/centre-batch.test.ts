import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  batchesForCentre,
  userCanAccessCentre,
  centresForUserList,
} from "./centre-batch";
import type { UserPermission } from "./permissions";

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

function withCentres(centres: Set<number> | "all" | undefined): UserPermission {
  return {
    email: "t@x.org",
    level: 1,
    role: "teacher",
    scope: centres === undefined ? undefined : { schools: "all", centres, programs: "all" },
  } as UserPermission;
}

describe("userCanAccessCentre", () => {
  it("grants when the centre is in the user's seat set", () => {
    expect(userCanAccessCentre(withCentres(new Set([11, 12])), 11)).toBe(true);
  });

  it("denies when the centre is not in the set", () => {
    expect(userCanAccessCentre(withCentres(new Set([11, 12])), 99)).toBe(false);
  });

  it("grants everything for admins (centres === 'all')", () => {
    expect(userCanAccessCentre(withCentres("all"), 12345)).toBe(true);
  });

  it("denies when there is no resolved scope", () => {
    expect(userCanAccessCentre(withCentres(undefined), 11)).toBe(false);
  });
});

describe("batchesForCentre", () => {
  it("queries centre_batch for active links and returns the rows", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 11, name: "Class 11", batch_id: "B_11", parent_id: 5, program_id: 1 },
    ] as never);

    const rows = await batchesForCentre(42);

    expect(rows).toEqual([
      { id: 11, name: "Class 11", batch_id: "B_11", parent_id: 5, program_id: 1 },
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM centre_batch cb");
    expect(sql).toContain("cb.deleted_at IS NULL");
    expect(params).toEqual([42]);
  });
});

describe("centresForUserList", () => {
  it("returns [] for an empty seat set without querying", async () => {
    const rows = await centresForUserList(new Set());
    expect(rows).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("passes scopeAll=true and empty ids for admins", async () => {
    mockQuery.mockResolvedValueOnce([] as never);
    await centresForUserList("all");
    expect(mockQuery.mock.calls[0][1]).toEqual([true, []]);
  });

  it("passes scopeAll=false and the seat ids for a seated user", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 11, name: "JNV Vaishali CoE", school_name: "JNV Vaishali", batch_count: 1 },
    ] as never);

    const rows = await centresForUserList(new Set([11, 99]));

    expect(rows).toHaveLength(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe(false);
    expect(params[1]).toEqual(expect.arrayContaining([11, 99]));
  });
});
