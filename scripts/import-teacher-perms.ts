/**
 * Mirror teacher user_permission rows from prod into staging, keyed by email.
 *
 * Prod is the source of truth for teacher (school/region) access; staging is
 * moving to the centre-seat model for PMs but teachers stay as user_permission
 * access grants. This upserts the prod teacher rows (exported to
 * scripts/data/pm/teacher-permissions.csv via the avanti-db MCP) into the target
 * DB by email — additive/update only. It does NOT delete staging teacher rows
 * that are absent from prod; those are reported as "extras" for a human to judge.
 *
 * The PM people are excluded at export time (notably shahnwaj@, a teacher in
 * prod but an APM on staging) so this never clobbers the PM import.
 *
 * Dry-run executes inside a transaction then ROLLBACKs (exact plan, no writes).
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/import-teacher-perms.ts            # dry-run vs .env.local
 *   npx ts-node ... scripts/import-teacher-perms.ts --apply
 *   npx ts-node ... scripts/import-teacher-perms.ts --env=production --apply   # (later, gated)
 */
import * as path from "path";
import { readFileSync } from "fs";
import * as dotenv from "dotenv";
import type { PoolClient } from "pg";

interface Cli { mode: "dry-run" | "apply"; envFile: string; file: string; verbose: boolean; }
function parseArgs(argv: string[]): Cli {
  const o: Cli = { mode: "dry-run", envFile: ".env.local", file: "scripts/data/pm/teacher-permissions.csv", verbose: false };
  for (const a of argv) {
    if (a === "--") continue;
    else if (a === "--apply") o.mode = "apply";
    else if (a === "--dry-run") o.mode = "dry-run";
    else if (a === "--verbose" || a === "-v") o.verbose = true;
    else if (a.startsWith("--env=")) o.envFile = `.env.${a.slice(6)}`;
    else if (a.startsWith("--env-file=")) o.envFile = a.slice(11);
    else if (a.startsWith("--file=")) o.file = a.slice(7);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

interface TeacherRow {
  email: string;
  level: number;
  schoolCodes: string[] | null;
  regions: string[] | null;
  programIds: number[] | null;
  readOnly: boolean;
  fullName: string | null;
}

function splitArr(v: string): string[] | null {
  const t = v.trim();
  if (!t) return null;
  return t.split(";").map((x) => x.trim()).filter(Boolean);
}

function parseCsv(file: string): TeacherRow[] {
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const rows: TeacherRow[] = [];
  for (const line of lines.slice(1)) {
    // pipe-delimited; full_name is the last field and may contain spaces but no pipe
    const f = line.split("|");
    if (f.length < 7) throw new Error(`Malformed row: ${line}`);
    const programs = splitArr(f[4]);
    rows.push({
      email: f[0].trim().toLowerCase(),
      level: Number(f[1]),
      schoolCodes: splitArr(f[2]),
      regions: splitArr(f[3]),
      programIds: programs ? programs.map(Number) : null,
      readOnly: f[5].trim() === "true",
      fullName: f[6].trim() || null,
    });
  }
  return rows;
}

async function run(client: PoolClient, cli: Cli) {
  const rows = parseCsv(path.resolve(cli.file));
  const counts = { inserted: 0, updated: 0, matchedUser: 0, noUser: 0 };
  const noUser: string[] = [];

  for (const r of rows) {
    const u = await client.query<{ id: number }>(`SELECT id FROM "user" WHERE lower(email)=$1`, [r.email]);
    const userId = u.rows[0]?.id ?? null;
    if (userId != null) counts.matchedUser++;
    else { counts.noUser++; noUser.push(r.email); }

    // Match case-INSENSITIVELY (getUserPermission looks up by LOWER(email)), but
    // the unique constraint on email is case-SENSITIVE — so an ON CONFLICT(email)
    // upsert with a normalized email would create a second row when the stored
    // email differs only in case (e.g. "Abhishekpachauri@…"). Look up by
    // lower(email), update that row in place (normalizing its email to lower), and
    // only insert when truly absent. This keeps it dup-safe on prod too.
    const existing = await client.query<{ id: number }>(
      `SELECT id FROM user_permission WHERE lower(email)=$1 ORDER BY id`, [r.email]
    );
    if (existing.rows.length > 1) {
      throw new Error(`Case-variant duplicate rows for ${r.email}: ids ${existing.rows.map((x) => x.id).join(", ")} — dedupe first`);
    }
    if (existing.rows.length === 1) {
      await client.query(
        `UPDATE user_permission SET email=$1, role='teacher', level=$2, school_codes=$3, regions=$4,
           program_ids=$5, read_only=$6, full_name=$7, user_id=$8, revoked_at=NULL, updated_at=now() WHERE id=$9`,
        [r.email, r.level, r.schoolCodes, r.regions, r.programIds, r.readOnly, r.fullName, userId, existing.rows[0].id]
      );
      counts.updated++;
    } else {
      await client.query(
        `INSERT INTO user_permission
           (email, role, level, school_codes, regions, program_ids, read_only, full_name, user_id, inserted_at, updated_at)
         VALUES ($1,'teacher',$2,$3,$4,$5,$6,$7,$8,now(),now())`,
        [r.email, r.level, r.schoolCodes, r.regions, r.programIds, r.readOnly, r.fullName, userId]
      );
      counts.inserted++;
    }
    if (cli.verbose) console.log(`  upsert ${r.email} level=${r.level} schools=[${r.schoolCodes ?? ""}] regions=[${r.regions ?? ""}] programs=[${r.programIds ?? ""}] user=${userId ?? "—"}`);
  }

  // Staging teacher rows NOT in the prod set — reported, never deleted.
  const csvEmails = rows.map((r) => r.email);
  const extras = await client.query<{ email: string }>(
    `SELECT lower(email) AS email FROM user_permission
     WHERE role='teacher' AND lower(email) <> ALL($1::text[]) ORDER BY email`,
    [csvEmails]
  );

  return { counts, noUser, extras: extras.rows.map((e) => e.email) };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  dotenv.config({ path: cli.envFile, quiet: true });
  const dbModule = await import("../src/lib/db");
  const pool = dbModule.default;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await run(client, cli);
    if (cli.mode === "apply") await client.query("COMMIT");
    else await client.query("ROLLBACK");

    console.log(`\nTeacher user_permission mirror (${cli.mode}) :: env=${cli.envFile}`);
    console.log(`Rows: ${r.counts.inserted} inserted, ${r.counts.updated} updated`);
    console.log(`User link: ${r.counts.matchedUser} matched a staging user, ${r.counts.noUser} keyed by email only (user_id NULL)`);
    if (r.noUser.length && cli.verbose) {
      console.log(`\nNo staging user (kept email-only):`);
      for (const e of r.noUser) console.log(`  - ${e}`);
    }
    if (r.extras.length) {
      console.log(`\nStaging teacher rows NOT in prod (${r.extras.length}) — left untouched, review manually:`);
      for (const e of r.extras) console.log(`  - ${e}`);
    }
    if (cli.mode === "dry-run") console.log(`\nDRY-RUN: transaction rolled back, nothing written. Re-run with --apply to persist.`);
    else console.log(`\nAPPLIED.`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.stack || e.message : e); process.exitCode = 1; });
