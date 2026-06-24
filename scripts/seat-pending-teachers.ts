/**
 * Seat "pending" teachers (level-1 user_permission teacher grants with no centre
 * seat) onto their centre, so they show under the centre in the staff UI instead
 * of "No Centre assigned".
 *
 * Centre is resolved by school_codes ∩ program_ids — the same rule PM seats use:
 * a teacher on program 1 (CoE) at a multi-centre school lands on that school's
 * CoE centre, program 2 (Nodal) on the Nodal centre. A school that resolves to
 * exactly one centre (per school) is assigned; 0 (non-centre / NVS school) is
 * left alone; >1 same-program centres at one school is ambiguous and skipped.
 *
 * Subject is left blank: each seat gets the `subject_tbd` placeholder role and a
 * teacher record with subject_id NULL, for ops to correct in the staff UI. To be
 * editable there the person must be a real `teacher` row (the UI can't edit
 * pending rows), so this creates user + teacher + seat as needed.
 *
 * Dry-run executes in a transaction then ROLLBACKs (exact plan, nothing written).
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seat-pending-teachers.ts            # dry-run vs .env.local
 *   npx ts-node ... scripts/seat-pending-teachers.ts --apply
 */
import * as dotenv from "dotenv";
import type { PoolClient } from "pg";

