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

function getTestPool(): Pool {
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
