/**
 * Setup script for user_permission table
 *
 * This script is idempotent - safe to run multiple times.
 * Run with: npx ts-node scripts/setup-permissions.ts
 * Or: npm run db:setup-permissions
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

interface SeedUser {
  email: string;
  level: number;
  school_codes?: string[];
  regions?: string[];
  read_only?: boolean;
}

// Seed data - add/modify users here
const SEED_USERS: SeedUser[] = [
  // Level 4: Admin (can manage users + all school access)
  { email: "pritam@avantifellows.org", level: 4 },
  { email: "aman.bahuguna@avantifellows.org", level: 4 },
  { email: "dhyaneshwaran@avantifellows.org", level: 4 },

  // Level 3: All schools access
  // (add level 3 users here)

  // Level 1: Single school access
  { email: "pritamps@gmail.com", level: 1, school_codes: ["14042"] },
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
        school_codes TEXT[],
        regions TEXT[],
        read_only BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("   Done.\n");

    // Add read_only column if it doesn't exist (for existing tables)
    console.log("1b. Adding read_only column (if not exists)...");
    await client.query(`
      ALTER TABLE user_permission
      ADD COLUMN IF NOT EXISTS read_only BOOLEAN DEFAULT false
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
        `INSERT INTO user_permission (email, level, school_codes, regions, read_only)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email)
         DO UPDATE SET
           level = EXCLUDED.level,
           school_codes = EXCLUDED.school_codes,
           regions = EXCLUDED.regions,
           read_only = EXCLUDED.read_only,
           updated_at = NOW()`,
        [
          user.email,
          user.level,
          user.school_codes || null,
          user.regions || null,
          user.read_only || false,
        ]
      );
      console.log(`   - ${user.email} (level ${user.level}${user.read_only ? ', read-only' : ''})`);
    }
    console.log("   Done.\n");

    // Show current state
    console.log("4. Current permissions:");
    const result = await client.query(
      `SELECT email, level, school_codes, regions, read_only FROM user_permission ORDER BY level DESC, email`
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
