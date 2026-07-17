/**
 * Last updated: 2026-07-07 (0223070). One-off script — if the schema or app has
 * moved on since this date, review/update it before running.
 *
 * Merge duplicate teacher accounts: an OLD emailless account holds the AF code
 * while the person's real, actively-seated @avantifellows.org account has no
 * code. Per decision (2026-07-07): the new seated account survives.
 *
 * For each pair: move the AF code from the old teacher row to the new (seated)
 * teacher row, and retire the old row (clear code, is_af_teacher=false, stamp
 * exit_date). The old row is left in place (not deleted) to avoid FK surprises;
 * it becomes an inert, codeless, non-teacher shell.
 *
 * The pair set is EXHAUSTIVE for this pattern (HR email<->code = one person;
 * code sits on a different user than the seated login). See debt D9.
 *
 * Guards: only proceeds per-pair if the old row still holds exactly that code
 * AND the new row's code is still empty. Any drift aborts that pair untouched.
 * Dry-run by default; --apply runs both moves inside a single transaction.
 *
 * Usage (from af_lms repo root):
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/merge-duplicate-teacher-accounts.ts
 *   ... --apply --env-file=.env.production
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";

interface Pair {
  person: string;
  code: string;
  oldTeacherRow: number;
  newTeacherRow: number;
  newSeat: string;
}

// Exhaustive, confirmed set (debt D9).
const PAIRS: Pair[] = [
  { person: "Kanhaiya", code: "AF448", oldTeacherRow: 7, newTeacherRow: 3573, newSeat: "kanhaiya@ · RGJNV Dehradun" },
  { person: "Khushboo", code: "AF381", oldTeacherRow: 8, newTeacherRow: 3613, newSeat: "khushboo@ · Meritorious Bathinda CoE" },
];

function parseArgs(argv: string[]) {
  let apply = false;
  let envFile = ".env.local";
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") apply = false;
    else if (a.startsWith("--env-file=")) envFile = a.slice(11);
    else if (a.startsWith("--env=")) envFile = `.env.${a.slice(6)}`;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return { apply, envFile };
}

async function main() {
  const { apply, envFile } = parseArgs(process.argv.slice(2));
  dotenv.config({ path: envFile, quiet: true });

  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || "5432"),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  console.log(`\nMerge duplicate teacher accounts  (${apply ? "APPLY" : "DRY-RUN"})`);
  console.log(`  env-file: ${envFile}   db: ${process.env.DATABASE_NAME}@${process.env.DATABASE_HOST}\n`);

  const client = await pool.connect();
  try {
    // Verify current state per pair.
    const ok: Pair[] = [];
    for (const p of PAIRS) {
      const oldRow = await client.query<{ teacher_id: string | null }>(`SELECT teacher_id FROM teacher WHERE id=$1`, [p.oldTeacherRow]);
      const newRow = await client.query<{ teacher_id: string | null }>(`SELECT teacher_id FROM teacher WHERE id=$1`, [p.newTeacherRow]);
      const oldCode = oldRow.rows[0]?.teacher_id ?? null;
      const newCode = newRow.rows[0]?.teacher_id ?? null;
      const oldOk = oldCode === p.code;
      const newOk = newCode === null || newCode === "";
      console.log(`${p.person} (${p.code}):`);
      console.log(`  old teacher#${p.oldTeacherRow}: code=${oldCode ?? "NULL"}  ${oldOk ? "OK" : "!! expected " + p.code}`);
      console.log(`  new teacher#${p.newTeacherRow} (${p.newSeat}): code=${newCode ?? "NULL"}  ${newOk ? "OK (empty)" : "!! already " + newCode}`);
      if (oldOk && newOk) {
        ok.push(p);
        console.log(`  -> will move ${p.code}: teacher#${p.oldTeacherRow} (retire) -> teacher#${p.newTeacherRow}\n`);
      } else {
        console.log(`  -> SKIP (state drifted)\n`);
      }
    }

    if (!apply) {
      console.log(`DRY-RUN — ${ok.length}/${PAIRS.length} pairs ready. Re-run with --apply --env-file=.env.production.`);
      return;
    }

    await client.query("BEGIN");
    for (const p of ok) {
      // 1. Free the code on the old account and retire it.
      await client.query(
        `UPDATE teacher SET teacher_id=NULL, is_af_teacher=false, exit_date=CURRENT_DATE, updated_at=now()
          WHERE id=$1 AND teacher_id=$2`,
        [p.oldTeacherRow, p.code]
      );
      // 2. Assign the code to the surviving seated account.
      await client.query(
        `UPDATE teacher SET teacher_id=$1, updated_at=now()
          WHERE id=$2 AND (teacher_id IS NULL OR teacher_id='')`,
        [p.code, p.newTeacherRow]
      );
      console.log(`Merged ${p.person}: ${p.code} -> teacher#${p.newTeacherRow}; teacher#${p.oldTeacherRow} retired.`);
    }
    await client.query("COMMIT");
    console.log(`\nAPPLIED — ${ok.length} pairs merged.`);
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
