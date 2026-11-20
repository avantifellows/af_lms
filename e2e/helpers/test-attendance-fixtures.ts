import type { Pool } from "pg";

import { CURRENT_ACADEMIC_YEAR, PMU_PROGRAM_ID } from "../../src/lib/constants";
import type { TestAttendanceResponse } from "../../src/types/test-attendance";

// Test Attendance tab (#517) fixture. The e2e dump has no JNV School with a
// listed Student (current-year grade 11/12, a current JNV NVS batch), so the
// spec seeds two at JNV Bhavnagar (14042, a School the e2e teacher can open)
// plus a PMU Govt School User for that School, and removes them afterwards.

export const TEST_ATTENDANCE_SCHOOL_CODE = "14042";

export const TEST_ATTENDANCE_PMU = {
  name: "E2E Test Attendance PMU",
  email: "e2e-test-attendance-pmu@test.local",
};

const STUDENTS = [
  { email: "e2e-test-attendance-11@test.local", first: "Tara", last: "Eleven", studentId: "E2E-TA-11", grade: 11, stream: "Engineering" },
  { email: "e2e-test-attendance-12@test.local", first: "Uday", last: "Twelve", studentId: "E2E-TA-12", grade: 12, stream: "Medical" },
] as const;

const FIXTURE_EMAILS = [TEST_ATTENDANCE_PMU.email, ...STUDENTS.map((student) => student.email)];

async function oneId(pool: Pool, sql: string, params: unknown[], what: string): Promise<number> {
  const result = await pool.query<{ id: number }>(sql, params);
  if (result.rows.length === 0) throw new Error(`Test Attendance fixture: ${what} not found`);
  return Number(result.rows[0].id);
}

async function insertUser(pool: Pool, email: string, role: string, first: string | null, last: string | null) {
  return oneId(
    pool,
    `INSERT INTO "user" (first_name, last_name, email, role, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))
     RETURNING id`,
    [first, last, email, role],
    "inserted user",
  );
}

/** Seed the School's listed NVS Students and its PMU Govt School User. */
export async function seedTestAttendanceFixture(pool: Pool): Promise<void> {
  await removeTestAttendanceFixture(pool);
  const schoolId = await oneId(pool, `SELECT id FROM school WHERE code = $1`, [TEST_ATTENDANCE_SCHOOL_CODE], "School");
  const schoolGroupId = await oneId(
    pool,
    `SELECT id FROM "group" WHERE type = 'school' AND child_id = $1 ORDER BY id LIMIT 1`,
    [schoolId],
    "School group",
  );

  for (const student of STUDENTS) {
    const gradeId = await oneId(pool, `SELECT id FROM grade WHERE number = $1`, [student.grade], `grade ${student.grade}`);
    const batchId = await oneId(
      pool,
      `SELECT id FROM batch WHERE program_id = $1 AND name = $2`,
      [PMU_PROGRAM_ID, `JNV NVS G${student.grade} All Region`],
      `grade ${student.grade} NVS batch`,
    );
    const userId = await insertUser(pool, student.email, "student", student.first, student.last);
    await pool.query(
      `INSERT INTO student (student_id, user_id, grade_id, status, stream, inserted_at, updated_at)
       VALUES ($1, $2, $3, 'active', $4, (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))`,
      [student.studentId, userId, gradeId, student.stream],
    );
    await pool.query(
      `INSERT INTO group_user (group_id, user_id, inserted_at, updated_at)
       VALUES ($1, $2, (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))`,
      [schoolGroupId, userId],
    );
    await pool.query(
      `INSERT INTO enrollment_record (user_id, group_id, group_type, academic_year, is_current, start_date, inserted_at, updated_at)
       VALUES ($1, $2, 'grade', $4, true, DATE '2026-04-01', (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC')),
              ($1, $3, 'batch', $4, true, DATE '2026-04-01', (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))`,
      [userId, gradeId, batchId, CURRENT_ACADEMIC_YEAR],
    );
  }

  const pmuUserId = await insertUser(pool, TEST_ATTENDANCE_PMU.email, "pmu_govt_school_user", null, null);
  await pool.query(
    `INSERT INTO user_permission (email, level, role, program_ids, school_codes, regions, read_only, user_id, revoked_at)
     VALUES ($1, 1, 'pmu_govt_school_user', $2, $3, NULL, false, $4, NULL)`,
    [TEST_ATTENDANCE_PMU.email, [PMU_PROGRAM_ID], [TEST_ATTENDANCE_SCHOOL_CODE], pmuUserId],
  );
}

