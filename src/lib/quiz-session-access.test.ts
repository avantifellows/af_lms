import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./lms-programs", () => ({ getLmsSupportedProgramIds: vi.fn() }));

import { query } from "./db";
import { getLmsSupportedProgramIds } from "./lms-programs";
import { resolveBatchGroups, resolveQuizSessionProgramIds } from "./quiz-session-access";
import type { UserPermission } from "./permissions";

const mockQuery = vi.mocked(query);
const mockLmsPrograms = vi.mocked(getLmsSupportedProgramIds);

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

describe("resolveQuizSessionProgramIds", () => {
  const permission = (over: Partial<UserPermission>): UserPermission =>
    ({
      id: 1,
      email: "u@avantifellows.org",
      full_name: "U",
      level: 1,
      role: "teacher",
      school_codes: null,
      regions: null,
      program_ids: [],
      read_only: false,
      ...over,
    }) as UserPermission;

  // deepansh's case: seated at EMRS Bhopal CoE, seat grants program 78, but the
  // permission row lists only [1]. Reading the row gave 0 batches and 0 sessions
  // on a centre with 8 batches and 91 sessions.
  it("includes a program the caller only holds through a centre seat", async () => {
    const ids = await resolveQuizSessionProgramIds(
      permission({
        program_ids: [1],
        scope: { schools: new Set(["X"]), centres: new Set([3]), programs: new Set([78]) },
      })
    );

    expect(ids).toContain(78);
    expect(mockLmsPrograms).not.toHaveBeenCalled();
  });

  // surya's case: an admin row of [1, 2, 64] made every non-JNV centre page look
  // empty. An admin is not limited to their row.
  it("gives an admin every LMS-supported program, not their row", async () => {
    mockLmsPrograms.mockResolvedValue([1, 2, 64, 74, 78, 88]);

    const ids = await resolveQuizSessionProgramIds(
      permission({ role: "admin", program_ids: [1, 2, 64] })
    );

    expect(ids).toEqual([1, 2, 64, 74, 78, 88]);
  });

  it("falls back to the explicit programs for a seatless non-admin", async () => {
    const ids = await resolveQuizSessionProgramIds(
      permission({ program_ids: [1, 2] })
    );

    expect(ids).toEqual([1, 2]);
    expect(mockLmsPrograms).not.toHaveBeenCalled();
  });
});