interface Cli { mode: "dry-run" | "apply"; envFile: string; verbose: boolean; }
function parseArgs(argv: string[]): Cli {
  const o: Cli = { mode: "dry-run", envFile: ".env.local", verbose: false };
  for (const a of argv) {
    if (a === "--") continue;
    else if (a === "--apply") o.mode = "apply";
    else if (a === "--dry-run") o.mode = "dry-run";
    else if (a === "--verbose" || a === "-v") o.verbose = true;
    else if (a.startsWith("--env=")) o.envFile = `.env.${a.slice(6)}`;
    else if (a.startsWith("--env-file=")) o.envFile = a.slice(11);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

interface Pending {
  email: string;
  user_id: number | null;
  full_name: string | null;
  school_codes: string[];
  program_ids: number[] | null;
}

async function run(client: PoolClient) {
  // Level-1 teacher grants with school_codes and no active centre seat.
  const pending = await client.query<Pending>(
    `SELECT lower(up.email) AS email, up.user_id, up.full_name, up.school_codes, up.program_ids
     FROM user_permission up
     WHERE up.role = 'teacher' AND up.revoked_at IS NULL
       AND up.school_codes IS NOT NULL AND cardinality(up.school_codes) > 0
       AND NOT EXISTS (
         SELECT 1 FROM centre_positions cp
         WHERE cp.user_id = up.user_id AND cp.deleted_at IS NULL
       )
     ORDER BY lower(up.email)`
  );

  const counts = { considered: pending.rows.length, seatedTeachers: 0, seatsCreated: 0,
    usersCreated: 0, teacherRowsCreated: 0, skippedNoCentre: 0, skippedAmbiguous: 0 };
  const perCentre = new Map<string, number>();
  const ambiguous: string[] = [];
  const noCentre: string[] = [];
  const assignmentsSample: string[] = [];

  for (const p of pending.rows) {
    const hasPrograms = (p.program_ids?.length ?? 0) > 0;
    // candidate centres at the teacher's schools, narrowed by program
    const cand = await client.query<{ school_code: string; centre_id: number; centre_name: string }>(
      `SELECT s.code AS school_code, c.id AS centre_id, c.name AS centre_name
       FROM centres c JOIN school s ON s.id = c.school_id
       WHERE s.code = ANY($1) AND c.is_active = true
         AND ($2::int[] IS NULL OR c.program_id IS NULL OR c.program_id = ANY($2))
       ORDER BY s.code, c.id`,
      [p.school_codes, hasPrograms ? p.program_ids : null]
    );

    // group by school; one unambiguous centre per school
    const bySchool = new Map<string, { id: number; name: string }[]>();
    for (const r of cand.rows) {
      (bySchool.get(r.school_code) ?? bySchool.set(r.school_code, []).get(r.school_code)!)
        .push({ id: r.centre_id, name: r.centre_name });
    }
    const targets: { id: number; name: string }[] = [];
    let sawAmbiguous = false;
    for (const [school, centresAtSchool] of bySchool) {
      if (centresAtSchool.length === 1) targets.push(centresAtSchool[0]);
      else if (centresAtSchool.length > 1) {
        sawAmbiguous = true;
        ambiguous.push(`${p.email} @ school ${school}: ${centresAtSchool.map((c) => c.name).join(" / ")}`);
      }
    }

    if (targets.length === 0) {
      if (sawAmbiguous) counts.skippedAmbiguous++;
      else { counts.skippedNoCentre++; noCentre.push(p.email); }
      continue;
    }

    // ensure user
    let userId = p.user_id;
    if (userId == null) {
      const u = await client.query<{ id: number }>(`SELECT id FROM "user" WHERE lower(email)=$1`, [p.email]);
      if (u.rows[0]) userId = u.rows[0].id;
      else {
        const name = (p.full_name ?? "").trim();
        const tokens = name ? name.split(/\s+/) : [];
        const ins = await client.query<{ id: number }>(
          `INSERT INTO "user" (first_name, last_name, email, inserted_at, updated_at)
           VALUES ($1,$2,$3,now(),now()) RETURNING id`,
          [tokens[0] ?? null, tokens.length > 1 ? tokens.slice(1).join(" ") : null, p.email]
        );
        userId = ins.rows[0].id; counts.usersCreated++;
      }
      await client.query(`UPDATE user_permission SET user_id=$1, updated_at=now() WHERE lower(email)=$2`, [userId, p.email]);
    }

    // ensure a teacher record (editable in the staff UI; subject blank)
    const tRow = await client.query<{ id: number }>(`SELECT id FROM teacher WHERE user_id=$1 AND is_af_teacher=true`, [userId]);
    if (tRow.rows.length === 0) {
      await client.query(
        `INSERT INTO teacher (user_id, is_af_teacher, subject_id, inserted_at, updated_at)
         VALUES ($1, true, NULL, now(), now())`,
        [userId]
      );
      counts.teacherRowsCreated++;
    }

    // seat at each resolved centre (skip if already seated there)
    let seatedHere = false;
    for (const t of targets) {
      const dup = await client.query<{ id: number }>(
        `SELECT id FROM centre_positions WHERE centre_id=$1 AND user_id=$2 AND deleted_at IS NULL`,
        [t.id, userId]
      );
      if (dup.rows.length > 0) continue;
      await client.query(
        `INSERT INTO centre_positions (centre_id, role, user_id, inserted_at, updated_at)
         VALUES ($1,'subject_tbd',$2,now(),now())`,
        [t.id, userId]
      );
      counts.seatsCreated++; seatedHere = true;
      perCentre.set(t.name, (perCentre.get(t.name) ?? 0) + 1);
      if (assignmentsSample.length < 12) assignmentsSample.push(`${p.email} -> ${t.name}`);
    }
    if (seatedHere) counts.seatedTeachers++;
  }

  return { counts, perCentre, ambiguous, noCentre, assignmentsSample };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  dotenv.config({ path: cli.envFile, quiet: true });
  const dbModule = await import("../src/lib/db");
  const pool = dbModule.default;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await run(client);
    if (cli.mode === "apply") await client.query("COMMIT");
    else await client.query("ROLLBACK");

    const c = r.counts;
    console.log(`\nSeat pending teachers (${cli.mode}) :: env=${cli.envFile}`);
    console.log(`Pending (level-1 teacher, no seat) considered: ${c.considered}`);
    console.log(`Seated: ${c.seatedTeachers} teachers -> ${c.seatsCreated} seats (role=subject_tbd)`);
    console.log(`Created: ${c.usersCreated} users, ${c.teacherRowsCreated} teacher records`);
    console.log(`Skipped: ${c.skippedNoCentre} no-centre (NVS/non-centre school), ${c.skippedAmbiguous} ambiguous (>1 same-program centre)`);
    if (r.perCentre.size) {
      console.log(`\nSeats per centre:`);
      for (const [name, n] of [...r.perCentre.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${name}: ${n}`);
    }
    console.log(`\nSample assignments:`);
    for (const a of r.assignmentsSample) console.log(`  ${a}`);
    if (r.ambiguous.length) { console.log(`\nAmbiguous (skipped, ops decides):`); for (const a of r.ambiguous) console.log(`  ${a}`); }
    if (cli.verbose && r.noCentre.length) { console.log(`\nNo-centre teachers (left in place):`); for (const e of r.noCentre) console.log(`  ${e}`); }
    if (cli.mode === "dry-run") console.log(`\nDRY-RUN: rolled back, nothing written.`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.stack || e.message : e); process.exitCode = 1; });
