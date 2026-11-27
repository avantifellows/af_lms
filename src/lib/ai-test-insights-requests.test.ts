import { beforeEach, describe, expect, it, vi } from "vitest";

// The Insight Request module's reads (#560) with the Postgres boundary
// stubbed: each read asks for one Student's rows and returns the one view
// shape. Creating a request is covered through the create route's tests.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery, withTransaction: vi.fn() }));

import { latestRequest, requestByKey, resolveActorUserId } from "./ai-test-insights-requests";

const ROW = {
  request_key: "key-1",
  state: "completed",
  outcome_code: null,
  selected_test_ids: ["T9", "T4"],
  requested_at: "2026-11-27T05:30:00Z",
  requested_by_name: "Asha Teacher",
  finished_at: "2026-11-27T05:34:10Z",
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
