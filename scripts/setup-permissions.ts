/**
 * Setup script for user_permission table
 *
 * This script is idempotent - safe to run multiple times.
 * Run with: npx ts-node scripts/setup-permissions.ts
 * Or: npm run db:setup-permissions
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";

// Use production env if PROD=1, otherwise local
const envFile = process.env.PROD ? ".env.production" : ".env.local";
dotenv.config({ path: envFile });
console.log(`Using environment: ${envFile}\n`);

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || "5432"),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

interface SeedUser {
  email: string;
  level: number;
  role?: "teacher" | "program_manager" | "admin";
  school_codes?: string[];
  regions?: string[];
  read_only?: boolean;
}

// Seed data - add/modify users here
const SEED_USERS: SeedUser[] = [
  // Level 4: Admin (can manage users + all school access)
  { email: "pritam@avantifellows.org", level: 4, role: "admin" },
  { email: "aman.bahuguna@avantifellows.org", level: 4, role: "admin" },
  { email: "dhyaneshwaran@avantifellows.org", level: 4, role: "admin" },
  { email: "vishal@avantifellows.org", level: 4, role: "admin" },

  // Level 3: All schools access
  // (add level 3 users here)

  // Level 1: Single school access
  { email: "pritamps@gmail.com", level: 1, role: "teacher", school_codes: ["14042"] },
];

async function setup() {
  const client = await pool.connect();

  try {
    console.log("Starting permissions setup...\n");

    // Create table if not exists
    console.log("1. Creating user_permission table (if not exists)...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_permission (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        level INTEGER NOT NULL CHECK (level IN (1, 2, 3, 4)),
        role VARCHAR(50) DEFAULT 'teacher',
        school_codes TEXT[],
        regions TEXT[],
        read_only BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("   Done.\n");

    // Add columns if they don't exist (for existing tables)
    console.log("1b. Adding missing columns (if not exists)...");
    await client.query(`
      ALTER TABLE user_permission
      ADD COLUMN IF NOT EXISTS read_only BOOLEAN DEFAULT false
    `);
    await client.query(`
      ALTER TABLE user_permission
      ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'teacher'
    `);
    console.log("   Done.\n");

    // Create index on email for faster lookups
    console.log("2. Creating index on email (if not exists)...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_permission_email
      ON user_permission (LOWER(email))
    `);
    console.log("   Done.\n");

    // Upsert seed users
    console.log("3. Upserting seed users...");
    for (const user of SEED_USERS) {
      await client.query(
        `INSERT INTO user_permission (email, level, role, school_codes, regions, read_only)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email)
         DO UPDATE SET
           level = EXCLUDED.level,
           role = EXCLUDED.role,
           school_codes = EXCLUDED.school_codes,
           regions = EXCLUDED.regions,
           read_only = EXCLUDED.read_only,
           updated_at = NOW()`,
        [
          user.email,
          user.level,
          user.role || "teacher",
          user.school_codes || null,
          user.regions || null,
          user.read_only || false,
        ]
      );
      console.log(`   - ${user.email} (level ${user.level}, role: ${user.role || "teacher"}${user.read_only ? ', read-only' : ''})`);
    }
    console.log("   Done.\n");

    // Show current state
    console.log("4. Current permissions:");
    const result = await client.query(
      `SELECT email, level, role, school_codes, regions, read_only FROM user_permission ORDER BY level DESC, email`
    );
    console.table(result.rows);

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
