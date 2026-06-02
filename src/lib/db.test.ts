import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so these are available inside vi.mock factory
const mocks = vi.hoisted(() => ({
  mockRelease: vi.fn(),
  mockClientQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: vi.fn(function () {
    return { connect: mocks.mockConnect };
  }),
}));

beforeEach(() => {
  mocks.mockRelease.mockReset();
  mocks.mockClientQuery.mockReset();
  mocks.mockConnect.mockReset();
  mocks.mockConnect.mockResolvedValue({
    query: mocks.mockClientQuery,
    release: mocks.mockRelease,
  });
});

describe("query", () => {
  it("connects, queries, and releases client", async () => {
    mocks.mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: "test" }] });

    const { query } = await import("./db");
    const result = await query("SELECT * FROM users WHERE id = $1", [1]);

    expect(mocks.mockConnect).toHaveBeenCalled();
    expect(mocks.mockClientQuery).toHaveBeenCalledWith("SELECT * FROM users WHERE id = $1", [1]);
    expect(mocks.mockRelease).toHaveBeenCalled();
    expect(result).toEqual([{ id: 1, name: "test" }]);
  });

  it("returns result.rows", async () => {
    mocks.mockClientQuery.mockResolvedValueOnce({ rows: [{ a: 1 }, { a: 2 }] });

    const { query } = await import("./db");
    const result = await query("SELECT a FROM t");

    expect(result).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("releases client even on query error", async () => {
    mocks.mockClientQuery.mockRejectedValueOnce(new Error("SQL error"));

    const { query } = await import("./db");
    await expect(query("BAD SQL")).rejects.toThrow("SQL error");
    expect(mocks.mockRelease).toHaveBeenCalled();
  });

  it("works without params", async () => {
    mocks.mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const { query } = await import("./db");
    const result = await query("SELECT 1");

    expect(mocks.mockClientQuery).toHaveBeenCalledWith("SELECT 1", undefined);
    expect(result).toEqual([]);
  });
});

describe("withTransaction", () => {
  it("commits on success, returns the callback value, and releases the client", async () => {
    mocks.mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { withTransaction } = await import("./db");
    const result = await withTransaction(async (client) => {
      expect(client.query).toBe(mocks.mockClientQuery);
      return "saved";
    });

    expect(result).toBe("saved");
    expect(mocks.mockClientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.mockClientQuery).toHaveBeenNthCalledWith(2, "COMMIT");
    expect(mocks.mockRelease).toHaveBeenCalledTimes(1);
  });

  it("rolls back on callback error and releases the client", async () => {
    mocks.mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { withTransaction } = await import("./db");
    await expect(
      withTransaction(async () => {
        throw new Error("insert failed");
      })
    ).rejects.toThrow("insert failed");

    expect(mocks.mockClientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.mockClientQuery).toHaveBeenNthCalledWith(2, "ROLLBACK");
    expect(mocks.mockRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects nested transactions", async () => {
    mocks.mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { withTransaction } = await import("./db");
    await expect(
      withTransaction(() => withTransaction(async () => "nested"))
    ).rejects.toThrow("Nested transactions are not supported");

    expect(mocks.mockConnect).toHaveBeenCalledTimes(1);
    expect(mocks.mockClientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.mockClientQuery).toHaveBeenNthCalledWith(2, "ROLLBACK");
    expect(mocks.mockRelease).toHaveBeenCalledTimes(1);
  });
});
