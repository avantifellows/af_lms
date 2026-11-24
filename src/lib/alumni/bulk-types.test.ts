import { describe, expect, it } from "vitest";
import { commonAnswers, distinctWarnings, readBulkRequest, readBulkTargets, type BulkResult } from "./bulk-types";

const target = (id: string, kind: "alumnus" | "pass-out" = "alumnus") => ({ kind, id });

describe("commonAnswers", () => {
  it("splits answers everyone shares from ones that differ or are partly filled", () => {
    const records = [
      { ug_status: "Studying", degree_ug: "BTech/BE", current_ctc: "" },
      { ug_status: "Studying", degree_ug: "BSc", current_ctc: "4" },
      { ug_status: " Studying " },
    ];
    expect(commonAnswers(records, ["ug_status", "degree_ug", "current_ctc", "pg_status"])).toEqual({
      total: 3,
      common: { ug_status: "Studying" },
      mixed: { degree_ug: 2, current_ctc: 1 },
    });
  });
});

describe("distinctWarnings", () => {
  it("lists each warning once across students", () => {
    const w = (id: string) => ({ id, field: "x", message: id, level: "confirm" }) as never;
    const results = [{ warnings: [w("a"), w("b")] }, { warnings: [w("a")] }, {}] as BulkResult[];
    expect(distinctWarnings(results).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("readBulkTargets", () => {
  it("needs 1..max valid students", () => {
    expect(readBulkTargets({ targets: [target("1"), target("2", "pass-out")] }, 5)).toEqual([target("1"), target("2", "pass-out")]);
    expect(readBulkTargets({ targets: [] }, 5)).toBe("Pick at least one student.");
    expect(readBulkTargets({ targets: [{ kind: "student", id: "1" }] }, 5)).toBe("Pick at least one student.");
    expect(readBulkTargets({ targets: [target("x")] }, 5)).toBe("Pick at least one student.");
    expect(readBulkTargets(null, 5)).toBe("Pick at least one student.");
    expect(readBulkTargets({ targets: [target("1"), target("2")] }, 1)).toBe("At most 1 students at a time.");
  });
});

describe("readBulkRequest", () => {
  it("keeps filled string answers, defaults to a dry run", () => {
    const req = readBulkRequest({ targets: [target("1")], values: { ug_status: "Studying", degree_ug: "  ", n: 4 } }, 5);
    expect(req).toEqual({
      targets: [target("1")],
      values: { ug_status: "Studying" },
      confirmed: [],
      overwrite: false,
      replace: [],
      dryRun: true,
    });
  });

  it("reads confirmations, overwrite, replace and a real save", () => {
    const req = readBulkRequest(
      { targets: [target("1")], values: {}, confirmed: ["w1", 2], overwrite: true, replace: ["degree_ug", null], dryRun: false },
      5,
    );
    expect(req).toMatchObject({ confirmed: ["w1"], overwrite: true, replace: ["degree_ug"], dryRun: false });
  });

  it("refuses bad values or students", () => {
    expect(readBulkRequest({ targets: [target("1")], values: [] }, 5)).toBe("Invalid values.");
    expect(readBulkRequest({ targets: [target("1")] }, 5)).toBe("Invalid values.");
    expect(readBulkRequest({ targets: [] }, 5)).toBe("Pick at least one student.");
  });
});
