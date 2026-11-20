// Server loader for the Test Attendance tab (#517): the single entry point the
// Test Attendance routes call. Server-only: it ties the PMU test set list, the
// Paper windows (`session`), the School roster and the warehouse attendance
// read to the client-safe `test-attendance-rules` module, which owns the
// rules. The response shape lives in `@/types/test-attendance`.

import { CURRENT_ACADEMIC_YEAR, PMU_PROGRAM_ID } from "@/lib/constants";
import { query } from "@/lib/db";
import { getSchoolRoster } from "@/lib/school-students";
import { readPaperWindows } from "@/lib/test-attendance-papers";
import type {
  ListedStudent,
  ListedStudentDiagnostics,
  PaperWindow,
  TestAttendanceResponse,
  TestSet,
} from "@/types/test-attendance";
import {
  attendanceQuizIds,
  examPreparingFor,
  isTestAttendanceStudent,
  testAttendanceFrom,
} from "@/lib/test-attendance-rules";
import { readSchoolAttendance } from "@/lib/test-attendance-warehouse";
import { getNvsTestSets } from "@/lib/test-set-list";

/** The test set list and the windows of its Papers. Throws when a source fails. */
async function loadTestSets(): Promise<{ testSets: TestSet[]; papers: PaperWindow[] }> {
  const testSets = await getNvsTestSets();
  const papers = await readPaperWindows([...new Set(testSets.flatMap((set) => set.quizIds))]);
  return { testSets, papers };
}

/**
 * When each Student joined NVS: the earliest `start_date` among their batch
 * enrollments (current or ended) in JNV NVS batches for the current academic
 * year, as `YYYY-MM-DD`, by LMS user id. Earliest decides, so a later move
 * between NVS batches does not drop earlier Monthly Tests. A Student with no
 * dated enrollment has no entry. Throws when the read fails.
 */
export async function readNvsJoiningDates(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await query<{ user_id: string; start_date: string }>(
    `SELECT er.user_id::text AS user_id,
            to_char(MIN(er.start_date), 'YYYY-MM-DD') AS start_date
       FROM enrollment_record er
       JOIN batch b ON b.id = er.group_id
      WHERE er.group_type = 'batch'
        AND er.user_id = ANY($1::bigint[])
        AND er.academic_year = $2
        AND b.program_id = $3
        AND er.start_date IS NOT NULL
      GROUP BY er.user_id`,
    [userIds, CURRENT_ACADEMIC_YEAR, PMU_PROGRAM_ID],
  );
  return new Map(rows.map((row) => [String(row.user_id), row.start_date]));
}

/**
 * One read of the School roster, narrowed by the tab's listing rule, and when
 * each listed Student joined NVS. Throws when either read fails.
 */
async function loadListedRoster(schoolId: string | number) {
  const { students } = await getSchoolRoster(schoolId);
  const roster = students.filter(isTestAttendanceStudent);
  const joinedOn = await readNvsJoiningDates(roster.map((student) => String(student.user_id)));
  return { roster, joinedOn };
}

/**
 * The tab's data for one School, plus, from the same roster read, what the
 * pre-launch data check needs about each listed Student. Only the check reads
 * `diagnostics`; the routes call `loadTestAttendance`, which drops it.
 */
export async function loadSchoolTestAttendance(
  schoolId: string | number,
  now: Date = new Date(),
): Promise<{ data: TestAttendanceResponse; diagnostics: ListedStudentDiagnostics[] }> {
  const [{ roster, joinedOn }, { testSets, papers }] = await Promise.all([
    loadListedRoster(schoolId),
    loadTestSets(),
  ]);
  const students: ListedStudent[] = roster.map((student) => ({
    userId: String(student.user_id),
    name: [student.first_name, student.last_name].filter(Boolean).join(" "),
    studentId: student.student_id ?? null,
    grade: Number(student.grade),
    examPreparingFor: examPreparingFor(student.stream),
  }));
  const { attendance, lastRefreshed } = await readSchoolAttendance(
    schoolId,
    attendanceQuizIds(testSets, papers, now),
    students.map((student) => student.userId),
  );
  const data = testAttendanceFrom({ testSets, papers, students, attendance, joinedOn, now });
  return {
    data: { ...data, lastRefreshed, serverTime: now.toISOString() },
    diagnostics: roster.map((student) => ({
      userId: String(student.user_id),
      rawExamPreparingFor: student.stream ?? null,
      hasJoiningDate: joinedOn.has(String(student.user_id)),
    })),
  };
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
  return (await loadSchoolTestAttendance(schoolId, now)).data;
}
