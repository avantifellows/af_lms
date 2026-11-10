import { beforeEach, describe, expect, it, vi } from "vitest";

const pg = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ query: pg }));

import { getRetestSessionIds } from "./quiz-session-retests";

describe("getRetestSessionIds", () => {
  beforeEach(() => pg.mockReset());

  it("reads the flagged sessions among the given ids, once each", async () => {
    pg.mockResolvedValue([{ session_id: "re" }]);
    const ids = await getRetestSessionIds(["mt3", "re", "re", ""]);
    expect([...ids]).toEqual(["re"]);
    const [sql, params] = pg.mock.calls[0];
    expect(sql).toContain("meta_data->>'is_retest' = 'true'");
    expect(params).toEqual([["mt3", "re"]]);
  });

  it("skips the read with no sessions", async () => {
    expect((await getRetestSessionIds([])).size).toBe(0);
    expect(pg).not.toHaveBeenCalled();
  });
});
