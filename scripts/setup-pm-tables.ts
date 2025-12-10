/**
 * Setup script for Program Manager feature
 *
 * This script:
 * 1. Adds 'role' column to user_permission table
 * 2. Creates lms_pm_school_visits table
 *
 * Idempotent - safe to run multiple times.
 * Run with: npx ts-node scripts/setup-pm-tables.ts
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || "5432"),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

async function setup() {
  const client = await pool.connect();

  try {
    // Verify we're on staging
    const dbName = process.env.DATABASE_NAME;
    console.log(`\nConnected to database: ${dbName}`);
    if (dbName?.includes("prod")) {
      throw new Error("SAFETY CHECK: This appears to be a production database. Aborting.");
    }
    console.log("Safety check passed - this is staging.\n");

    console.log("Starting Program Manager tables setup...\n");

    // Step 1: Add role column to user_permission
    console.log("1. Adding 'role' column to user_permission table...");
    await client.query(`
      ALTER TABLE user_permission
      ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'teacher'
    `);
    console.log("   Done.\n");

    // Step 2: Update existing level 4 users to have admin role
    console.log("2. Updating level 4 users to role='admin'...");
    const updateResult = await client.query(`
      UPDATE user_permission
      SET role = 'admin'
      WHERE level = 4 AND (role IS NULL OR role = 'teacher')
    `);
    console.log(`   Updated ${updateResult.rowCount} users.\n`);

    // Step 3: Create index on role
    console.log("3. Creating index on role column...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_permission_role
      ON user_permission(role)
    `);
    console.log("   Done.\n");

    // Step 4: Create lms_pm_school_visits table
    console.log("4. Creating lms_pm_school_visits table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS lms_pm_school_visits (
        id SERIAL PRIMARY KEY,
        school_code VARCHAR(20) NOT NULL,
        pm_email VARCHAR(255) NOT NULL,
        visit_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("   Done.\n");

    // Step 5: Create indexes on school_visits
    console.log("5. Creating indexes on lms_pm_school_visits...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pm_visits_school
      ON lms_pm_school_visits(school_code)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pm_visits_pm_email
      ON lms_pm_school_visits(pm_email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pm_visits_date
      ON lms_pm_school_visits(visit_date DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pm_visits_status
      ON lms_pm_school_visits(status)
    `);
    console.log("   Done.\n");

    // Show current user_permission state
    console.log("6. Current user_permission table (with role):");
    const permissions = await client.query(`
      SELECT email, level, role, school_codes, regions, read_only
      FROM user_permission
      ORDER BY level DESC, role, email
    `);
    console.table(permissions.rows);

    // Show visits table structure
    console.log("\n7. lms_pm_school_visits table structure:");
    const columns = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'lms_pm_school_visits'
      ORDER BY ordinal_position
    `);
    console.table(columns.rows);

    console.log("\nSetup complete!");

  } catch (error) {
    console.error("Error during setup:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch((err) => {
  console.error(err);
  process.exit(1);
});
