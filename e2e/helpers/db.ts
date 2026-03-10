import { Pool } from "pg";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { insertTestUsers } from "./test-users";
import { AF_TEAM_INTERACTION_CONFIG } from "../../src/lib/af-team-interaction";
import {
  CLASSROOM_OBSERVATION_RUBRIC,
  CURRENT_RUBRIC_VERSION,
} from "../../src/lib/classroom-observation-rubric";
import { INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG } from "../../src/lib/individual-af-teacher-interaction";
import { PRINCIPAL_INTERACTION_CONFIG } from "../../src/lib/principal-interaction";

const TEST_DB = "af_lms_test";
const DUMP_FILE = path.resolve(__dirname, "../fixtures/db-dump.sql");
const MIGRATIONS_DIR = path.resolve(__dirname, "../fixtures/migrations");

function getDbUser(): string {
  return process.env.TEST_DB_USER || "postgres";
}

function getDbPassword(): string {
  return process.env.TEST_DB_PASSWORD || "postgres";
}

function getMaintenancePool(): Pool {
  return new Pool({
    host: "localhost",
    port: 5432,
    user: getDbUser(),
    password: getDbPassword(),
    database: "postgres",
    ssl: false,
  });
}

export function getTestPool(): Pool {
  return new Pool({
    host: "localhost",
    port: 5432,
    user: getDbUser(),
    password: getDbPassword(),
    database: TEST_DB,
    ssl: false,
  });
}

