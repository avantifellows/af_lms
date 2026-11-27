import type { Pool } from "pg";

import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "../../src/lib/constants";

// AI Test Insights Tab (#550) fixture. Seeds three made-up JNV Schools in
// the AHMEDABAD region (so the e2e Program Manager and Program Admin reach
// them), their centres and batches, Students of every kind the tab must list
// or leave out, and the personas the e2e seed lacks. Everything is removed
// afterwards. The expected list is declared here by hand, never computed.

const NOW = "(NOW() AT TIME ZONE 'UTC')";

const SCHOOL = { code: "E2EATI1", udise: "29990000001", name: "JNV E2E AI Insights" };
const OTHER_SCHOOL = { code: "E2EATI2", udise: "29990000002", name: "JNV E2E AI Insights Other" };
const NO_CENTRE_SCHOOL = { code: "E2EATI3", udise: "29990000003", name: "JNV E2E AI Insights NVS" };
const SCHOOLS = [SCHOOL, OTHER_SCHOOL, NO_CENTRE_SCHOOL];

export const AI_TEST_INSIGHTS_SCHOOL = SCHOOL;
export const AI_TEST_INSIGHTS_OTHER_SCHOOL = OTHER_SCHOOL;
export const AI_TEST_INSIGHTS_NO_CENTRE_SCHOOL = NO_CENTRE_SCHOOL;

const CENTRE_PREFIX = "E2E ATI ";
const BATCH_PREFIX = "E2E-ATI-";

type BatchKey = "coe" | "nodal" | "nvs" | "otherCoe";
const BATCHES: Record<BatchKey, { batchId: string; programId: number }> = {
  coe: { batchId: `${BATCH_PREFIX}COE`, programId: PROGRAM_IDS.COE },
  nodal: { batchId: `${BATCH_PREFIX}NODAL`, programId: PROGRAM_IDS.NODAL },
  nvs: { batchId: `${BATCH_PREFIX}NVS`, programId: PROGRAM_IDS.NVS },
  otherCoe: { batchId: `${BATCH_PREFIX}OTHER-COE`, programId: PROGRAM_IDS.COE },
};

interface StudentFixture {
  key: string;
  first: string;
  last: string;
  grade: number;
  stream: string | null;
  status: string;
  school: "main" | "other";
  batches: BatchKey[];
}

// Listed: JEE (engineering in any spelling and case), Grade 11 or 12, not a
// dropout, on an active CoE or Nodal centre's roster. Esha is on both centres.
const LISTED: StudentFixture[] = [
  { key: "asha", first: "Asha", last: "Atiq", grade: 11, stream: "Engineering", status: "active", school: "main", batches: ["coe"] },
  { key: "bhavya", first: "Bhavya", last: "Bose", grade: 12, stream: "PCM", status: "active", school: "main", batches: ["coe"] },
  { key: "chirag", first: "Chirag", last: "Chand", grade: 11, stream: " engg ", status: "active", school: "main", batches: ["coe"] },
  { key: "divya", first: "Divya", last: "Dutt", grade: 12, stream: "ENGINEERING", status: "active", school: "main", batches: ["nodal"] },
  { key: "esha", first: "Esha", last: "Ekka", grade: 11, stream: "engineering", status: "active", school: "main", batches: ["coe", "nodal"] },
];

// One of each kind the tab must leave out.
const EXCLUDED: StudentFixture[] = [
  { key: "medical", first: "Farah", last: "Medical", grade: 11, stream: "Medical", status: "active", school: "main", batches: ["coe"] },
  { key: "blank", first: "Gopal", last: "Blank", grade: 12, stream: null, status: "active", school: "main", batches: ["coe"] },
  { key: "dropout", first: "Hema", last: "Dropout", grade: 12, stream: "Engineering", status: "dropout", school: "main", batches: ["coe"] },
  { key: "grade10", first: "Ishan", last: "Tenth", grade: 10, stream: "Engineering", status: "active", school: "main", batches: ["coe"] },
  { key: "nvs", first: "Jaya", last: "Nvs", grade: 11, stream: "Engineering", status: "active", school: "main", batches: ["nvs"] },
  { key: "other", first: "Kabir", last: "Elsewhere", grade: 11, stream: "Engineering", status: "active", school: "other", batches: ["otherCoe"] },
];

