import type { Pool } from "pg";

import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "../../src/lib/constants";
import { fixtureIdReader } from "./fixture-ids";

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
// Asha: three submitted sessions by two Teachers (one last year, one edited
//   once), a newer draft; two completed requests (one last year, the other
//   recorded by her 14 Nov session) plus a failed, a no-data and a running
//   one. Her History is declared below.
// Divya: only a draft and a failed request, so 0, 0 and no date.
// Chirag: one submitted session and a running request.
// Bhavya and Esha: nothing.
type Author = "teacher" | "seatedTeacher";
type SessionFixture = {
  state: "submitted" | "draft";
  date: string;
  year: string;
  /** The author persona; the Teacher by default. */
  author?: Author;
  /** Areas of concern and Immediate actions; `E2E concern` and `E2E action` by default. */
  concern?: string;
  action?: string;
  /** `submitted_at`, UTC; the seed's clock by default. */
  submittedAt?: string;
  /** The `occurred_at` (UTC) of one `submitted_edited` audit row by the author, at revision 2. */
  editedAt?: string;
  /** The key of the Student's seeded request the session records. */
  records?: string;
};
type RequestFixture = {
  state: "completed" | "failed" | "no_data" | "queued" | "running";
  year: string;
  /** `requested_at`, UTC; the seed's clock by default (a request in progress must stay fresh). */
  requestedAt?: string;
  /** A request key of the Student's own, for a session to record; `e2e-ati-<n>` otherwise. */
  key?: string;
};

const LAST_YEAR = "2025-2026";
const ASHA_RECORDED_REQUEST = "e2e-ati-asha-recorded";
const ASHA_TEXT = {
  feb: { concern: "Asha drops units in kinematics answers", action: "Unit check on every answer" },
  sep: { concern: "Asha rushes the last ten questions", action: "Timed practice for the last section" },
  nov: { concern: "Asha guesses in chemistry and loses marks", action: "Skip questions below 50% confidence" },
};
const INSIGHT_SESSIONS: Record<string, SessionFixture[]> = {
  asha: [
    { state: "submitted", date: "2026-02-10", year: LAST_YEAR, ...ASHA_TEXT.feb, submittedAt: "2026-02-10 09:00:00" },
    {
      state: "submitted",
      date: "2026-11-14",
      year: CURRENT_ACADEMIC_YEAR,
      ...ASHA_TEXT.nov,
      submittedAt: "2026-11-14 08:00:00",
      records: ASHA_RECORDED_REQUEST,
    },
    {
      state: "submitted",
      date: "2026-09-03",
      year: CURRENT_ACADEMIC_YEAR,
      author: "seatedTeacher",
      ...ASHA_TEXT.sep,
      submittedAt: "2026-09-03 10:00:00",
      // 19:00 UTC on 4 Sep 2026 is 00:30 on 5 Sep 2026 in India.
      editedAt: "2026-09-04 19:00:00",
    },
    { state: "draft", date: "2026-11-20", year: CURRENT_ACADEMIC_YEAR, concern: "Asha draft never shown" },
  ],
  chirag: [{ state: "submitted", date: "2026-10-01", year: CURRENT_ACADEMIC_YEAR }],
  divya: [{ state: "draft", date: "2026-11-25", year: CURRENT_ACADEMIC_YEAR }],
};
const INSIGHT_REQUESTS: Record<string, RequestFixture[]> = {
  asha: [
    // 04:00 UTC is 09:30 on 10 Feb 2026 in India: the day of her February session, an earlier moment.
    { state: "completed", year: LAST_YEAR, requestedAt: "2026-02-10 04:00:00" },
    // 05:00 UTC is 10:30 on 14 Nov 2026 in India.
    { state: "completed", year: CURRENT_ACADEMIC_YEAR, requestedAt: "2026-11-14 05:00:00", key: ASHA_RECORDED_REQUEST },
    { state: "failed", year: CURRENT_ACADEMIC_YEAR },
    { state: "no_data", year: CURRENT_ACADEMIC_YEAR },
    { state: "running", year: CURRENT_ACADEMIC_YEAR },
  ],
  chirag: [{ state: "running", year: CURRENT_ACADEMIC_YEAR }],
  divya: [{ state: "failed", year: CURRENT_ACADEMIC_YEAR }],
};