function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function applyE2eMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS e2e_schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
    )
  `);

  const applied = await pool.query<{ version: string }>(
    `SELECT version FROM e2e_schema_migrations`
  );
  const appliedVersions = new Set(applied.rows.map((row) => row.version));

  for (const fileName of getMigrationFiles()) {
    const version = fileName.replace(/\.sql$/, "");
    if (appliedVersions.has(version)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
    await pool.query(sql);
    await pool.query(
      `INSERT INTO e2e_schema_migrations (version) VALUES ($1)`,
      [version]
    );
  }
}

/**
 * Drop and recreate the test database, load the dump, and insert test users.
 */
export async function resetDatabase(): Promise<void> {
  if (!fs.existsSync(DUMP_FILE)) {
    throw new Error(
      `DB dump not found at ${DUMP_FILE}.\n` +
        `Create it with: pg_dump --no-owner --no-privileges --clean --if-exists -f e2e/fixtures/db-dump.sql <your-local-db>`
    );
  }

  const maintenance = getMaintenancePool();

  try {
    // Terminate existing connections to the test DB
    await maintenance.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB]
    );

    // Drop and recreate
    await maintenance.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await maintenance.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await maintenance.end();
  }

  // Load the dump via psql
  const pgEnv = {
    ...process.env,
    PGPASSWORD: getDbPassword(),
  };

  execSync(
    `psql -h localhost -p 5432 -U ${getDbUser()} -d ${TEST_DB} -f "${DUMP_FILE}" --quiet`,
    { env: pgEnv, stdio: "pipe" }
  );

  // Insert deterministic test users
  const testPool = getTestPool();
  try {
    await applyE2eMigrations(testPool);
    await insertTestUsers(testPool);
  } finally {
    await testPool.end();
  }
}

/**
 * Drop the test database entirely (used in global teardown).
 */
export async function dropDatabase(): Promise<void> {
  const maintenance = getMaintenancePool();
  try {
    await maintenance.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB]
    );
    await maintenance.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  } finally {
    await maintenance.end();
  }
}

/**
 * Seed a test visit for the PM test user.
 * Finds a school in AHMEDABAD region (or uses provided code) and inserts an in_progress visit.
 */
export async function seedTestVisit(
  pool: Pool,
  schoolCode?: string
): Promise<{ visitId: number; schoolCode: string }> {
  if (!schoolCode) {
    const schoolResult = await pool.query(
      `SELECT code FROM school WHERE region = 'AHMEDABAD' LIMIT 1`
    );
    if (schoolResult.rows.length === 0) {
      throw new Error(
        "No school found in AHMEDABAD region — check db-dump.sql"
      );
    }
    schoolCode = schoolResult.rows[0].code as string;
  }

  const result = await pool.query(
    `INSERT INTO lms_pm_school_visits
       (school_code, pm_email, visit_date, status,
        start_lat, start_lng, start_accuracy)
     VALUES ($1, $2, CURRENT_DATE, 'in_progress', 23.0225, 72.5714, 50)
     RETURNING id`,
    [schoolCode, "e2e-pm@test.local"]
  );

  return { visitId: result.rows[0].id, schoolCode: schoolCode as string };
}

export type SeedActionStatus = "pending" | "in_progress" | "completed";

interface SeedVisitActionParams {
  actionType: string;
  status?: SeedActionStatus;
  data?: Record<string, unknown>;
}

/**
 * Canonical strict-valid classroom observation payload for completed action fixtures.
 */
export function buildCompleteClassroomObservationData(): Record<string, unknown> {
  const params = Object.fromEntries(
    CLASSROOM_OBSERVATION_RUBRIC.parameters.map((parameter) => [
      parameter.key,
      { score: parameter.options[0]!.score },
    ])
  );

  return {
    rubric_version: CURRENT_RUBRIC_VERSION,
    teacher_id: 1,
    teacher_name: "E2E Test Teacher",
    grade: "10",
    params,
    observer_summary_strengths: "Strong student engagement and concept clarity.",
    observer_summary_improvements: "Improve recap pacing near class closure.",
  };
}

/**
 * Canonical strict-valid AF team interaction payload for completed action fixtures.
 */
export function buildCompleteAFTeamInteractionData(): Record<string, unknown> {
  const questions: Record<string, { answer: boolean }> = {};
  for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
    questions[key] = { answer: true };
  }
  return {
    teachers: [{ id: 1, name: "Test Teacher" }],
    questions,
  };
}

/**
 * Canonical strict-valid individual teacher interaction payload for completed action fixtures.
 * Each teacher is marked 'present' with all 13 questions answered true.
 */
export function buildCompleteIndividualTeacherInteractionData(
  teacherIds?: { id: number; name: string }[]
): Record<string, unknown> {
  const teachers = (
    teacherIds ?? [
      { id: 1, name: "Test Teacher 1" },
      { id: 2, name: "Test Teacher 2" },
      { id: 3, name: "Test Teacher 3" },
    ]
  ).map((t) => {
    const questions: Record<string, { answer: boolean }> = {};
    for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: true };
    }
    return {
      id: t.id,
      name: t.name,
      attendance: "present",
      questions,
    };
  });

  return { teachers };
}

/**
 * Canonical strict-valid principal interaction payload for completed action fixtures.
 */
export function buildCompletePrincipalInteractionData(): Record<string, unknown> {
  const questions: Record<string, { answer: boolean }> = {};
  for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
    questions[key] = { answer: true };
  }
  return { questions };
}

/**
 * Seed 3 deterministic teacher user_permission rows for a school.
 * Returns the seeded teacher details for use in test assertions.
 */
export async function seedIndividualTeacherTestTeachers(
  pool: Pool,
  schoolCode: string
): Promise<{ id: number; name: string }[]> {
  const teachers = [
    { email: "e2e-indiv-teacher-1@test.local", name: "Indiv Teacher One" },
    { email: "e2e-indiv-teacher-2@test.local", name: "Indiv Teacher Two" },
    { email: "e2e-indiv-teacher-3@test.local", name: "Indiv Teacher Three" },
  ];

  const results: { id: number; name: string }[] = [];

  for (const t of teachers) {
    const rows = await pool.query<{ id: number }>(
      `INSERT INTO user_permission (email, level, role, school_codes, full_name, read_only)
       VALUES ($1, 1, 'teacher', ARRAY[$2::TEXT], $3, false)
       ON CONFLICT (email) DO UPDATE SET
         school_codes = ARRAY[$2::TEXT],
         full_name = $3,
         role = 'teacher',
         level = 1
       RETURNING id`,
      [t.email, schoolCode, t.name]
    );
    results.push({ id: rows.rows[0].id, name: t.name });
  }

  // Clean up any other teacher rows for this school that aren't our seeded teachers
  // or the AF team test teachers (to keep those tests working)
  const keepEmails = [
    ...teachers.map((t) => t.email),
    "e2e-af-teacher-1@test.local",
    "e2e-af-teacher-2@test.local",
  ];
  await pool.query(
    `DELETE FROM user_permission
     WHERE role = 'teacher'
       AND school_codes @> ARRAY[$1::TEXT]
       AND email != ALL($2::TEXT[])`,
    [schoolCode, keepEmails]
  );

  return results;
}

/**
 * Seed a visit action with deterministic status timestamps for E2E scenarios.
 */
export async function seedVisitAction(
  pool: Pool,
  visitId: number,
  { actionType, status = "pending", data = {} }: SeedVisitActionParams
): Promise<{ actionId: number }> {
  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const startedAt =
    status === "pending" ? null : tenMinutesAgo;
  const endedAt =
    status === "completed" ? nowIso : null;

  const startLat = startedAt ? 23.0225 : null;
  const startLng = startedAt ? 72.5714 : null;
  const startAccuracy = startedAt ? 50 : null;
  const endLat = endedAt ? 23.0228 : null;
  const endLng = endedAt ? 72.5717 : null;
  const endAccuracy = endedAt ? 45 : null;

  const result = await pool.query(
    `INSERT INTO lms_pm_school_visit_actions (
       visit_id,
       action_type,
       status,
       started_at,
       ended_at,
       start_lat,
       start_lng,
       start_accuracy,
       end_lat,
       end_lng,
       end_accuracy,
       data,
       inserted_at,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       (NOW() AT TIME ZONE 'UTC'),
       (NOW() AT TIME ZONE 'UTC')
     )
     RETURNING id`,
    [
      visitId,
      actionType,
      status,
      startedAt,
      endedAt,
      startLat,
      startLng,
      startAccuracy,
      endLat,
      endLng,
      endAccuracy,
      JSON.stringify(data),
    ]
  );

  return { actionId: result.rows[0].id };
}