const STUDENTS = [...LISTED, ...EXCLUDED];
const studentEmail = (key: string) => `e2e-ati-student-${key}@test.local`;
const studentCode = (key: string) => `E2E-ATI-${key.toUpperCase()}`;

/** The rows the tab must show, in its order (Grade, then name), as [name, Student ID, Grade]. */
export const AI_TEST_INSIGHTS_SCHOOL_LIST = [
  ["Asha Atiq", "E2E-ATI-ASHA", "11"],
  ["Chirag Chand", "E2E-ATI-CHIRAG", "11"],
  ["Esha Ekka", "E2E-ATI-ESHA", "11"],
  ["Bhavya Bose", "E2E-ATI-BHAVYA", "12"],
  ["Divya Dutt", "E2E-ATI-DIVYA", "12"],
];
export const AI_TEST_INSIGHTS_COE_CENTRE_LIST = [
  ["Asha Atiq", "E2E-ATI-ASHA", "11"],
  ["Chirag Chand", "E2E-ATI-CHIRAG", "11"],
  ["Esha Ekka", "E2E-ATI-ESHA", "11"],
  ["Bhavya Bose", "E2E-ATI-BHAVYA", "12"],
];
export const AI_TEST_INSIGHTS_NODAL_CENTRE_LIST = [
  ["Esha Ekka", "E2E-ATI-ESHA", "11"],
  ["Divya Dutt", "E2E-ATI-DIVYA", "12"],
];

export interface Persona {
  name: string;
  email: string;
}

interface PersonaFixture extends Persona {
  role: string;
  schoolCodes: string[];
  programIds: number[];
  seat?: "coe";
}

const persona = (key: string, name: string, role: string, schoolCodes: string[], programIds: number[], seat?: "coe"): PersonaFixture => ({
  name,
  email: `e2e-ati-${key}@test.local`,
  role,
  schoolCodes,
  programIds,
  seat,
});

export const AI_TEST_INSIGHTS_PERSONAS = {
  teacher: persona("teacher", "E2E ATI Teacher", "teacher", [SCHOOL.code, NO_CENTRE_SCHOOL.code], [PROGRAM_IDS.COE, PROGRAM_IDS.NODAL]),
  seatedTeacher: persona("seated-teacher", "E2E ATI Seated Teacher", "teacher", [], [], "coe"),
  otherSchoolTeacher: persona("other-teacher", "E2E ATI Other Teacher", "teacher", [OTHER_SCHOOL.code], [PROGRAM_IDS.COE]),
  nvsOnlyTeacher: persona("nvs-teacher", "E2E ATI NVS Teacher", "teacher", [SCHOOL.code, NO_CENTRE_SCHOOL.code], [PROGRAM_IDS.NVS]),
  pmuManager: persona("pmu-manager", "E2E ATI PMU Manager", "pmu_manager", [SCHOOL.code], [PROGRAM_IDS.NVS]),
  pmuGovtSchoolUser: persona("pmu-govt", "E2E ATI PMU Govt School User", "pmu_govt_school_user", [SCHOOL.code], [PROGRAM_IDS.NVS]),
} satisfies Record<string, PersonaFixture>;

const PERSONA_EMAILS = Object.values(AI_TEST_INSIGHTS_PERSONAS).map((p) => p.email);
const ALL_EMAILS = [...PERSONA_EMAILS, ...STUDENTS.map((s) => studentEmail(s.key))];

