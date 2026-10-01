import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { getCmsTestLanguages } from "./cms-test-languages";

const mockQuery = vi.mocked(query);

describe("getCmsTestLanguages", () => {
  beforeEach(() => mockQuery.mockReset());

  it("groups regional languages by test id", async () => {
    mockQuery.mockResolvedValue([
      { test_id: "10248", code: "hi", name: "Hindi" },
      { test_id: "10248", code: "ta", name: "Tamil" },
      { test_id: 9535, code: "hi", name: "Hindi" },
    ]);

    const result = await getCmsTestLanguages([10248, 9535, 4]);

    expect(mockQuery.mock.calls[0][1]).toEqual([[10248, 9535, 4]]);
    expect(result.get(10248)).toEqual([
      { code: "hi", name: "Hindi" },
      { code: "ta", name: "Tamil" },
    ]);
    expect(result.get(9535)).toEqual([{ code: "hi", name: "Hindi" }]);
    expect(result.get(4)).toBeUndefined();
  });

  it("skips the query for no tests", async () => {
    expect((await getCmsTestLanguages([])).size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
