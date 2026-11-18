// Test Attendance export (#517): the query the tab's Download buttons send and
// the sheet the export route builds from it. Client-safe and pure: the rows
// come from the same rules module as the lists on screen, so the file holds
// the same rows, in the same order, as the list the user is looking at.

import {
  allYearStudents,
  attendanceStatus,
  attendedText,
  DEFAULT_MONTH_FILTER,
  monthStudents,
  previousTestsWindow,
  tagWindow,
  filterStudents,
  type AllYearListFilter,
  type ExamPreparingForGroup,
  type MonthListFilter,
  type TestAttendanceFilters,
  type TestAttendanceResponse,
} from "./test-attendance-rules";

/** "all" (All year) or a Monthly Test key. */
export type ExportPeriod = "all" | string;

/** What a Download button asks for: the list on screen. */
export interface TestAttendanceExport {
  period: ExportPeriod;
  filters: TestAttendanceFilters;
  list: MonthListFilter | AllYearListFilter;
}

const GRADES: Record<string, TestAttendanceFilters["grade"]> = { all: "all", "11": 11, "12": 12 };
const EXAM_GROUPS: readonly ("all" | ExamPreparingForGroup)[] = [
  "all",
  "Engineering",
  "Medical",
  "CLAT",
  "CA",
  "NDA",
  "Not set",
];
const MONTH_LISTS: readonly MonthListFilter[] = ["not_opened", "opened", "submitted", "all"];
const ALL_YEAR_LISTS: readonly AllYearListFilter[] = ["all", "follow_up", "not_submitting"];

/** The export URL's query string for the list on screen. */
export function testAttendanceExportQuery({ period, filters, list }: TestAttendanceExport): string {
  return new URLSearchParams({
    period,
    grade: String(filters.grade),
    examPreparingFor: filters.examPreparingFor,
    list,
  }).toString();
}

/**
 * Reads an export request. Grade, Exam Preparing For and the list filter
 * default to what the tab opens on; a value the tab never sends is an error.
 * Whether a Monthly Test key exists is only known once the data is loaded.
 */
export function parseTestAttendanceExport(
  params: URLSearchParams,
): { ok: true; request: TestAttendanceExport } | { ok: false; error: string } {
  const period = params.get("period");
  if (!period) return { ok: false, error: "period is required" };

  const grade = GRADES[params.get("grade") ?? "all"];
  if (grade == null) return { ok: false, error: "grade must be all, 11 or 12" };

  const examPreparingFor = (params.get("examPreparingFor") ?? "all") as "all" | ExamPreparingForGroup;
  if (!EXAM_GROUPS.includes(examPreparingFor)) return { ok: false, error: "examPreparingFor is not recognised" };

  const allYear = period === "all";
  const list = (params.get("list") ?? (allYear ? "all" : DEFAULT_MONTH_FILTER)) as MonthListFilter | AllYearListFilter;
  const lists: readonly string[] = allYear ? ALL_YEAR_LISTS : MONTH_LISTS;
  if (!lists.includes(list)) return { ok: false, error: `list must be one of ${lists.join(", ")}` };

  return { ok: true, request: { period, filters: { grade, examPreparingFor }, list } };
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
    const window = tagWindow(data.monthlyTests);
    return {
      name: "All year",
      periodSlug: "all-year",
      header: [
        "Student Name",
        "Student ID",
        "Grade",
        "Exam Preparing For",
        ...window.map((test) => test.shortName),
        "Attended",
        "Tag",
        "Follow-up",
      ],
      rows: allYearStudents(students, window, list as AllYearListFilter).map(({ student, followUp, attended, counted }) => [
        student.name,
        student.studentId ?? "",
        student.grade,
        examText(student.examPreparingFor),
        ...window.map((test) => {
          const mark = student.attendance[test.key];
          return mark == null ? "" : attendanceStatus("closed", mark);
        }),
        attendedText(attended, counted),
        followUp.tag === "follow_up" ? "Follow up" : followUp.tag === "not_submitting" ? "Not submitting" : "",
        followUp.note ?? "",
      ]),
    };
  }

  const test = data.monthlyTests.find((monthlyTest) => monthlyTest.key === period);
  if (!test) return null;
  return {
    name: excelSheetName(test.name),
    periodSlug: test.key,
    header: ["Student Name", "Student ID", "Grade", "Exam Preparing For", "Status", "Previous 3 tests"],
    rows: monthStudents(
      students,
      test,
      list as MonthListFilter,
      previousTestsWindow(data.monthlyTests, test.key),
    ).map(({ student, status, previous }) => [
      student.name,
      student.studentId ?? "",
      student.grade,
      examText(student.examPreparingFor),
      status,
      previous.note ?? "",
    ]),
  };
}
