import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { lookupCodes, searchBranches, searchColleges } from "./reference";

const mockQuery = vi.mocked(query);
const lastCall = () => {
  const [sql, params] = mockQuery.mock.calls.at(-1)!;
  return { sql: String(sql), params: params as string[] };
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue([]);
});

describe("searchColleges", () => {
  it("needs at least 2 characters and doesn't query before that", async () => {
    expect(await searchColleges(" a ")).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("matches every word, with % _ and \\ taken literally", async () => {
    await searchColleges("50%_off a\\b");
    expect(lastCall().params).toEqual(["50%_off a\\b", "%50\\%\\_off%", "%a\\\\b%"]);
    expect(lastCall().sql).toMatch(/name ILIKE \$2 OR college_id ILIKE \$2\) AND \(name ILIKE \$3/);
  });

  it("expands an abbreviation into its spelled-out words, or the abbreviation itself", async () => {
    await searchColleges("NIT surathkal");
    const { sql, params } = lastCall();
    expect(params).toEqual(["nit surathkal", "%nit%", "%national%", "%institute%", "%technology%", "%surathkal%"]);
    expect(sql).toContain("OR ((name ILIKE $3");
  });

  it("uses at most 5 words", async () => {
    await searchColleges("one two three four five six");
    expect(lastCall().params).toHaveLength(1 + 5);
  });

  it("returns tidy names with district and state", async () => {
    mockQuery.mockResolvedValue([{ college_id: "C-1", name: "  Govt  College ", district: "Adilabad", state: null }] as never);
    expect(await searchColleges("govt")).toEqual([{ code: "C-1", name: "Govt College", meta: "Adilabad" }]);
  });
});

describe("searchBranches", () => {
  it("searches name and code without college abbreviations", async () => {
    mockQuery.mockResolvedValue([{ branch_id: "CSIT013", name: "Computer Science" }] as never);
    expect(await searchBranches("nit")).toEqual([{ code: "CSIT013", name: "Computer Science", meta: "" }]);
    expect(lastCall().params).toEqual(["nit", "%nit%"]);
  });

  it("needs at least 2 characters", async () => {
    expect(await searchBranches("c")).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("lookupCodes", () => {
  it("doesn't query when there are no codes", async () => {
    const lookup = await lookupCodes([], []);
    expect(lookup.college.size + lookup.branch.size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("keeps colleges and branches apart, even when a code is in both tables", async () => {
    mockQuery.mockResolvedValue([
      { kind: "college", code: "ADMIN", id: "1", name: "IIIT Hyderabad" },
      { kind: "branch", code: "ADMIN", id: "1", name: "Administration" },
      { kind: "branch", code: "CSIT013", id: "13", name: "Computer Science" },
    ] as never);
    const lookup = await lookupCodes(["ADMIN"], ["ADMIN", "CSIT013"]);
    expect(lookup.college.get("ADMIN")).toEqual({ id: "1", name: "IIIT Hyderabad" });
    expect(lookup.college.has("CSIT013")).toBe(false);
    expect(lookup.branch.get("CSIT013")).toEqual({ id: "13", name: "Computer Science" });
    expect(lastCall().params).toEqual([["ADMIN"], ["ADMIN", "CSIT013"]]);
  });
});
