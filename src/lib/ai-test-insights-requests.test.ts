import { beforeEach, describe, expect, it, vi } from "vitest";

// The Insight Request module's reads (#560) with the Postgres boundary
// stubbed: each read asks for one Student's rows and returns the one view
// shape. Creating a request is covered through the create route's tests.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery, withTransaction: vi.fn() }));

import { insightRequestAsShown, latestRequest, requestByKey, resolveActorUserId } from "./ai-test-insights-requests";

const ROW = {
  request_key: "key-1",
  state: "completed",
  outcome_code: null,
  selected_test_ids: ["T9", "T4"],
  requested_at: "2026-11-27T05:30:00Z",
  requested_by_name: "Asha Teacher",
  finished_at: "2026-11-27T05:34:10Z",
  read_at: "2026-11-27T06:00:00Z",
};

const VIEW = {
  requestKey: "key-1",
  state: "completed",
  outcomeCode: null,
  selectedTestIds: ["T9", "T4"],
  requestedAt: "2026-11-27T05:30:00Z",
  requestedByName: "Asha Teacher",
  finishedAt: "2026-11-27T05:34:10Z",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("latestRequest", () => {
  it("returns the Student's newest request in the view shape", async () => {
    mockQuery.mockResolvedValue([ROW]);

    expect(await latestRequest(1001)).toEqual(VIEW);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([1001]);
    expect(sql).toMatch(/ORDER BY r\.requested_at DESC, r\.id DESC\s+LIMIT 1/);
  });

  it("returns null when the Student has no request", async () => {
    mockQuery.mockResolvedValue([]);

    expect(await latestRequest(1001)).toBeNull();
  });
});

describe("requestByKey", () => {
  it("looks the key up within the Student's own requests", async () => {
    mockQuery.mockResolvedValue([ROW]);

    expect(await requestByKey(1001, "key-1")).toEqual(VIEW);
    expect(mockQuery.mock.calls[0][1]).toEqual([1001, "key-1"]);
  });

  it("returns null for a key that is not that Student's", async () => {
    mockQuery.mockResolvedValue([]);

    expect(await requestByKey(1001, "someone-elses")).toBeNull();
  });
});

describe("resolveActorUserId", () => {
  it("uses the permission's linked User without a lookup", async () => {
    expect(await resolveActorUserId({ email: "t@avantifellows.org", linkedUserId: 42 })).toBe(42);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("falls back to the User with the same email, case-insensitively", async () => {
    mockQuery.mockResolvedValue([{ id: "88" }]);

    expect(await resolveActorUserId({ email: "T@avantifellows.org", linkedUserId: null })).toBe(88);
    expect(mockQuery.mock.calls[0][0]).toContain("LOWER(email) = LOWER($1)");
  });

  it("is null when no User has that email", async () => {
    mockQuery.mockResolvedValue([]);

    expect(await resolveActorUserId({ email: "t@avantifellows.org", linkedUserId: null })).toBeNull();
  });
});

describe("insightRequestAsShown, the stall rule", () => {
  // The test's own UTC clock: the request was made at 05:30:00Z.
  const made = { ...VIEW, state: "queued" as const, finishedAt: null, requestedAt: "2026-11-27T05:30:00Z" };

  it.each(["queued", "running"] as const)("keeps a %s request in progress one second under 20 minutes", (state) => {
    expect(insightRequestAsShown({ ...made, state }, new Date("2026-11-27T05:49:59Z"))).toEqual({ ...made, state });
  });

  it.each(["queued", "running"] as const)("reads a %s request failed with timed_out at exactly 20 minutes", (state) => {
    expect(insightRequestAsShown({ ...made, state }, new Date("2026-11-27T05:50:00Z"))).toEqual({
      ...made,
      state: "failed",
      outcomeCode: "timed_out",
    });
  });

  it("reads a request made hours ago failed with timed_out", () => {
    expect(insightRequestAsShown({ ...made, state: "running" }, new Date("2026-11-27T09:00:00Z"))).toMatchObject({
      state: "failed",
      outcomeCode: "timed_out",
    });
  });

  it.each([
    ["completed", null],
    ["no_data", "missing_category_for_cutoff"],
    ["failed", "interrupted"],
  ] as const)("never changes a %s request", (state, outcomeCode) => {
    const ended = { ...made, state, outcomeCode, finishedAt: "2026-11-27T05:58:00Z" };

    expect(insightRequestAsShown(ended, new Date("2026-11-27T09:00:00Z"))).toEqual(ended);
  });
});

describe("every read applies the stall rule against the database's UTC clock", () => {
  it("reads a queued request made 20 minutes before the database's now as failed with timed_out", async () => {
    mockQuery.mockResolvedValue([{ ...ROW, state: "queued", finished_at: null, read_at: "2026-11-27T05:50:00Z" }]);

    expect(await latestRequest(1001)).toEqual({ ...VIEW, state: "failed", outcomeCode: "timed_out", finishedAt: null });
    expect(mockQuery.mock.calls[0][0]).toContain("(now() AT TIME ZONE 'UTC')");
  });

  it("reads a running request made under 20 minutes before the database's now as running", async () => {
    mockQuery.mockResolvedValue([{ ...ROW, state: "running", finished_at: null, read_at: "2026-11-27T05:49:59Z" }]);

    expect(await requestByKey(1001, "key-1")).toEqual({ ...VIEW, state: "running", finishedAt: null });
  });

  it("reads the clock rounded to the second, as requested_at (timestamp(0)) is stored", async () => {
    // A request read in the second it was made is 0 seconds old, never -1, so
    // one back-dated by exactly 20 minutes reads as stalled at once.
    mockQuery.mockResolvedValue([]);

    await latestRequest(1001);

    expect(mockQuery.mock.calls[0][0]).toContain("(now() AT TIME ZONE 'UTC')::timestamp(0)");
  });

  it("asks only for the view, never changing the row", async () => {
    mockQuery.mockResolvedValue([{ ...ROW, state: "queued", finished_at: null, read_at: "2026-11-27T07:00:00Z" }]);

    await latestRequest(1001);
    await requestByKey(1001, "key-1");

    for (const [sql] of mockQuery.mock.calls) expect(sql).not.toMatch(/UPDATE|INSERT/);
  });
});