export interface AiTestInsightsFixtureIds {
  coeCentreId: number;
  nodalCentreId: number;
  otherCentreId: number;
}

async function oneId(pool: Pool, sql: string, params: unknown[], what: string): Promise<number> {
  const result = await pool.query<{ id: number | string }>(sql, params);
  if (result.rows.length === 0) throw new Error(`AI Test Insights fixture: ${what} not found`);
  return Number(result.rows[0].id);
}

async function insertSchool(pool: Pool, school: { code: string; udise: string; name: string }) {
  const id = await oneId(
    pool,
    `INSERT INTO school (code, name, udise_code, af_school_category, region, state, district, inserted_at, updated_at)
     VALUES ($1, $2, $3, 'JNV', 'AHMEDABAD', 'Gujarat', 'Ahmedabad', ${NOW}, ${NOW})
     RETURNING id`,
    [school.code, school.name, school.udise],
    `inserted School ${school.code}`,
  );
  const groupId = await oneId(
    pool,
    `INSERT INTO "group" (type, child_id, inserted_at, updated_at) VALUES ('school', $1, ${NOW}, ${NOW}) RETURNING id`,
    [id],
    "School group",
  );
  return { id, groupId };
}

async function insertCentre(pool: Pool, name: string, schoolId: number, programId: number) {
  return oneId(
    pool,
    `INSERT INTO centres (name, school_id, program_id, is_physical, is_active, inserted_at, updated_at)
     VALUES ($1, $2, $3, true, true, ${NOW}, ${NOW}) RETURNING id`,
    [`${CENTRE_PREFIX}${name}`, schoolId, programId],
    "inserted centre",
  );
}

async function insertBatchGroup(pool: Pool, batch: { batchId: string; programId: number }) {
  const batchId = await oneId(
    pool,
    `INSERT INTO batch (name, batch_id, program_id, inserted_at, updated_at)
     VALUES ($1, $1, $2, ${NOW}, ${NOW}) RETURNING id`,
    [batch.batchId, batch.programId],
    "inserted batch",
  );
  return oneId(
    pool,
    `INSERT INTO "group" (type, child_id, inserted_at, updated_at) VALUES ('batch', $1, ${NOW}, ${NOW}) RETURNING id`,
    [batchId],
    "batch group",
  );
}

async function insertUser(pool: Pool, email: string, role: string, first: string | null, last: string | null) {
  return oneId(
    pool,
    `INSERT INTO "user" (first_name, last_name, email, role, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, ${NOW}, ${NOW}) RETURNING id`,
    [first, last, email, role],
    "inserted user",
  );
}

