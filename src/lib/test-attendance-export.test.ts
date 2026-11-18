import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { testAttendanceSheet } from "./test-attendance-export";
import type { TestAttendanceMonthlyTest, TestAttendanceStudent } from "@/types/test-attendance";
import { ALL_STUDENTS, DEFAULT_MONTH_FILTER } from "./test-attendance-rules";

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

// Each Student's own tag window (#517). Grade 12 had no Paper in October, so a
// Grade 12 Student's last 3 counted tests are Aug, Sep and Nov.
describe("testAttendanceSheet across a skipped month", () => {
  const test = (key: string, name: string, grades = [11, 12], state: "closed" | "running" = "closed") => ({
    ...monthlyTest(name),
    key,
    shortName: name.slice(0, 3),
    grades,
    state,
  });
  const monthlyTests = [
    test("august", "August"),
    test("september", "September"),
    test("october", "October", [11]),
    test("november", "November"),
    test("december", "December", [11, 12], "running"),
  ];
  const student = (userId: string, name: string, grade: number, attendance: TestAttendanceStudent["attendance"]) => ({
    userId,
    name,
    studentId: `NVS${userId}`,
    grade,
    examPreparingFor: "Engineering" as const,
    attendance: { ...attendance, december: "not_opened" as const },
  });
  const students = [
    student("1", "Gita Rao", 12, { august: "not_opened", september: "not_opened", november: "submitted" }),
    student("2", "Hari Sen", 11, { august: "not_opened", september: "submitted", october: "submitted", november: "opened" }),
  ];
  const sheet = (period: string, list: string) =>
    testAttendanceSheet({ monthlyTests, students }, { period, filters: ALL_STUDENTS, list: list as never })!;

  it("gives the All year sheet the union of the Students' windows as columns, blank outside a Student's window", () => {
    const { header, rows } = sheet("all", "all");
    expect(header).toEqual([
      "Student Name", "Student ID", "Grade", "Exam Preparing For", "Aug", "Sep", "Oct", "Nov", "Attended", "Tag", "Follow-up",
    ]);
    expect(rows).toEqual([
      ["Gita Rao", "NVS1", 12, "Engineering", "Absent", "Absent", "", "Submitted", "1 of 3 (33%)", "Follow up", "Missed Aug, Sep · attended Nov"],
      ["Hari Sen", "NVS2", 11, "Engineering", "", "Submitted", "Submitted", "Opened, not submitted", "3 of 3 (100%)", "", "Not submitted Nov"],
    ]);
  });

  it("takes the columns from the rows in the list", () => {
    expect(sheet("all", "follow_up").header.slice(4, -3)).toEqual(["Aug", "Sep", "Nov"]);
  });

  it("gives the month sheet's Previous 3 tests each Student's own earlier counted tests", () => {
    expect(sheet("december", "all").rows.map((row) => [row[0], row[5]])).toEqual([
      ["Hari Sen", "Not submitted Nov"],
      ["Gita Rao", "Missed Aug, Sep · attended Nov"],
    ]);
  });
});