/**
 * Asha's History on the Student page, newest first, each entry as its lines
 * of text, written by hand from the rows above. The draft, the failed,
 * no-data and running requests are absent, and the request her 14 Nov
 * session records shows only inside it. Seeded requests are of the test
 * `e2e-test-1`, which the specs' picker answer does not hold.
 */
export const AI_TEST_INSIGHTS_ASHA_HISTORY = [
  [
    "14 Nov 2026",
    "Notes by E2E ATI Teacher",
    "Areas of concern",
    ASHA_TEXT.nov.concern,
    "Immediate actions",
    ASHA_TEXT.nov.action,
    "Other notes",
    "e2e-ati-fixture",
    "AI Summary of 14 Nov 2026",
    "Made from: an earlier test",
    "Asked for by E2E ATI Teacher on 14 Nov 2026, 10:30",
  ],
  [
    // The Student page writes dates as en-GB short dates: September is "Sept".
    "3 Sept 2026",
    "Notes by E2E ATI Seated Teacher",
    "Edited on 5 Sept 2026",
    "Areas of concern",
    ASHA_TEXT.sep.concern,
    "Immediate actions",
    ASHA_TEXT.sep.action,
    "Other notes",
    "e2e-ati-fixture",
  ],
  [
    "10 Feb 2026",
    "Notes by E2E ATI Teacher",
    "Areas of concern",
    ASHA_TEXT.feb.concern,
    "Immediate actions",
    ASHA_TEXT.feb.action,
    "Other notes",
    "e2e-ati-fixture",
  ],
  ["AI Summary of 10 Feb 2026", "Made from: an earlier test", "Asked for by E2E ATI Teacher on 10 Feb 2026, 09:30"],
];
/** The Other notes of every Insight Session the helper seeds, so a cleanup can tell them from a spec's. */
const SEEDED_SESSION_NOTE = "e2e-ati-fixture";
const REQUEST_KEY_PREFIX = "e2e-ati-";
const INFERENCE_SESSION_MARKER = "e2e-ati-fixture";
/** The `config_snapshot_json` of every Session the fake generator creates (fake-ai-mentorship-guide.cjs). */
const FAKE_SESSION_MARKER = JSON.stringify({ fake_ai_mentorship_guide: true });

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

interface Persona {
  name: string;
  email: string;
}

interface PersonaFixture extends Persona {
  role: string;
  schoolCodes: string[];
  programIds: number[];
  seat?: "coe";
  readOnly?: boolean;
}

const persona = (
  key: string,
  name: string,
  role: string,
  schoolCodes: string[],
  programIds: number[],
  options: { seat?: "coe"; readOnly?: boolean } = {},
): PersonaFixture => ({
  name,
  email: `e2e-ati-${key}@test.local`,
  role,
  schoolCodes,
  programIds,
  ...options,
});

