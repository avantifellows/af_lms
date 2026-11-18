// Server loader for the Test Attendance tab (#517): the single entry point the
// Test Attendance routes call. Server-only (reads Postgres through the School
// roster). The rules and the response shape live in the client-safe
// `test-attendance-rules` module.

import { getSchoolRoster } from "@/lib/school-students";
import {
  examPreparingFor,
  isTestAttendanceStudent,
  type TestAttendanceResponse,
  type TestAttendanceStudent,
} from "@/lib/test-attendance-rules";

/**
 * The tab's data for one School. The caller must already have run the gate.
 * Students are the canonical School roster narrowed by the tab's listing rule;
 * Monthly Tests arrive in a later slice.
 */
export async function loadTestAttendance(
  schoolId: string | number,
  now: Date = new Date(),
): Promise<TestAttendanceResponse> {
  const { students } = await getSchoolRoster(schoolId);
  const listed: TestAttendanceStudent[] = students.filter(isTestAttendanceStudent).map((student) => ({
    userId: String(student.user_id),
    name: [student.first_name, student.last_name].filter(Boolean).join(" "),
    studentId: student.student_id ?? null,
    grade: Number(student.grade),
    examPreparingFor: examPreparingFor(student.stream),
  }));
  return { monthlyTests: [], students: listed, serverTime: now.toISOString() };
}