/** Seed the Schools, centres, Students and personas; returns the centre ids. */
export async function seedAiTestInsightsFixture(pool: Pool): Promise<AiTestInsightsFixtureIds> {
  await removeAiTestInsightsFixture(pool);

  const main = await insertSchool(pool, SCHOOL);
  const other = await insertSchool(pool, OTHER_SCHOOL);
  await insertSchool(pool, NO_CENTRE_SCHOOL);

  const coeCentreId = await insertCentre(pool, "CoE", main.id, PROGRAM_IDS.COE);
  const nodalCentreId = await insertCentre(pool, "Nodal", main.id, PROGRAM_IDS.NODAL);
  const otherCentreId = await insertCentre(pool, "Other CoE", other.id, PROGRAM_IDS.COE);

  const batchGroups = {} as Record<BatchKey, number>;
  for (const key of Object.keys(BATCHES) as BatchKey[]) {
    batchGroups[key] = await insertBatchGroup(pool, BATCHES[key]);
  }

  for (const student of STUDENTS) {
    const gradeId = await oneId(pool, `SELECT id FROM grade WHERE number = $1 ORDER BY id LIMIT 1`, [student.grade], `grade ${student.grade}`);
    const userId = await insertUser(pool, studentEmail(student.key), "student", student.first, student.last);
    await pool.query(
      `INSERT INTO student (student_id, user_id, grade_id, status, stream, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, ${NOW}, ${NOW})`,
      [studentCode(student.key), userId, gradeId, student.status, student.stream],
    );
    const schoolGroupId = student.school === "main" ? main.groupId : other.groupId;
    for (const groupId of [schoolGroupId, ...student.batches.map((key) => batchGroups[key])]) {
      await pool.query(
        `INSERT INTO group_user (group_id, user_id, inserted_at, updated_at) VALUES ($1, $2, ${NOW}, ${NOW})`,
        [groupId, userId],
      );
    }
    await pool.query(
      `INSERT INTO enrollment_record (user_id, group_id, group_type, academic_year, is_current, start_date, inserted_at, updated_at)
       VALUES ($1, $2, 'grade', $3, true, DATE '2026-04-01', ${NOW}, ${NOW})`,
      [userId, gradeId, CURRENT_ACADEMIC_YEAR],
    );
  }

  for (const p of Object.values(AI_TEST_INSIGHTS_PERSONAS) as PersonaFixture[]) {
    const userId = await insertUser(pool, p.email, p.role, null, null);
    await pool.query(
      `INSERT INTO user_permission (email, level, role, program_ids, school_codes, regions, read_only, user_id, revoked_at)
       VALUES ($1, 1, $2, $3, $4, NULL, false, $5, NULL)`,
      [p.email, p.role, p.programIds, p.schoolCodes, userId],
    );
    if (p.seat === "coe") {
      await pool.query(
        `INSERT INTO centre_positions (centre_id, role, user_id, inserted_at, updated_at)
         VALUES ($1, 'teacher', $2, ${NOW}, ${NOW})`,
        [coeCentreId, userId],
      );
    }
  }

  return { coeCentreId, nodalCentreId, otherCentreId };
}

/** Remove everything {@link seedAiTestInsightsFixture} added. */
export async function removeAiTestInsightsFixture(pool: Pool): Promise<void> {
  const users = await pool.query<{ id: number }>(`SELECT id FROM "user" WHERE email = ANY($1)`, [ALL_EMAILS]);
  const userIds = users.rows.map((row) => Number(row.id));
  await pool.query(`DELETE FROM user_permission WHERE email = ANY($1)`, [PERSONA_EMAILS]);
  if (userIds.length > 0) {
    await pool.query(`DELETE FROM centre_positions WHERE user_id = ANY($1)`, [userIds]);
    await pool.query(`DELETE FROM enrollment_record WHERE user_id = ANY($1)`, [userIds]);
    await pool.query(`DELETE FROM group_user WHERE user_id = ANY($1)`, [userIds]);
    await pool.query(`DELETE FROM student WHERE user_id = ANY($1)`, [userIds]);
    await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [userIds]);
  }
  const batches = await pool.query<{ id: number }>(`SELECT id FROM batch WHERE batch_id LIKE $1`, [`${BATCH_PREFIX}%`]);
  const batchIds = batches.rows.map((row) => Number(row.id));
  if (batchIds.length > 0) {
    await pool.query(`DELETE FROM "group" WHERE type = 'batch' AND child_id = ANY($1)`, [batchIds]);
    await pool.query(`DELETE FROM batch WHERE id = ANY($1)`, [batchIds]);
  }
  const schools = await pool.query<{ id: number }>(`SELECT id FROM school WHERE code = ANY($1)`, [SCHOOLS.map((s) => s.code)]);
  const schoolIds = schools.rows.map((row) => Number(row.id));
  if (schoolIds.length > 0) {
    await pool.query(`DELETE FROM centres WHERE school_id = ANY($1)`, [schoolIds]);
    await pool.query(`DELETE FROM "group" WHERE type = 'school' AND child_id = ANY($1)`, [schoolIds]);
    await pool.query(`DELETE FROM school WHERE id = ANY($1)`, [schoolIds]);
  }
}
