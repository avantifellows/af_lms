// Test Attendance rules (#517): the response shape the School page's Test
// Attendance tab reads, and the pure rules both the server and the browser
// apply to it. Client-safe: no database, permission or network imports here.

import { PMU_PROGRAM_ID } from "./constants";
import { studentHasCurrentProgram } from "./enrollment-stats";

/** The five Exam Preparing For values the tab groups by, in group order. */
const EXAM_PREPARING_FOR = ["Engineering", "Medical", "CLAT", "CA", "NDA"] as const;

export type ExamPreparingFor = (typeof EXAM_PREPARING_FOR)[number];

const BY_KEY = new Map<string, ExamPreparingFor>(
  EXAM_PREPARING_FOR.map((value) => [value.toLowerCase(), value]),
);

/**
 * A Student's Exam Preparing For, matched without regard to case. A blank or
 * unrecognised value is none (shown as "Not set").
 */
export function examPreparingFor(raw: string | null | undefined): ExamPreparingFor | null {
  return BY_KEY.get(raw?.trim().toLowerCase() ?? "") ?? null;
}

/** The grades the tab lists. Grade 13 is out of scope. */
const TEST_ATTENDANCE_GRADES: readonly number[] = [11, 12];

/** The roster fields the listing rule reads. */
export interface ListableRosterStudent {
  status?: string | null;
  grade: number | null;
  program_id: number | null;
  student_program_ids?: Array<number | string> | null;
}

/**
 * Whether a School roster Student is on the tab's list: the Download List
 * "Active" sheet (not dropped out, a current JNV NVS batch), then grades 11
 * and 12 only. The School page uses it to decide whether the tab shows and
 * the server uses it to build the response, so the two never disagree.
 */
export function isTestAttendanceStudent(student: ListableRosterStudent): boolean {
  return (
    student.status !== "dropout" &&
    studentHasCurrentProgram(student, PMU_PROGRAM_ID) &&
    student.grade != null &&
    TEST_ATTENDANCE_GRADES.includes(Number(student.grade))
  );
}

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

/** A Student on the tab's list. Carries nothing else about the Student. */
export interface TestAttendanceStudent {
  userId: string;
  name: string;
  studentId: string | null;
  grade: number;
  examPreparingFor: ExamPreparingFor | null;
}

/** `GET /api/school/[udise]/test-attendance` */
export interface TestAttendanceResponse {
  monthlyTests: TestAttendanceMonthlyTest[];
  students: TestAttendanceStudent[];
  /** When the server built the response (UTC ISO). */
  serverTime: string;
}
