/**
 * Last updated: 2026-10-28. Helper for the pre-PR review
 * (.mex/patterns/pre-pr-review.md, step 3), used only when the person running
 * the review has approved using staging.
 *
 * Makes sure the Dev Login "Admin" persona has a user_permission row on the
 * STAGING database, so a branch run on localhost against staging can open
 * School pages. Without it every persona logs in but "does not have access to
 * any schools". The row is read-only admin (level 3) with the same programs
 * as the real read-only admins. Dev Login exists only when NODE_ENV is not
 * production, so the row is usable only from a local checkout that already
 * holds the staging credentials.
 *
 * Idempotent: a live row is left alone; a revoked one is reported, not revived.
 * Refuses to run unless DATABASE_HOST names staging. Never prints credentials.
 *
 * Usage:
 *   npm run qa:ensure-staging-admin               # dry run vs .env.local
 *   npm run qa:ensure-staging-admin -- --apply
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";

// DEV_LOGIN_PERSONAS.admin in src/lib/auth.ts. Not imported: that module pulls
// in next-auth, which this script has no use for.
const PERSONA_EMAIL = "e2e-holistic-global-admin@test.local";
// Same scope as the existing read-only admins.
const PROGRAM_IDS = [1, 2, 64, 74, 94, 78, 88, 99];

interface CliOptions {
  apply: boolean;
  envFile: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, envFile: ".env.local" };
  for (const arg of argv) {
    if (arg === "--") continue;
    else if (arg === "--apply") options.apply = true;
    else if (arg.startsWith("--env-file=")) options.envFile = arg.slice(11);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  dotenv.config({ path: opts.envFile, quiet: true });

  const host = process.env.DATABASE_HOST ?? "";
  if (!host.includes("staging")) {
    throw new Error(`Refusing: DATABASE_HOST in ${opts.envFile} is not a staging host.`);
  }

  const pool = new Pool({
    host,
    port: parseInt(process.env.DATABASE_PORT || "5432"),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  try {
    const {
      rows: [db],
    } = await pool.query<{ name: string }>("SELECT current_database() AS name");
    if (db.name.startsWith("prod")) throw new Error(`Refusing: database is ${db.name}.`);
    console.log(`db: ${db.name} — ${opts.apply ? "APPLYING" : "dry run"}`);

    const { rows } = await pool.query<{
      id: string;
      role: string;
      level: number;
      read_only: boolean;
      revoked_at: Date | null;
    }>(
      `SELECT id, role, level, read_only, revoked_at
       FROM user_permission WHERE LOWER(email) = $1`,
      [PERSONA_EMAIL],
    );

    const live = rows.find((row) => row.revoked_at == null);
    if (live) {
      console.log(
        `ok: ${PERSONA_EMAIL} has row ${live.id} (role=${live.role}, level=${live.level}, read_only=${live.read_only})`,
      );
      return;
    }
    if (rows.length > 0) {
      console.log(`revoked row(s) exist for ${PERSONA_EMAIL}: ${rows.map((r) => r.id).join(", ")}. Not reviving; ask first.`);
      process.exitCode = 1;
      return;
    }
    if (!opts.apply) {
      console.log(`would insert ${PERSONA_EMAIL} (level 3 admin, read-only). Re-run with --apply.`);
      return;
    }
    const {
      rows: [inserted],
    } = await pool.query<{ id: string }>(
      `INSERT INTO user_permission
         (email, level, role, school_codes, regions, program_ids, read_only, full_name)
       VALUES ($1, 3, 'admin', NULL, NULL, $2, true, 'Dev Admin')
       RETURNING id`,
      [PERSONA_EMAIL, PROGRAM_IDS],
    );
    console.log(`inserted row ${inserted.id} for ${PERSONA_EMAIL}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
