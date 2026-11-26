// Test Attendance tab (#517): the data shapes several modules share (the
// server loader and its sources, the rules, the export and the components),
// and the closed value lists the screen's filters and the export both accept.
// Dependency-free and client-safe, so a value added here reaches every
// filter and every check at once.

/** The five Exam Preparing For values the tab groups by, in group order. */
export const EXAM_PREPARING_FOR = ["Engineering", "Medical", "CLAT", "CA", "NDA"] as const;

export type ExamPreparingFor = (typeof EXAM_PREPARING_FOR)[number];

/** A Student's Exam Preparing For group: one of the five, or "Not set". */
export type ExamPreparingForGroup = ExamPreparingFor | "Not set";

/** Group order: Engineering, Medical, CLAT, CA, NDA, Not set. */
export const EXAM_PREPARING_FOR_GROUPS: readonly ExamPreparingForGroup[] = [...EXAM_PREPARING_FOR, "Not set"];

/** The grades the tab lists, and its Grade filter's values besides "all". Grade 13 is out of scope. */
export const TEST_ATTENDANCE_GRADES = [11, 12] as const;

export type TestAttendanceGrade = (typeof TEST_ATTENDANCE_GRADES)[number];

/** How far a Student got in one Monthly Test, over all of its Papers. */
export type AttendanceMark = "not_opened" | "opened" | "submitted";

/** A month page's list filters: one mark, or every counted Student. */
export const MONTH_LIST_FILTERS = ["not_opened", "opened", "submitted", "all"] as const satisfies readonly (
  | AttendanceMark
  | "all"
)[];

export type MonthListFilter = (typeof MONTH_LIST_FILTERS)[number];

/** Follow Up (red): Absent in 2 or more. Not Submitting (amber): Opened, not submitted in 2 or more. */
export type FollowUpTag = "follow_up" | "not_submitting";

/** The All year list filters: everyone, or one tag. */
export const ALL_YEAR_LIST_FILTERS = ["all", "follow_up", "not_submitting"] as const satisfies readonly (
  | "all"
  | FollowUpTag
)[];

export type AllYearListFilter = (typeof ALL_YEAR_LIST_FILTERS)[number];

/** One Monthly Test that has opened. Times are UTC ISO strings. */
export interface TestAttendanceMonthlyTest {
  key: string;
  name: string;
  shortName: string;
  opensAt: string;
  closesAt: string;
  state: "running" | "closed";
  grades: number[];
}

/** A Student on the tab's list, before any attendance. */
export interface ListedStudent {
  userId: string;
  name: string;
  studentId: string | null;
  apaarId: string | null;
  grade: number;
  examPreparingFor: ExamPreparingFor | null;
}

/**
 * A Student on the tab's list. Carries nothing else about the Student.
 * `attendance` has one mark per Monthly Test key the Student is counted for,
 * and nothing for the others.
 */
export interface TestAttendanceStudent extends ListedStudent {
  attendance: Record<string, AttendanceMark>;
}

/** `GET /api/school/[udise]/test-attendance` */
export interface TestAttendanceResponse {
  monthlyTests: TestAttendanceMonthlyTest[];
  students: TestAttendanceStudent[];
  /** When the warehouse attendance table was last rebuilt (UTC ISO); null when unknown. */
  lastRefreshed: string | null;
  /** When the server built the response (UTC ISO). */
  serverTime: string;
}

/** One NVS Monthly Test: its name (the month it starts in) and its Papers (quiz ids). */
export interface TestSet {
  label: string;
  quizIds: string[];
}

/**
 * One Paper's window from the `session` table. Times are UTC ISO strings, or
 * null when missing or unparseable. A Paper with no `session` row has none.
 */
export interface PaperWindow {
  quizId: string;
  opensAt: string | null;
  closesAt: string | null;
  grade: number | null;
  switchedOn: boolean;
}

/**
 * One attendance row from the warehouse: the Student opened the Paper.
 * `submitted` is null when the warehouse does not know.
 */
export interface PaperAttendance {
  userId: string;
  quizId: string;
  submitted: boolean | null;
}

/**
 * What the pre-launch data check needs about one listed Student, beyond the
 * tab's data: the raw Exam Preparing For value and whether the Student has an
 * NVS joining date. Never part of the tab's response.
 */
export interface ListedStudentDiagnostics {
  userId: string;
  rawExamPreparingFor: string | null;
  hasJoiningDate: boolean;
}