/** Remove everything {@link seedTestAttendanceFixture} added. */
export async function removeTestAttendanceFixture(pool: Pool): Promise<void> {
  const users = await pool.query<{ id: number }>(`SELECT id FROM "user" WHERE email = ANY($1)`, [FIXTURE_EMAILS]);
  const userIds = users.rows.map((row) => Number(row.id));
  await pool.query(`DELETE FROM user_permission WHERE email = ANY($1)`, [FIXTURE_EMAILS]);
  if (userIds.length === 0) return;
  await pool.query(`DELETE FROM enrollment_record WHERE user_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM group_user WHERE user_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM student WHERE user_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [userIds]);
}

// The e2e server cannot read the PMU test set list or the warehouse, so specs
// that need a loaded tab answer the read route in the browser with this
// response (made-up Students; they need not match the seeded roster). Server
// time 18 Nov 2026, 2:00 pm IST: August, September and October are closed and
// November is running. Asha and Kiran get Follow up, Neel gets Not submitting.
const testAttendanceMonth = (key: string, name: string, opensAt: string, closesAt: string, state: "running" | "closed") => ({
  key,
  name,
  shortName: name.slice(0, 3),
  opensAt,
  closesAt,
  state,
  grades: [11, 12],
});

export const TEST_ATTENDANCE_RESPONSE: TestAttendanceResponse = {
  monthlyTests: [
    testAttendanceMonth("august", "August", "2026-08-17T23:30:00.000Z", "2026-08-22T18:25:00.000Z", "closed"),
    testAttendanceMonth("september", "September", "2026-09-14T23:30:00.000Z", "2026-09-19T18:25:00.000Z", "closed"),
    testAttendanceMonth("october", "October", "2026-10-05T23:30:00.000Z", "2026-10-10T18:25:00.000Z", "closed"),
    testAttendanceMonth("november", "November", "2026-11-16T23:30:00.000Z", "2026-11-21T18:25:00.000Z", "running"),
  ],
  students: [
    { userId: "e2e-ta-1", name: "Asha Bose", studentId: "E2E-TA-1", grade: 11, examPreparingFor: "Engineering", attendance: { august: "not_opened", september: "not_opened", october: "not_opened", november: "submitted" } },
    { userId: "e2e-ta-2", name: "Kiran Das", studentId: "E2E-TA-2", grade: 12, examPreparingFor: "Medical", attendance: { august: "not_opened", september: "not_opened", october: "submitted", november: "not_opened" } },
    { userId: "e2e-ta-3", name: "Neel Jha", studentId: "E2E-TA-3", grade: 11, examPreparingFor: "Engineering", attendance: { august: "opened", september: "submitted", october: "opened", november: "not_opened" } },
    { userId: "e2e-ta-4", name: "Bala Nair", studentId: "E2E-TA-4", grade: 11, examPreparingFor: null, attendance: { august: "submitted", september: "opened", october: "submitted", november: "submitted" } },
    { userId: "e2e-ta-5", name: "Zoya Ali", studentId: null, grade: 11, examPreparingFor: "Engineering", attendance: { august: "submitted", september: "submitted", october: "submitted", november: "opened" } },
    // Joined in November: counted for November only.
    { userId: "e2e-ta-6", name: "Omar Khan", studentId: "E2E-TA-6", grade: 12, examPreparingFor: "CLAT", attendance: { november: "not_opened" } },
    { userId: "e2e-ta-7", name: "Ravi Sen", studentId: "E2E-TA-7", grade: 12, examPreparingFor: "NDA", attendance: { august: "submitted", september: "submitted", october: "not_opened", november: "opened" } },
    { userId: "e2e-ta-8", name: "Meera Iyer", studentId: "E2E-TA-8", grade: 12, examPreparingFor: "CA", attendance: { august: "submitted", september: "submitted", october: "submitted", november: "submitted" } },
  ],
  lastRefreshed: "2026-11-18T08:15:00.000Z",
  serverTime: "2026-11-18T08:30:00.000Z",
};
