// Server loader for the Test Attendance tab (#517): the single entry point the
// Test Attendance routes call. Server-only: it ties the PMU test set list, the
// Paper windows (`session`), the School roster and the warehouse attendance
// read to the client-safe `test-attendance-rules` module, which owns the rules
// and the response shape.

import { getSchoolRoster } from "@/lib/school-students";
import { readPaperWindows } from "@/lib/test-attendance-papers";
import {
  attendanceQuizIds,
  examPreparingFor,
  isTestAttendanceStudent,
  testAttendanceFrom,
  type ListedStudent,
  type PaperWindow,
  type TestAttendanceResponse,
  type TestSet,
} from "@/lib/test-attendance-rules";
import { readPaperAttendance } from "@/lib/test-attendance-warehouse";
import { getNvsTestSets } from "@/lib/test-set-list";

/** The test set list and the windows of its Papers. Throws when a source fails. */
async function loadTestSets(): Promise<{ testSets: TestSet[]; papers: PaperWindow[] }> {
  const testSets = await getNvsTestSets();
  if (testSets === "unavailable") throw new Error("PMU test set list unavailable");
  const papers = await readPaperWindows([...new Set(testSets.flatMap((set) => set.quizIds))]);
  return { testSets, papers };
}

/** The canonical School roster narrowed by the tab's listing rule. */
async function loadListedStudents(schoolId: string | number): Promise<ListedStudent[]> {
  const { students } = await getSchoolRoster(schoolId);
  return students.filter(isTestAttendanceStudent).map((student) => ({
    userId: String(student.user_id),
    name: [student.first_name, student.last_name].filter(Boolean).join(" "),
    studentId: student.student_id ?? null,
    grade: Number(student.grade),
    examPreparingFor: examPreparingFor(student.stream),
  }));
}

/**
 * The tab's data for one School. The caller must already have run the gate.
 * Only the listed Students are sent, and the warehouse is asked only about
 * them. A failed source throws: the route answers with an error, never zeros.
 */
export async function loadTestAttendance(
  schoolId: string | number,
  now: Date = new Date(),
): Promise<TestAttendanceResponse> {
  const [students, { testSets, papers }] = await Promise.all([loadListedStudents(schoolId), loadTestSets()]);
  const attendance = await readPaperAttendance(
    attendanceQuizIds(testSets, papers, now),
    students.map((student) => student.userId),
  );
  const data = testAttendanceFrom({ testSets, papers, students, attendance, now });
  return { ...data, serverTime: now.toISOString() };
}
