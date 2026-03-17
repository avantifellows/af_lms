import { Pool } from "pg";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { insertTestUsers } from "./test-users";
import {
  CLASSROOM_OBSERVATION_RUBRIC,
  CURRENT_RUBRIC_VERSION,
} from "../../src/lib/classroom-observation-rubric";

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
    params,
    observer_summary_strengths: "Strong student engagement and concept clarity.",
    observer_summary_improvements: "Improve recap pacing near class closure.",
  };
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
    `INSERT INTO lms_pm_visit_actions (
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