export const AI_TEST_INSIGHTS_PERSONAS = {
  teacher: persona("teacher", "E2E ATI Teacher", "teacher", [SCHOOL.code, NO_CENTRE_SCHOOL.code], [PROGRAM_IDS.COE, PROGRAM_IDS.NODAL]),
  seatedTeacher: persona("seated-teacher", "E2E ATI Seated Teacher", "teacher", [], [], { seat: "coe" }),
  readOnlyTeacher: persona("read-only-teacher", "E2E ATI Read-only Teacher", "teacher", [SCHOOL.code], [PROGRAM_IDS.COE, PROGRAM_IDS.NODAL], { readOnly: true }),
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

const oneId = fixtureIdReader("AI Test Insights");

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
    // The persona's name is its User's, which the AI Summary shows as who asked for it.
    const userId = await insertUser(pool, p.email, p.role, p.name, null);
    personaUserIds[p.email] = userId;
    await pool.query(
      `INSERT INTO user_permission (email, level, role, program_ids, school_codes, regions, read_only, user_id, revoked_at)
       VALUES ($1, 1, $2, $3, $4, NULL, $6, $5, NULL)`,
      [p.email, p.role, p.programIds, p.schoolCodes, userId, p.readOnly === true],
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
    authorUserIds: {
      teacher: personaUserIds[AI_TEST_INSIGHTS_PERSONAS.teacher.email],
      seatedTeacher: personaUserIds[AI_TEST_INSIGHTS_PERSONAS.seatedTeacher.email],
    },
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
 * The Item a request is linked to, with its Student and Session status, and
 * that Item's files, oldest first; null when the request has no Item.
 */
export async function readInsightRequestItem(
  pool: Pool,
  requestKey: string,
): Promise<{
  itemId: number;
  studentId: number;
  status: string;
  sessionStatus: string;
  files: Array<{ fileKind: string; logicalPath: string; s3Key: string; mimeType: string; byteSize: number }>;
} | null> {
  const items = await pool.query(
    `SELECT i.id, i.student_id, i.status, s.status AS session_status
     FROM ai_test_insight_requests r
     JOIN acad_mentorship_inference_items i ON i.id = r.inference_item_id
     JOIN acad_mentorship_inference_sessions s ON s.id = i.session_id
     WHERE r.request_key = $1`,
    [requestKey],
  );
  const item = items.rows[0];
  if (!item) return null;
  const files = await pool.query(
    `SELECT file_kind, logical_path, s3_key, mime_type, byte_size
     FROM acad_mentorship_inference_item_files WHERE item_id = $1 ORDER BY id`,
    [item.id],
  );
  return {
    itemId: Number(item.id),
    studentId: Number(item.student_id),
    status: item.status,
    sessionStatus: item.session_status,
    files: files.rows.map((row) => ({
      fileKind: row.file_kind,
      logicalPath: row.logical_path,
      s3Key: row.s3_key,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
    })),
  };
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

/**
 * Moves a request's `requested_at` back by this many minutes, so a spec need
 * not wait out the 20 minutes after which a request in progress has stalled.
 * Only `requested_at` moves: the row is otherwise as it was.
 */
export async function backdateInsightRequest(pool: Pool, requestKey: string, minutes: number): Promise<void> {
  const result = await pool.query(
    `UPDATE ai_test_insight_requests SET requested_at = requested_at - make_interval(mins => $2) WHERE request_key = $1`,
    [requestKey, minutes],
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
 * running; a session records a completed request of the same Student. All
 * on the CoE Program. Requests go in first, so a session can record one.
 */
type InsightRowsContext = { studentIds: Record<string, number>; schoolId: number; authorUserIds: Record<Author, number> };

async function insertInsightRows(pool: Pool, context: InsightRowsContext) {
  await insertInsightRequests(pool, context);
  await insertInsightSessions(pool, context);
}

/** One original Item per inference session and Student, so each completed request gets its own inference session. */
async function insertCompletedRequestItem(pool: Pool, programId: number, studentId: number): Promise<number> {
  const inferenceSessionId = await oneId(
    pool,
    `INSERT INTO acad_mentorship_inference_sessions (program_id, status, config_snapshot_json)
     VALUES ($1, 'completed', $2) RETURNING id`,
    [programId, INFERENCE_SESSION_MARKER],
    "inference session",
  );
  return oneId(
    pool,
    `INSERT INTO acad_mentorship_inference_items (session_id, student_id, status)
     VALUES ($1, $2, 'completed') RETURNING id`,
    [inferenceSessionId, studentId],
    "inference item",
  );
}

const REQUEST_OUTCOMES: Partial<Record<RequestFixture["state"], string>> = { failed: "pipeline_error", no_data: "no_tests" };

async function insertInsightRequests(pool: Pool, { studentIds, schoolId, authorUserIds }: InsightRowsContext) {
  const programId = PROGRAM_IDS.COE;
  let requestNumber = 0;
  for (const [key, requests] of Object.entries(INSIGHT_REQUESTS)) {
    for (const request of requests) {
      const studentId = studentIds[key];
      const itemId = request.state === "completed" ? await insertCompletedRequestItem(pool, programId, studentId) : null;
      const started = request.state !== "queued";
      const finished = !["queued", "running"].includes(request.state);
      const outcome = REQUEST_OUTCOMES[request.state] ?? null;
      ++requestNumber;
      await pool.query(
        `INSERT INTO ai_test_insight_requests
           (request_key, student_id, school_id, program_id, academic_year, requested_by_user_id,
            selected_test_ids, state, outcome_code, inference_item_id, requested_at, started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, '["e2e-test-1"]'::jsonb, $7, $8, $9,
                 COALESCE($12::timestamp, ${NOW}),
                 CASE WHEN $10::boolean THEN COALESCE($12::timestamp, ${NOW}) END,
                 CASE WHEN $11::boolean THEN COALESCE($12::timestamp + interval '4 minutes', ${NOW}) END)`,
        [
          request.key ?? `${REQUEST_KEY_PREFIX}${requestNumber}`,
          studentId,
          schoolId,
          programId,
          request.year,
          authorUserIds.teacher,
          request.state,
          outcome,
          itemId,
          started,
          finished,
          request.requestedAt ?? null,
        ],
      );
    }
  }
}

async function insertInsightSessions(pool: Pool, { studentIds, schoolId, authorUserIds }: InsightRowsContext) {
  const programId = PROGRAM_IDS.COE;
  for (const [key, sessions] of Object.entries(INSIGHT_SESSIONS)) {
    for (const session of sessions) {
      const submitted = session.state === "submitted";
      const authorUserId = authorUserIds[session.author ?? "teacher"];
      const sessionId = await oneId(
        pool,
        `INSERT INTO ai_test_insight_sessions
           (student_id, school_id, program_id, academic_year, author_user_id, state, session_date,
            areas_of_concern, immediate_actions, other_notes, submitted_at, insight_request_id, revision)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $10, $11, $9,
                 CASE WHEN $8::boolean THEN COALESCE($12::timestamp, ${NOW}) END,
                 (SELECT id FROM ai_test_insight_requests WHERE request_key = $13 AND student_id = $1),
                 $14)
         RETURNING id`,
        [
          studentIds[key],
          schoolId,
          programId,
          session.year,
          authorUserId,
          session.state,
          session.date,
          submitted,
          SEEDED_SESSION_NOTE,
          session.concern ?? "E2E concern",
          session.action ?? "E2E action",
          session.submittedAt ?? null,
          session.records ?? null,
          session.editedAt ? 2 : 1,
        ],
        "inserted Insight Session",
      );
      if (session.editedAt) {
        await pool.query(
          `INSERT INTO ai_test_insight_session_note_audits (session_id, actor_user_id, action, revision, occurred_at, inserted_at)
           VALUES ($1, $2, 'submitted_edited', 2, $3::timestamp, ${NOW})`,
          [sessionId, authorUserId, session.editedAt],
        );
      }
    }
  }
}

/** An Insight Session row as stored, with its times as seconds since the epoch, read as UTC. */
export interface StoredInsightSession {
  id: number;
  studentId: number;
  schoolId: number;
  programId: number;
  academicYear: string;
  authorUserId: number;
  state: string;
  sessionDate: string | null;
  areasOfConcern: string | null;
  immediateActions: string | null;
  otherNotes: string | null;
  insightRequestId: number | null;
  revision: number;
  submittedAt: number | null;
  insertedAt: number;
  updatedAt: number;
}

/** The Student's Insight Sessions, drafts too, oldest first. */
export async function readInsightSessions(pool: Pool, studentId: number): Promise<StoredInsightSession[]> {
  const result = await pool.query(
    `SELECT id, student_id, school_id, program_id, academic_year, author_user_id, state,
            to_char(session_date, 'YYYY-MM-DD') AS session_date,
            areas_of_concern, immediate_actions, other_notes, insight_request_id, revision,
            EXTRACT(EPOCH FROM submitted_at)::float8 AS submitted_at,
            EXTRACT(EPOCH FROM inserted_at)::float8 AS inserted_at,
            EXTRACT(EPOCH FROM updated_at)::float8 AS updated_at
     FROM ai_test_insight_sessions
     WHERE student_id = $1
     ORDER BY id`,
    [studentId],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    studentId: Number(row.student_id),
    schoolId: Number(row.school_id),
    programId: Number(row.program_id),
    academicYear: row.academic_year,
    authorUserId: Number(row.author_user_id),
    state: row.state,
    sessionDate: row.session_date,
    areasOfConcern: row.areas_of_concern,
    immediateActions: row.immediate_actions,
    otherNotes: row.other_notes,
    insightRequestId: row.insight_request_id === null ? null : Number(row.insight_request_id),
    revision: Number(row.revision),
    submittedAt: row.submitted_at === null ? null : Number(row.submitted_at),
    insertedAt: Number(row.inserted_at),
    updatedAt: Number(row.updated_at),
  }));
}

/** A Session Note audit row as stored, with its time as seconds since the epoch, read as UTC. */
export interface StoredSessionNoteAudit {
  sessionId: number;
  actorUserId: number;
  action: string;
  revision: number;
  occurredAt: number;
}

/** The audit rows of the Student's Insight Sessions, oldest first. */
export async function readSessionNoteAudits(pool: Pool, studentId: number): Promise<StoredSessionNoteAudit[]> {
  const result = await pool.query(
    `SELECT a.session_id, a.actor_user_id, a.action, a.revision,
            EXTRACT(EPOCH FROM a.occurred_at)::float8 AS occurred_at
     FROM ai_test_insight_session_note_audits a
     JOIN ai_test_insight_sessions s ON s.id = a.session_id
     WHERE s.student_id = $1
     ORDER BY a.id`,
    [studentId],
  );
  return result.rows.map((row) => ({
    sessionId: Number(row.session_id),
    actorUserId: Number(row.actor_user_id),
    action: row.action,
    revision: Number(row.revision),
    occurredAt: Number(row.occurred_at),
  }));
}

/**
 * Deletes the Insight Sessions matching `where` (placeholders from `$1`) and
 * their audit rows, in one transaction. Audit rows are append-only (a
 * trigger) and a session with one cannot be deleted, so the trigger is
 * skipped for this test-database cleanup only.
 */
async function deleteInsightSessions(pool: Pool, where: string, params: unknown[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `DELETE FROM ai_test_insight_session_note_audits
       WHERE session_id IN (SELECT id FROM ai_test_insight_sessions WHERE ${where})`,
      params,
    );
    await client.query(`DELETE FROM ai_test_insight_sessions WHERE ${where}`, params);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes the Insight Sessions a spec made for these Students (every one the
 * helper did not seed), drafts and submitted ones, with their audit rows, so
 * the next spec finds the Students as seeded.
 */
export async function removeInsightSessionsMadeBySpecs(pool: Pool, studentIds: number[]): Promise<void> {
  await deleteInsightSessions(pool, `student_id = ANY($1::bigint[]) AND other_notes IS DISTINCT FROM $2`, [
    studentIds,
    SEEDED_SESSION_NOTE,
  ]);
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
  await removeFakeGeneratorItems(pool, [studentId]);
}

/**
 * Removes the Sessions, Items and Item Files the fake generator wrote when it
 * completed a request of these Students (its Sessions carry
 * {@link FAKE_SESSION_MARKER}). Item Files go with their Item.
 */
async function removeFakeGeneratorItems(pool: Pool, studentIds: number[]): Promise<void> {
  const removed = await pool.query<{ session_id: string }>(
    `DELETE FROM acad_mentorship_inference_items
     WHERE student_id = ANY($1::bigint[])
       AND session_id IN (SELECT id FROM acad_mentorship_inference_sessions WHERE config_snapshot_json = $2)
     RETURNING session_id`,
    [studentIds, FAKE_SESSION_MARKER],
  );
  await pool.query(`DELETE FROM acad_mentorship_inference_sessions WHERE id = ANY($1::bigint[])`, [
    removed.rows.map((row) => Number(row.session_id)),
  ]);
}

/** Remove everything {@link seedAiTestInsightsFixture} added. */
export async function removeAiTestInsightsFixture(pool: Pool): Promise<void> {
  const users = await pool.query<{ id: number }>(`SELECT id FROM "user" WHERE email = ANY($1)`, [ALL_EMAILS]);
  const userIds = users.rows.map((row) => Number(row.id));
  await deleteInsightSessions(
    pool,
    `student_id IN (SELECT id FROM student WHERE user_id = ANY($1)) OR author_user_id = ANY($1)`,
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
  const students = await pool.query<{ id: string }>(`SELECT id FROM student WHERE user_id = ANY($1)`, [userIds]);
  await removeFakeGeneratorItems(pool, students.rows.map((row) => Number(row.id)));
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
