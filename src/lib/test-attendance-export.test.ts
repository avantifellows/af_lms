import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { testAttendanceSheet } from "./test-attendance-export";
import { ALL_STUDENTS, DEFAULT_MONTH_FILTER, type TestAttendanceMonthlyTest } from "./test-attendance-rules";

const monthlyTest = (name: string): TestAttendanceMonthlyTest => ({
  key: "test",
  name,
  shortName: name,
  opensAt: "2026-10-10T03:30:00.000Z",
  closesAt: "2026-10-12T12:30:00.000Z",
  state: "closed",
  grades: [11, 12],
});

const sheetNameFor = (label: string) =>
  testAttendanceSheet(
    { monthlyTests: [monthlyTest(label)], students: [] },
    { period: "test", filters: ALL_STUDENTS, list: DEFAULT_MONTH_FILTER },
  )?.name;

// The export route passes the sheet name straight to ExcelJS, which throws for
// a name it does not accept: that throw was a 500 for the whole download.
const acceptedByExcel = (name: string) => {
  expect(() => new ExcelJS.Workbook().addWorksheet(name)).not.toThrow();
};

describe("testAttendanceSheet sheet name", () => {
  it("keeps a plain Monthly Test label as it is", () => {
    expect(sheetNameFor("October")).toBe("October");
  });

  it.each([
    ["Nov/Dec", "Nov Dec"],
    ["Mock Test: Phase 1", "Mock Test Phase 1"],
    ["a*b?c\\d[e]f", "a b c d e f"],
  ])("replaces characters Excel does not allow in %j", (label, expected) => {
    const name = sheetNameFor(label)!;
    expect(name).toBe(expected);
    acceptedByExcel(name);
  });

  it("caps a long label at Excel's 31 characters", () => {
    const name = sheetNameFor("Monthly Test for Grade 11 and Grade 12 (October)")!;
    expect(name).toBe("Monthly Test for Grade 11 and G");
    expect(name).toHaveLength(31);
    acceptedByExcel(name);
  });

  it.each(["", "   ", "/ : /", "History", "''"])("falls back to a default name for %j", (label) => {
    const name = sheetNameFor(label)!;
    expect(name).toBe("Monthly Test");
    acceptedByExcel(name);
  });

  it("drops a single quote at either end, which Excel rejects", () => {
    const name = sheetNameFor("'Oct' ")!;
    expect(name).toBe("Oct");
    acceptedByExcel(name);
  });
});
