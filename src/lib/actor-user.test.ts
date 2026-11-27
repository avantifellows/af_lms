import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { actorUserId } from "./actor-user";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("actorUserId", () => {
  it.each([42, "42"])("uses the permission's linked User (%j) without a lookup", async (linked) => {
    expect(await actorUserId("t@avantifellows.org", linked)).toBe(42);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([null, undefined])("falls back to the lowest-id User with the same email, case-insensitively (%s)", async (linked) => {
    mockQuery.mockResolvedValue([{ id: "88" }]);

    expect(await actorUserId("T@avantifellows.org", linked)).toBe(88);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("LOWER(email) = LOWER($1)");
    expect(sql).toContain("ORDER BY id LIMIT 1");
    expect(params).toEqual(["T@avantifellows.org"]);
  });

  it("is null when no User has that email", async () => {
    mockQuery.mockResolvedValue([]);

    expect(await actorUserId("t@avantifellows.org", null)).toBeNull();
  });
});
