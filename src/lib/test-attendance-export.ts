// Test Attendance export (#517): the list on screen as one Excel sheet, built
// in the browser from the response the tab already loaded, so the file holds
// the same rows, in the same order, as the list the user is looking at (never
// newer data). The rows come from the same rules module as the lists on
// screen. Client-safe; ExcelJS is loaded only when a file is built.

import type {
  AllYearListFilter,
  ExamPreparingForGroup,
  MonthListFilter,
  TestAttendanceResponse,
} from "@/types/test-attendance";
import { saveBlob } from "@/lib/file-download";
import {
  allYearColumns,
  allYearStudents,
  attendanceStatus,
  attendedText,
  monthStudents,
  filterStudents,
  windowMark,
  type TestAttendanceFilters,
} from "./test-attendance-rules";

/** "all" (All year) or a Monthly Test key. */
export type ExportPeriod = "all" | string;

/** What a Download button asks for: the list on screen. */
export interface TestAttendanceExport {
  period: ExportPeriod;
  filters: TestAttendanceFilters;
  list: MonthListFilter | AllYearListFilter;
}

/** One sheet: its name, the header row and the data rows. */
export interface TestAttendanceSheet {
  name: string;
  /** For the file name: the Monthly Test key, or "all-year". */
  periodSlug: string;
  header: string[];
  rows: (string | number)[][];
}

const examText = (value: ExamPreparingForGroup | null) => value ?? "Not set";

const SHEET_NAME_MAX = 31;
const DEFAULT_SHEET_NAME = "Monthly Test";
const trimSheetName = (name: string) => name.trim().replace(/^'+|'+$/g, "").trim();

/**
 * A worksheet name Excel accepts, from a Monthly Test label. Labels are free
 * text kept outside the LMS, and ExcelJS throws for `* ? : \ / [ ]`, a single
 * quote at either end, an empty name or "History". Forbidden characters become
 * spaces, and the name is cut to 31 characters; "Monthly Test" when nothing is left.
 */
function excelSheetName(label: string): string {
  const cleaned = trimSheetName(label.replace(/[*?:\\/[\]]/g, " ").replace(/\s+/g, " "));
  const name = trimSheetName(cleaned.slice(0, SHEET_NAME_MAX));
  return name === "" || name === "History" ? DEFAULT_SHEET_NAME : name;
}

/**
 * The sheet for the list on screen, built with the same rules as the tab;
 * null when the period is not a Monthly Test that has opened.
 */
export function testAttendanceSheet(
  data: Pick<TestAttendanceResponse, "monthlyTests" | "students">,
  { period, filters, list }: TestAttendanceExport,
): TestAttendanceSheet | null {
  const students = filterStudents(data.students, filters);

  if (period === "all") {
    const rows = allYearStudents(students, data.monthlyTests, list as AllYearListFilter);
    const columns = allYearColumns(data.monthlyTests, rows);
    return {
      name: "All year",
      periodSlug: "all-year",
      header: [
        "Student Name",
        "Student ID",
        "Grade",
        "Exam Preparing For",
        ...columns.map((test) => test.shortName),
        "Attended",
        "Tag",
        "Follow-up",
      ],
      rows: rows.map((row) => {
        const { student, followUp, attended, counted } = row;
        return [
          student.name,
          student.studentId ?? "",
          student.grade,
          examText(student.examPreparingFor),
          ...columns.map((test) => {
            const mark = windowMark(row, test.key);
            return mark == null ? "" : attendanceStatus("closed", mark);
          }),
          attendedText(attended, counted),
          followUp.tag === "follow_up" ? "Follow up" : followUp.tag === "not_submitting" ? "Not submitting" : "",
          followUp.note ?? "",
        ];
      }),
    };
  }

  const test = data.monthlyTests.find((monthlyTest) => monthlyTest.key === period);
  if (!test) return null;
  return {
    name: excelSheetName(test.name),
    periodSlug: test.key,
    header: ["Student Name", "Student ID", "Grade", "Exam Preparing For", "Status", "Previous 3 tests"],
    rows: monthStudents(students, test, list as MonthListFilter, data.monthlyTests).map(({ student, status, previous }) => [
      student.name,
      student.studentId ?? "",
      student.grade,
      examText(student.examPreparingFor),
      status,
      previous.note ?? "",
    ]),
  };
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The sheet as an .xlsx workbook: one worksheet, a bold header row frozen at
 * the top, the first and last columns wider. ExcelJS is imported here, not at
 * the top of the module, so it loads only when someone downloads.
 */
export async function testAttendanceWorkbook(sheet: TestAttendanceSheet): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet.name, { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.addRow(sheet.header);
  sheet.rows.forEach((values) => worksheet.addRow(values));
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach((column, index) => {
    column.width = index === 0 || index === sheet.header.length - 1 ? 28 : 16;
  });
  return workbook.xlsx.writeBuffer();
}

/**
 * Downloads the list on screen from the loaded response as
 * `test-attendance-<school code>-<period slug>.xlsx`. Throws when the period is
 * not an opened Monthly Test or the file cannot be built; the caller shows it.
 */
export async function downloadTestAttendance(
  data: Pick<TestAttendanceResponse, "monthlyTests" | "students">,
  request: TestAttendanceExport,
  schoolCode: string,
): Promise<void> {
  const sheet = testAttendanceSheet(data, request);
  if (!sheet) throw new Error("Monthly Test not found");
  const file = await testAttendanceWorkbook(sheet);
  saveBlob(new Blob([file], { type: XLSX_TYPE }), `test-attendance-${schoolCode}-${sheet.periodSlug}.xlsx`);
}
