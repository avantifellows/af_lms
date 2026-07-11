/**
 * Last updated: 2026-07-07 (6dd457e). One-off script — if the schema or app has
 * moved on since this date, review/update it before running.
 *
 * Backfill teacher.teacher_id (the AF code) for teaching centre_positions
 * seats that have a linked user but no AF code yet, by matching the user's
 * email against the HR "Employee Master" (HR tab) email -> AF code map.
 *
 * Why email, not name: the June 2026 payroll analysis showed name-matching
 * reproduced only 11/19 known codes (single-token names, PM display-name
 * drift). Email is a deterministic key — it either matches an HR row or it
 * doesn't. Seats whose email is absent from HR (TBH placeholders, test
 * accounts, contractors, genuine ambiguities) are simply left untouched for
 * manual/ops resolution — this script never guesses.
 *
 * Safety:
 *   - Only fills rows where teacher_id IS NULL/'' (never overwrites a code).
 *   - Only touches teaching seat roles (management uses staff.employee_code).
 *   - Skips a code already held by a different teacher row (collision guard).
 *   - Dry-run by default; --apply runs inside a single transaction.
 *
 * Usage (from af_lms repo root):
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *     scripts/backfill-teacher-afcode.ts --hr=/path/to/hr_email_to_afcode.json
 *   ... --apply --env-file=.env.production      # write to prod
 *
 * HR map JSON shape: { "<lower-email>": { "code": "AF384", "name": "...", "status": "Active" }, ... }
 */

import * as fs from "fs";
import * as dotenv from "dotenv";
import { Pool } from "pg";

const TEACHING_ROLES = ["physics", "chemistry", "maths", "biology", "subject_tbd", "apc"];

interface HrEntry {
  code: string;
  name: string;
  status: string;
}
type HrMap = Record<string, HrEntry>;

interface Opts {
  apply: boolean;
  envFile: string;
  hrPath: string;
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { apply: false, envFile: ".env.local", hrPath: "" };
  for (const a of argv) {
    if (a === "--apply") o.apply = true;
    else if (a === "--dry-run") o.apply = false;
    else if (a.startsWith("--env-file=")) o.envFile = a.slice(11);
    else if (a.startsWith("--env=")) o.envFile = `.env.${a.slice(6)}`;
    else if (a.startsWith("--hr=")) o.hrPath = a.slice(5);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!o.hrPath) throw new Error("--hr=<path to hr_email_to_afcode.json> is required");
  return o;
}

interface GapRow {
  teacher_row_id: string;
  user_id: string;
  email: string;
  roles: string;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  dotenv.config({ path: opts.envFile, quiet: true });

  const hr: HrMap = JSON.parse(fs.readFileSync(opts.hrPath, "utf8"));
  // lower-case every key defensively
  const hrByEmail: HrMap = {};
  for (const [k, v] of Object.entries(hr)) hrByEmail[k.trim().toLowerCase()] = v;

  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || "5432"),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  console.log(`\nBackfill teacher.teacher_id from HR email  (${opts.apply ? "APPLY" : "DRY-RUN"})`);
  console.log(`  env-file: ${opts.envFile}   db: ${process.env.DATABASE_NAME}@${process.env.DATABASE_HOST}`);
  console.log(`  HR map:   ${Object.keys(hrByEmail).length} email->code entries\n`);

  const client = await pool.connect();
  try {
    // Gap: teacher rows with no AF code, whose user occupies a non-deleted
    // teaching seat and has an email. One row per teacher (roles aggregated).
    const { rows } = await client.query<GapRow>(
      `SELECT t.id::text AS teacher_row_id,
              t.user_id::text AS user_id,
              lower(u.email) AS email,
              string_agg(DISTINCT cp.role, ',') AS roles
         FROM teacher t
         JOIN "user" u ON u.id = t.user_id
         JOIN centre_positions cp ON cp.user_id = t.user_id
        WHERE (t.teacher_id IS NULL OR t.teacher_id = '')
          AND cp.deleted_at IS NULL
          AND cp.role = ANY($1)
          AND u.email IS NOT NULL AND u.email <> ''
        GROUP BY t.id, t.user_id, u.email`,
      [TEACHING_ROLES]
    );

    // Existing codes -> for collision guard.
    const existing = await client.query<{ teacher_id: string; id: string }>(
      `SELECT teacher_id, id::text AS id FROM teacher WHERE teacher_id IS NOT NULL AND teacher_id <> ''`
    );
    const codeOwner = new Map<string, string>();
    for (const r of existing.rows) codeOwner.set(r.teacher_id, r.id);

    const toApply: { teacher_row_id: string; code: string; email: string; name: string }[] = [];
    const skippedNoHr: GapRow[] = [];
    const skippedCollision: { row: GapRow; code: string; owner: string }[] = [];

    for (const g of rows) {
      const hit = hrByEmail[g.email];
      if (!hit || !hit.code) {
        skippedNoHr.push(g);
        continue;
      }
      const owner = codeOwner.get(hit.code);
      if (owner && owner !== g.teacher_row_id) {
        skippedCollision.push({ row: g, code: hit.code, owner });
        continue;
      }
      toApply.push({ teacher_row_id: g.teacher_row_id, code: hit.code, email: g.email, name: hit.name });
    }

    console.log(`Gap (teaching seats, no AF code, has email): ${rows.length}`);
    console.log(`  -> will backfill (email in HR):            ${toApply.length}`);
    console.log(`  -> skipped, email not in HR (TBH/test/etc): ${skippedNoHr.length}`);
    console.log(`  -> skipped, code collision:                 ${skippedCollision.length}\n`);

    console.log("WILL SET:");
    for (const a of toApply) console.log(`  teacher#${a.teacher_row_id.padStart(4)}  ${a.code.padEnd(8)} ${a.email.padEnd(38)} ${a.name}`);
    if (skippedNoHr.length) {
      console.log("\nSKIPPED (email not in HR — left for ops/manual):");
      for (const s of skippedNoHr) console.log(`  teacher#${s.teacher_row_id.padStart(4)}  ${s.email.padEnd(38)} [${s.roles}]`);
    }
    if (skippedCollision.length) {
      console.log("\nSKIPPED (AF code already on another teacher row — likely a duplicate account):");
      for (const s of skippedCollision) console.log(`  seat teacher#${s.row.teacher_row_id} (${s.row.email}) -> ${s.code}: code already held by teacher#${s.owner}`);
    }

    if (!opts.apply) {
      console.log("\nDRY-RUN — no writes. Re-run with --apply --env-file=.env.production to commit.");
      return;
    }

    await client.query("BEGIN");
    let n = 0;
    for (const a of toApply) {
      const res = await client.query(
        `UPDATE teacher SET teacher_id = $1, updated_at = now()
          WHERE id = $2 AND (teacher_id IS NULL OR teacher_id = '')`,
        [a.code, a.teacher_row_id]
      );
      n += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
    console.log(`\nAPPLIED — ${n} teacher rows updated.`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
