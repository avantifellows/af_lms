import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import { resolveBatchGroups } from "./quiz-session-access";

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("resolveBatchGroups", () => {
  it("maps each batch to its auth_group name + auth_type via the FK", async () => {
    mockQuery.mockResolvedValueOnce([
      { batch_id: "EMRSStudents_11_Alpha_Eng_25_C001", group: "EMRSStudents", auth_type: "ID,DOB" },
      { batch_id: "PunjabStudents_12_25_A001", group: "PunjabStudents", auth_type: "ID" },
    ] as never);

    const map = await resolveBatchGroups([
      "EMRSStudents_11_Alpha_Eng_25_C001",
      "PunjabStudents_12_25_A001",
    ]);

    expect(map.get("EMRSStudents_11_Alpha_Eng_25_C001")).toEqual({
      group: "EMRSStudents",
      authType: "ID,DOB",
    });
    expect(map.get("PunjabStudents_12_25_A001")).toEqual({
      group: "PunjabStudents",
      authType: "ID",
    });
  });

  it("resolves short-code batches whose prefix does NOT match the group name", async () => {
    // The whole point of using the FK: "EMRS-11-25-P01" would prefix-parse wrong.
    mockQuery.mockResolvedValueOnce([
      { batch_id: "EMRS-11-25-P01", group: "EMRSStudents", auth_type: "ID,DOB" },
      { batch_id: "AIS-11-A25", group: "AllIndiaStudents", auth_type: "ID,DOB" },
    ] as never);

    const map = await resolveBatchGroups(["EMRS-11-25-P01", "AIS-11-A25"]);
    expect(map.get("EMRS-11-25-P01")?.group).toBe("EMRSStudents");
    expect(map.get("AIS-11-A25")?.group).toBe("AllIndiaStudents");
  });

  it("defaults auth_type to ID when the auth_group lacks it", async () => {
    mockQuery.mockResolvedValueOnce([
      { batch_id: "SomeBatch_1", group: "SomeGroup", auth_type: null },
    ] as never);
    const map = await resolveBatchGroups(["SomeBatch_1"]);
    expect(map.get("SomeBatch_1")?.authType).toBe("ID");
  });

  it("omits batches with no auth_group row, and skips the query for an empty list", async () => {
    const empty = await resolveBatchGroups([]);
    expect(empty.size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();

    mockQuery.mockResolvedValueOnce([] as never); // no rows returned
    const none = await resolveBatchGroups(["UnknownBatch"]);
    expect(none.has("UnknownBatch")).toBe(false);
  });
});
