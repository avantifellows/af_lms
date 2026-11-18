// Server loader for the Test Attendance tab (#517): the single entry point the
// Test Attendance routes call. Server-only (reads Postgres through the School
// roster and the Paper windows, and the PMU test set list). The rules and the
// response shape live in the client-safe `test-attendance-rules` module.

import { getSchoolRoster } from "@/lib/school-students";
import { readPaperWindows } from "@/lib/test-attendance-papers";
import {
  examPreparingFor,
  isTestAttendanceStudent,
  monthlyTestsFrom,
  type TestAttendanceMonthlyTest,
  type TestAttendanceResponse,
  type TestAttendanceStudent,
} from "@/lib/test-attendance-rules";
import { getNvsTestSets } from "@/lib/test-set-list";

/** The Monthly Tests that have opened by `now`. Throws when a source fails. */
async function loadMonthlyTests(now: Date): Promise<TestAttendanceMonthlyTest[]> {
  const testSets = await getNvsTestSets();
  if (testSets === "unavailable") throw new Error("PMU test set list unavailable");
  const papers = await readPaperWindows([...new Set(testSets.flatMap((set) => set.quizIds))]);
  return monthlyTestsFrom(testSets, papers, now);
}

/**
 * The tab's data for one School. The caller must already have run the gate.
 * Students are the canonical School roster narrowed by the tab's listing rule.
 * A failed source throws: the route answers with an error, never zeros.
 */
export async function loadTestAttendance(
  schoolId: string | number,
  now: Date = new Date(),
): Promise<TestAttendanceResponse> {
  const [{ students }, monthlyTests] = await Promise.all([getSchoolRoster(schoolId), loadMonthlyTests(now)]);
  const listed: TestAttendanceStudent[] = students.filter(isTestAttendanceStudent).map((student) => ({
    userId: String(student.user_id),
    name: [student.first_name, student.last_name].filter(Boolean).join(" "),
    studentId: student.student_id ?? null,
    grade: Number(student.grade),
    examPreparingFor: examPreparingFor(student.stream),
  }));
  return { monthlyTests, students: listed, serverTime: now.toISOString() };
}
