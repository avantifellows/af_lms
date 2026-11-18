// Server loader for the Test Attendance tab (#517): the single entry point the
// Test Attendance routes call. Server-only: it ties the PMU test set list, the
// Paper windows (`session`), the School roster and the warehouse attendance
// read to the client-safe `test-attendance-rules` module, which owns the rules
// and the response shape.

import { CURRENT_ACADEMIC_YEAR, PMU_PROGRAM_ID } from "@/lib/constants";
import { query } from "@/lib/db";
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
import { readSchoolAttendance } from "@/lib/test-attendance-warehouse";
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
 * When each Student joined NVS: the earliest `start_date` among their batch
 * enrollments (current or ended) in JNV NVS batches for the current academic
 * year, as `YYYY-MM-DD`, by LMS user id. Earliest decides, so a later move
 * between NVS batches does not drop earlier Monthly Tests. A Student with no
 * dated enrollment has no entry. Throws when the read fails.
 */
export async function readNvsJoiningDates(userIds: string[]): Promise<Map<string, string>> {
  const joinedOn = new Map<string, string>();
  if (userIds.length === 0) return joinedOn;
  const rows = await query<{ user_id: string; start_date: string | null }>(
    `SELECT er.user_id::text AS user_id,
            to_char(er.start_date, 'YYYY-MM-DD') AS start_date
       FROM enrollment_record er
       JOIN batch b ON b.id = er.group_id
      WHERE er.group_type = 'batch'
        AND er.user_id = ANY($1::bigint[])
        AND er.academic_year = $2
        AND b.program_id = $3
        AND er.start_date IS NOT NULL`,
    [userIds, CURRENT_ACADEMIC_YEAR, PMU_PROGRAM_ID],
  );
  for (const row of rows) {
    if (!row.start_date) continue;
    const userId = String(row.user_id);
    const earliest = joinedOn.get(userId);
    if (earliest == null || row.start_date < earliest) joinedOn.set(userId, row.start_date);
  }
  return joinedOn;
}

/** The tab's Students and when each joined NVS. Throws when either read fails. */
async function loadStudentsAndJoiningDates(schoolId: string | number) {
  const students = await loadListedStudents(schoolId);
  const joinedOn = await readNvsJoiningDates(students.map((student) => student.userId));
  return { students, joinedOn };
}

/**
 * The tab's data for one School. The caller must already have run the gate.
 * Only the listed Students are sent, and the warehouse is asked only about
 * them. A failed source throws: the route answers with an error, never zeros.
 * Only a failed last-refreshed lookup is tolerated, as an unknown time.
 */
export async function loadTestAttendance(
  schoolId: string | number,
  now: Date = new Date(),
): Promise<TestAttendanceResponse> {
  const [{ students, joinedOn }, { testSets, papers }] = await Promise.all([
    loadStudentsAndJoiningDates(schoolId),
    loadTestSets(),
  ]);
  const { attendance, lastRefreshed } = await readSchoolAttendance(
    schoolId,
    attendanceQuizIds(testSets, papers, now),
    students.map((student) => student.userId),
  );
  const data = testAttendanceFrom({ testSets, papers, students, attendance, joinedOn, now });
  return { ...data, lastRefreshed, serverTime: now.toISOString() };
}
