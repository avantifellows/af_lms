import { Pool } from "pg";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { insertTestUsers } from "./test-users";

const TEST_DB = "af_lms_test";
const DUMP_FILE = path.resolve(__dirname, "../fixtures/db-dump.sql");

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

  const initialData = {
    principalMeeting: null,
    leadershipMeetings: null,
    classroomObservations: [],
    studentDiscussions: {
      groupDiscussions: [],
      individualDiscussions: [],
    },
    staffMeetings: {
      individualMeetings: [],
      teamMeeting: null,
    },
    teacherFeedback: [],
    issueLog: [],
  };

  const result = await pool.query(
    `INSERT INTO lms_pm_school_visits
       (school_code, pm_email, visit_date, status, data,
        start_lat, start_lng, start_accuracy)
     VALUES ($1, $2, CURRENT_DATE, 'in_progress', $3, 23.0225, 72.5714, 50)
     RETURNING id`,
    [schoolCode, "e2e-pm@test.local", JSON.stringify(initialData)]
  );

  return { visitId: result.rows[0].id, schoolCode };
}
