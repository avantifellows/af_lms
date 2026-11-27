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
  gender?: string;
  category?: string;
}

// Listed: JEE (engineering in any spelling and case), Grade 11 or 12, not a
// dropout, on an active CoE or Nodal centre's roster. Esha is on both centres.
const LISTED: StudentFixture[] = [
  { key: "asha", first: "Asha", last: "Atiq", grade: 11, stream: "Engineering", status: "active", school: "main", batches: ["coe"], gender: "Female", category: "OBC" },
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

// Insight Sessions and Insight Requests the helper adds, by listed Student.
// Only `submitted` sessions and `completed` requests count, across every
// academic year; the newest submitted `session_date` is the last session.
// Asha: three submitted sessions (one last year), a newer draft; two completed
//   requests (one last year) plus a failed, a no-data and a queued one.
// Divya: only a draft and a failed request, so 0, 0 and no date.
// Chirag: one submitted session and a running request.
// Bhavya and Esha: nothing.
type SessionFixture = { state: "submitted" | "draft"; date: string; year: string };
type RequestFixture = { state: "completed" | "failed" | "no_data" | "queued" | "running"; year: string };

const LAST_YEAR = "2025-2026";
const INSIGHT_SESSIONS: Record<string, SessionFixture[]> = {
  asha: [
    { state: "submitted", date: "2026-02-10", year: LAST_YEAR },
    { state: "submitted", date: "2026-11-14", year: CURRENT_ACADEMIC_YEAR },
    { state: "submitted", date: "2026-09-03", year: CURRENT_ACADEMIC_YEAR },
    { state: "draft", date: "2026-11-20", year: CURRENT_ACADEMIC_YEAR },
  ],
  chirag: [{ state: "submitted", date: "2026-10-01", year: CURRENT_ACADEMIC_YEAR }],
  divya: [{ state: "draft", date: "2026-11-25", year: CURRENT_ACADEMIC_YEAR }],
};
const INSIGHT_REQUESTS: Record<string, RequestFixture[]> = {
  asha: [
    { state: "completed", year: LAST_YEAR },
    { state: "completed", year: CURRENT_ACADEMIC_YEAR },
    { state: "failed", year: CURRENT_ACADEMIC_YEAR },
    { state: "no_data", year: CURRENT_ACADEMIC_YEAR },
    { state: "queued", year: CURRENT_ACADEMIC_YEAR },
  ],
  chirag: [{ state: "running", year: CURRENT_ACADEMIC_YEAR }],
  divya: [{ state: "failed", year: CURRENT_ACADEMIC_YEAR }],
};
const REQUEST_KEY_PREFIX = "e2e-ati-";
const INFERENCE_SESSION_MARKER = "e2e-ati-fixture";

/**
 * The rows the tab must show, in its order (Grade, then name), as [name,
 * Student ID, Grade, Insight Sessions completed, Test Insights generated,
 * Last Insight Session].
 */
const ROW = {
  asha: ["Asha Atiq", "E2E-ATI-ASHA", "11", "3", "2", "14 Nov 2026"],
  chirag: ["Chirag Chand", "E2E-ATI-CHIRAG", "11", "1", "0", "1 Oct 2026"],
  esha: ["Esha Ekka", "E2E-ATI-ESHA", "11", "0", "0", ""],
  bhavya: ["Bhavya Bose", "E2E-ATI-BHAVYA", "12", "0", "0", ""],
  divya: ["Divya Dutt", "E2E-ATI-DIVYA", "12", "0", "0", ""],
};
export const AI_TEST_INSIGHTS_ROWS = ROW;
export const AI_TEST_INSIGHTS_SCHOOL_LIST = [ROW.asha, ROW.chirag, ROW.esha, ROW.bhavya, ROW.divya];
export const AI_TEST_INSIGHTS_COE_CENTRE_LIST = [ROW.asha, ROW.chirag, ROW.esha, ROW.bhavya];
export const AI_TEST_INSIGHTS_NODAL_CENTRE_LIST = [ROW.esha, ROW.divya];

/**
 * The Student card on the Student page, as [label, value] pairs. Batch is the
 * Student's current batches in the Program of the centre the page is for:
 * Esha is on both centres, so the School page (lowest centre id, CoE) and the
 * Nodal Centre page show different batches. A missing value is a dash.
 * Newest test comes from the test picker's read of the warehouse, which e2e
 * does not have: left unanswered, it reads "unavailable". Specs that answer
 * the picker route in the browser check the line themselves.
 */
const CARD_FIELDS = (fields: string[]) =>
  [
    "Student ID",
    "Grade",
    "Batch",
    "Gender",
    "Category",
    "Stream",
    "Insight Sessions completed",
    "Last Insight Session",
    "Newest test",
  ].map((label, index) => [label, [...fields, "unavailable"][index]]);
export const AI_TEST_INSIGHTS_CARDS = {
  asha: { name: "Asha Atiq", fields: CARD_FIELDS(["E2E-ATI-ASHA", "11", "E2E-ATI-COE", "Female", "OBC", "Engineering", "3", "14 Nov 2026"]) },
  eshaFromCoe: { name: "Esha Ekka", fields: CARD_FIELDS(["E2E-ATI-ESHA", "11", "E2E-ATI-COE", "—", "—", "engineering", "0", "—"]) },
  eshaFromNodal: { name: "Esha Ekka", fields: CARD_FIELDS(["E2E-ATI-ESHA", "11", "E2E-ATI-NODAL", "—", "—", "engineering", "0", "—"]) },
  chirag: { name: "Chirag Chand", fields: CARD_FIELDS(["E2E-ATI-CHIRAG", "11", "E2E-ATI-COE", "—", "—", "engg", "1", "1 Oct 2026"]) },
};

/**
 * Students no centre lists, by key; their Student page is not found for
 * everyone. (Kabir, "other", is listed by the other School's centre.)
 */
export const AI_TEST_INSIGHTS_NOT_LISTED_KEYS = ["medical", "blank", "dropout", "grade10", "nvs"] as const;

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
  /** The main School's `school.id`. */
  schoolId: number;
  coeCentreId: number;
  nodalCentreId: number;
  otherCentreId: number;
  /** `student.id` by fixture key (asha, esha, medical, …). */
  studentIds: Record<string, number>;
  /** Each persona's `user.id`, by persona email. */
  personaUserIds: Record<string, number>;
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

async function insertBatchGroup(pool: Pool, batch: { batchId: string; programId: number }): Promise<{ batchId: number; groupId: number }> {
  const batchId = await oneId(
    pool,
    `INSERT INTO batch (name, batch_id, program_id, inserted_at, updated_at)
     VALUES ($1, $1, $2, ${NOW}, ${NOW}) RETURNING id`,
    [batch.batchId, batch.programId],
    "inserted batch",
  );
  const groupId = await oneId(
    pool,
    `INSERT INTO "group" (type, child_id, inserted_at, updated_at) VALUES ('batch', $1, ${NOW}, ${NOW}) RETURNING id`,
    [batchId],
    "batch group",
  );
  return { batchId, groupId };
}

async function insertUser(
  pool: Pool,
  email: string,
  role: string,
  first: string | null,
  last: string | null,
  gender: string | null = null,
) {
  return oneId(
    pool,
    `INSERT INTO "user" (first_name, last_name, email, role, gender, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, ${NOW}, ${NOW}) RETURNING id`,
    [first, last, email, role, gender],
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

  const batchGroups = {} as Record<BatchKey, { batchId: number; groupId: number }>;
  for (const key of Object.keys(BATCHES) as BatchKey[]) {
    batchGroups[key] = await insertBatchGroup(pool, BATCHES[key]);
  }

  const studentIds: Record<string, number> = {};
  for (const student of STUDENTS) {
    const gradeId = await oneId(pool, `SELECT id FROM grade WHERE number = $1 ORDER BY id LIMIT 1`, [student.grade], `grade ${student.grade}`);
    const userId = await insertUser(pool, studentEmail(student.key), "student", student.first, student.last, student.gender ?? null);
    studentIds[student.key] = await oneId(
      pool,
      `INSERT INTO student (student_id, user_id, grade_id, status, stream, category, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${NOW}, ${NOW}) RETURNING id`,
      [studentCode(student.key), userId, gradeId, student.status, student.stream, student.category ?? null],
      "inserted student",
    );
    const schoolGroupId = student.school === "main" ? main.groupId : other.groupId;
    for (const groupId of [schoolGroupId, ...student.batches.map((key) => batchGroups[key].groupId)]) {
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
    // The current batch enrollments the Student card's Batch reads.
    for (const key of student.batches) {
      await pool.query(
        `INSERT INTO enrollment_record (user_id, group_id, group_type, academic_year, is_current, start_date, inserted_at, updated_at)
         VALUES ($1, $2, 'batch', $3, true, DATE '2026-04-01', ${NOW}, ${NOW})`,
        [userId, batchGroups[key].batchId, CURRENT_ACADEMIC_YEAR],
      );
    }
  }

  const personaUserIds: Record<string, number> = {};
  for (const p of Object.values(AI_TEST_INSIGHTS_PERSONAS) as PersonaFixture[]) {
    const userId = await insertUser(pool, p.email, p.role, null, null);
    personaUserIds[p.email] = userId;
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

  await insertInsightRows(pool, {
    studentIds,
    schoolId: main.id,
    teacherUserId: personaUserIds[AI_TEST_INSIGHTS_PERSONAS.teacher.email],
  });

  return { schoolId: main.id, coeCentreId, nodalCentreId, otherCentreId, studentIds, personaUserIds };
}

/** An Insight Request row as stored, with its times as seconds since the epoch, read as UTC. */
export interface StoredInsightRequest {
  requestKey: string;
  state: string;
  outcomeCode: string | null;
  selectedTestIds: unknown;
  notesSnapshot: unknown;
  requestedByUserId: number;
  schoolId: number;
  programId: number;
  academicYear: string;
  requestedAt: number;
  insertedAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** The Student's Insight Requests, oldest first. */
export async function readInsightRequests(pool: Pool, studentId: number): Promise<StoredInsightRequest[]> {
  const result = await pool.query(
    `SELECT request_key, state, outcome_code, selected_test_ids, notes_snapshot, requested_by_user_id, school_id, program_id,
            academic_year,
            EXTRACT(EPOCH FROM requested_at)::float8 AS requested_at,
            EXTRACT(EPOCH FROM inserted_at)::float8 AS inserted_at,
            EXTRACT(EPOCH FROM updated_at)::float8 AS updated_at,
            EXTRACT(EPOCH FROM started_at)::float8 AS started_at,
            EXTRACT(EPOCH FROM finished_at)::float8 AS finished_at
     FROM ai_test_insight_requests
     WHERE student_id = $1
     ORDER BY id`,
    [studentId],
  );
  return result.rows.map((row) => ({
    requestKey: row.request_key,
    state: row.state,
    outcomeCode: row.outcome_code,
    selectedTestIds: row.selected_test_ids,
    notesSnapshot: row.notes_snapshot,
    requestedByUserId: Number(row.requested_by_user_id),
    schoolId: Number(row.school_id),
    programId: Number(row.program_id),
    academicYear: row.academic_year,
    requestedAt: Number(row.requested_at),
    insertedAt: Number(row.inserted_at),
    updatedAt: Number(row.updated_at),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  }));
}

/**
 * Moves a request's `updated_at` back by this many seconds, so a spec need not
 * wait out the 30 seconds between re-deliveries.
 */
export async function backdateInsightRequestUpdate(pool: Pool, requestKey: string, seconds: number): Promise<void> {
  const result = await pool.query(
    `UPDATE ai_test_insight_requests SET updated_at = updated_at - make_interval(secs => $2) WHERE request_key = $1`,
    [requestKey, seconds],
  );
  if (result.rowCount !== 1) throw new Error("AI Test Insights fixture: no request to back-date");
}

/** Moves a `queued` request to `running`, as AI Mentorship Guide does when it claims it. */
export async function markInsightRequestRunning(pool: Pool, requestKey: string): Promise<void> {
  const result = await pool.query(
    `UPDATE ai_test_insight_requests
     SET state = 'running', started_at = ${NOW}, updated_at = ${NOW}
     WHERE request_key = $1 AND state = 'queued'`,
    [requestKey],
  );
  if (result.rowCount !== 1) throw new Error("AI Test Insights fixture: no queued request to move to running");
}

/**
 * Ends a `queued` or `running` request without an AI Summary, as AI Mentorship
 * Guide does: `no_data` or `failed` with an outcome code, in UTC, with
 * `updated_at` set, and only while the request is still in progress.
 */
export async function endInsightRequestWithoutSummary(
  pool: Pool,
  requestKey: string,
  state: "no_data" | "failed",
  outcomeCode: string,
): Promise<void> {
  const result = await pool.query(
    `UPDATE ai_test_insight_requests
     SET state = $2, outcome_code = $3, started_at = COALESCE(started_at, ${NOW}),
         finished_at = ${NOW}, updated_at = ${NOW}
     WHERE request_key = $1 AND state IN ('queued', 'running')`,
    [requestKey, state, outcomeCode],
  );
  if (result.rowCount !== 1) throw new Error("AI Test Insights fixture: no request in progress to end");
}

/**
 * Insight Sessions and Insight Requests for the listed Students, as declared
 * above. Rows satisfy the mirrored tables' CHECKs: a submitted session has a
 * date, both required notes and `submitted_at`; a completed request links an
 * Item of the same Student, and only one request per Student is queued or
 * running. All on the CoE Program.
 */
async function insertInsightRows(
  pool: Pool,
  { studentIds, schoolId, teacherUserId }: { studentIds: Record<string, number>; schoolId: number; teacherUserId: number },
) {
  const programId = PROGRAM_IDS.COE;
  for (const [key, sessions] of Object.entries(INSIGHT_SESSIONS)) {
    for (const session of sessions) {
      const submitted = session.state === "submitted";
      await pool.query(
        `INSERT INTO ai_test_insight_sessions
           (student_id, school_id, program_id, academic_year, author_user_id, state, session_date,
            areas_of_concern, immediate_actions, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'E2E concern', 'E2E action',
                 CASE WHEN $8::boolean THEN ${NOW} END)`,
        [studentIds[key], schoolId, programId, session.year, teacherUserId, session.state, session.date, submitted],
      );
    }
  }

  let requestNumber = 0;
  for (const [key, requests] of Object.entries(INSIGHT_REQUESTS)) {
    for (const request of requests) {
      const studentId = studentIds[key];
      let itemId: number | null = null;
      if (request.state === "completed") {
        // One original Item per inference session and Student, so each
        // completed request gets its own inference session.
        const inferenceSessionId = await oneId(
          pool,
          `INSERT INTO acad_mentorship_inference_sessions (program_id, status, config_snapshot_json)
           VALUES ($1, 'completed', $2) RETURNING id`,
          [programId, INFERENCE_SESSION_MARKER],
          "inference session",
        );
        itemId = await oneId(
          pool,
          `INSERT INTO acad_mentorship_inference_items (session_id, student_id, status)
           VALUES ($1, $2, 'completed') RETURNING id`,
          [inferenceSessionId, studentId],
          "inference item",
        );
      }
      const started = request.state !== "queued";
      const finished = !["queued", "running"].includes(request.state);
      const outcome = request.state === "failed" ? "pipeline_error" : request.state === "no_data" ? "no_tests" : null;
      await pool.query(
        `INSERT INTO ai_test_insight_requests
           (request_key, student_id, school_id, program_id, academic_year, requested_by_user_id,
            selected_test_ids, state, outcome_code, inference_item_id, started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, '["e2e-test-1"]'::jsonb, $7, $8, $9,
                 CASE WHEN $10::boolean THEN ${NOW} END, CASE WHEN $11::boolean THEN ${NOW} END)`,
        [
          `${REQUEST_KEY_PREFIX}${++requestNumber}`,
          studentId,
          schoolId,
          programId,
          request.year,
          teacherUserId,
          request.state,
          outcome,
          itemId,
          started,
          finished,
        ],
      );
    }
  }
}

/**
 * Removes the Insight Requests a spec made for a Student (those whose key the
 * fixture did not write), so the next spec finds the Student as seeded.
 */
export async function removeInsightRequestsMadeBySpecs(pool: Pool, studentId: number): Promise<void> {
  await pool.query(
    `DELETE FROM ai_test_insight_requests WHERE student_id = $1 AND request_key NOT LIKE $2`,
    [studentId, `${REQUEST_KEY_PREFIX}%`],
  );
}

/** Remove everything {@link seedAiTestInsightsFixture} added. */
export async function removeAiTestInsightsFixture(pool: Pool): Promise<void> {
  const users = await pool.query<{ id: number }>(`SELECT id FROM "user" WHERE email = ANY($1)`, [ALL_EMAILS]);
  const userIds = users.rows.map((row) => Number(row.id));
  await pool.query(
    `DELETE FROM ai_test_insight_sessions
     WHERE student_id IN (SELECT id FROM student WHERE user_id = ANY($1)) OR author_user_id = ANY($1)`,
    [userIds],
  );
  await pool.query(
    `DELETE FROM ai_test_insight_requests
     WHERE request_key LIKE $1 OR student_id IN (SELECT id FROM student WHERE user_id = ANY($2))`,
    [`${REQUEST_KEY_PREFIX}%`, userIds],
  );
  await pool.query(
    `DELETE FROM acad_mentorship_inference_items
     WHERE session_id IN (SELECT id FROM acad_mentorship_inference_sessions WHERE config_snapshot_json = $1)`,
    [INFERENCE_SESSION_MARKER],
  );
  await pool.query(`DELETE FROM acad_mentorship_inference_sessions WHERE config_snapshot_json = $1`, [INFERENCE_SESSION_MARKER]);
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
