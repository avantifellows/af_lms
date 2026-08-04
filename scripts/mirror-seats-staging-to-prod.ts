/**
 * Last updated: 2026-06-30 (8bc1326). One-off script — if the schema or app has
 * moved on since this date, review/update it before running.
 *
 * Faithful MIRROR of staging's centre seating into another environment (prod),
 * by BUSINESS KEY — the promotion step for the centre-seat model.
 *
 * Why this exists (vs seat-pending-teachers): that script RE-DERIVES a teacher's
 * centre from school_codes ∩ program, so it cannot reproduce a staging seat that
 * ops hand-placed at a school the person's school_codes don't contain (e.g. the
 * EMRS Bhopal teachers). This script instead COPIES staging's actual seats, so
 * "assume staging is correct" holds exactly. Re-derivation is lossy; copy is not.
 *
 * What it does, in ONE transaction against the TARGET:
 *   1. Centres   — resolve each seated centre by (name,type,program); link its
 *                  school if unlinked; CREATE if truly absent. A name that exists
 *                  under a DIFFERENT program is NOT auto-created — flagged as
 *                  NEEDS-DECISION and its seats skipped (the Meritorious case).
 *   2. Users     — resolve by email; reuse a dot-variant if present (flagged);
 *                  CREATE only if genuinely absent (flagged).
 *   3. Teacher/  — ensure the teacher/staff row each seated person has in staging
 *      staff       (so the seat renders + is editable). subject_id is copied only
 *                  if that id exists in the target subject table, else NULL+flag.
 *   4. Seats     — FULL REPLACEMENT within the in-scope programs: insert staging's
 *                  seats, soft-delete target seats (at prog-P centres) staging no
 *                  longer has. Keyed by (centre,role,user).
 *   5. Scope     — clear user_permission.school_codes/regions for every user now
 *      clear       holding ≥1 seat at a LINKED centre (the seat-as-source-of-truth
 *                  invariant). Guarded: a person whose seats are all at unlinked
 *                  centres is SKIPPED (clearing would empty their scope). Mirrors
 *                  src/lib/clear-seated-scope.ts, run inside this same txn.
 *
 * It does NOT set user_permission role/level/program_ids — that is owned by
 * import-pm-centres.ts (PMs) + import-teacher-perms.ts (teachers), which the
 * promotion runs first. A seated person with NO target user_permission row is
 * FLAGGED (a seat without a permission row grants no access), never invented.
 *
 * Read-only on SOURCE. TARGET writes are wrapped in a transaction; default is
 * DRY-RUN (rolled back, exact plan printed). --apply commits. Refuses to run if
 * source and target point at the same database.
 *
 * After --apply, `npm run pm:promodiff` (check-promotion-school-diff.ts) is the
 * parity check: a faithful mirror should report 0 seated changes vs staging.
 *
 * Usage (from worktree root):
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/mirror-seats-staging-to-prod.ts            # dry-run: staging -> prod
 *   npx ts-node ... scripts/mirror-seats-staging-to-prod.ts -- --apply                                        # commit
 *   options: --source-env=.env.local  --target-env=.env.production  --programs=1,2  --verbose
 */
import { readFileSync, existsSync } from "fs";
import * as dotenv from "dotenv";
import { Pool, PoolClient } from "pg";

interface Cli { mode: "dry-run" | "apply"; sourceEnv: string; targetEnv: string; programs: number[]; verbose: boolean; }
function parseArgs(argv: string[]): Cli {
  const o: Cli = { mode: "dry-run", sourceEnv: ".env.local", targetEnv: ".env.production", programs: [1, 2], verbose: false };
  for (const a of argv) {
    if (a === "--") continue;
    else if (a === "--apply") o.mode = "apply";
    else if (a === "--dry-run") o.mode = "dry-run";
    else if (a === "--verbose" || a === "-v") o.verbose = true;
    else if (a.startsWith("--source-env=")) o.sourceEnv = a.slice(13);
    else if (a.startsWith("--target-env=")) o.targetEnv = a.slice(13);
    else if (a.startsWith("--programs=")) o.programs = a.slice(11).split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function poolFromEnvFile(envFile: string, label: string): Pool {
  if (!existsSync(envFile)) {
    throw new Error(`${label} env file not found: ${envFile}` +
      (envFile.includes("production") ? `\n  -> cp ~/af/af_lms/.env.production .env.production (gitignored)` : ""));
  }
  const env = dotenv.parse(readFileSync(envFile));
  return new Pool({
    host: env.DATABASE_HOST, port: parseInt(env.DATABASE_PORT || "5432"),
    user: env.DATABASE_USER, password: env.DATABASE_PASSWORD, database: env.DATABASE_NAME,
    ssl: env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 4, connectionTimeoutMillis: 8000, statement_timeout: 60000,
  });
}

const dotKey = (email: string): string => {
  const [l, d] = email.toLowerCase().split("@");
  return d ? `${l.replace(/\./g, "")}@${d}` : email.toLowerCase();
};
const centreKey = (name: string, type: string | null, program: number | null) =>
  `${name.toLowerCase().trim()}|${type ?? ""}|${program ?? ""}`;

// ---- source shapes ----
type SourceSeat = {
  email: string; first_name: string | null; last_name: string | null;
  centre_name: string; type_code: string | null; category_code: string | null;
  sub_category_code: string | null; program_id: number | null;
  school_code: string | null; school_name: string | null;
  role: string;
  is_af_teacher: boolean | null; subject_id: number | null;
  employee_code: string | null; staff_type: string | null; designation: string | null;
};

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const source = poolFromEnvFile(cli.sourceEnv, "SOURCE");
  const target = poolFromEnvFile(cli.targetEnv, "TARGET");

  const flags: Record<string, string[]> = {
    centresCreated: [], centresLinked: [], centreNeedsDecision: [], centreMissingSchool: [],
    usersCreated: [], usersDotVariant: [], teacherRows: [], staffRows: [], subjectDropped: [],
    seatsUnresolved: [], permMissing: [],
  };
  const counts = {
    sourceSeats: 0, desiredSeats: 0, seatsAdded: 0, seatsSoftDeleted: 0, seatsKept: 0,
    centresCreated: 0, centresLinked: 0, usersCreated: 0, teacherRows: 0, staffRows: 0,
    permLinked: 0, scopeUsersCleared: 0,
  };

  let client: PoolClient | null = null;
  try {
    // --- guard: never let source == target ---
    const sDb = (await source.query<{ d: string }>("SELECT current_database() d")).rows[0].d;
    const tDb = (await target.query<{ d: string }>("SELECT current_database() d")).rows[0].d;
    if (sDb === tDb) throw new Error(`SOURCE and TARGET are the same database (${sDb}). Refusing to mirror onto itself.`);

    // ===== 1. READ source seat truth (read-only) =====
    const seatRows = (await source.query<SourceSeat>(
      `SELECT lower(u.email) email, u.first_name, u.last_name,
              c.name centre_name, c.type_code, c.category_code, c.sub_category_code, c.program_id,
              sc.code school_code, sc.name school_name,
              cp.role,
              t.is_af_teacher, t.subject_id,
              stf.employee_code, stf.staff_type, stf.designation
       FROM centre_positions cp
       JOIN centres c ON c.id = cp.centre_id
       LEFT JOIN school sc ON sc.id = c.school_id
       JOIN "user" u ON u.id = cp.user_id
       LEFT JOIN teacher t ON t.user_id = u.id AND t.is_af_teacher = true
       LEFT JOIN staff stf ON stf.user_id = u.id
       WHERE cp.deleted_at IS NULL AND c.program_id = ANY($1::int[])`,
      [cli.programs]
    )).rows;

    // dedupe seat tuples (a LEFT JOIN to teacher/staff can multiply rows); keep person attrs from first
    const seatByTuple = new Map<string, SourceSeat>();
    for (const r of seatRows) {
      const k = `${r.email}|${centreKey(r.centre_name, r.type_code, r.program_id)}|${r.role}`;
      if (!seatByTuple.has(k)) seatByTuple.set(k, r);
    }
    const seats = [...seatByTuple.values()];
    counts.sourceSeats = seats.length;

    // distinct people + distinct centres referenced
    const people = new Map<string, SourceSeat>();
    const centres = new Map<string, SourceSeat>();
    for (const s of seats) {
      if (!people.has(s.email)) people.set(s.email, s);
      const ck = centreKey(s.centre_name, s.type_code, s.program_id);
      if (!centres.has(ck)) centres.set(ck, s);
    }

    // ===== open TARGET transaction =====
    client = await target.connect();
    await client.query("BEGIN");

    // target subject ids (for safe subject_id copy)
    const targetSubjectIds = new Set(
      (await client.query<{ id: number }>(`SELECT id FROM subject`)).rows.map((r) => r.id)
    );

    // ----- 1. CENTRES: resolve / link / create -----
    const centreIdByKey = new Map<string, number | null>(); // null = needs-decision (skip its seats)
    for (const [ck, c] of centres) {
      // exact match by name+type+program
      const found = await client.query<{ id: number; school_id: number | null }>(
        `SELECT id, school_id FROM centres WHERE lower(name)=lower($1) AND coalesce(type_code,'')=coalesce($2,'') AND program_id IS NOT DISTINCT FROM $3`,
        [c.centre_name, c.type_code, c.program_id]
      );
      if (found.rows.length === 1) {
        const cid = found.rows[0].id;
        centreIdByKey.set(ck, cid);
        // link school if source has one and target centre is unlinked
        if (found.rows[0].school_id == null && c.school_code) {
          const sch = await client.query<{ id: number }>(`SELECT id FROM school WHERE code=$1`, [c.school_code]);
          if (sch.rows[0]) {
            await client.query(`UPDATE centres SET school_id=$1, updated_at=now() WHERE id=$2`, [sch.rows[0].id, cid]);
            counts.centresLinked++; flags.centresLinked.push(`${c.centre_name} (${c.type_code}) -> school ${c.school_code}`);
          } else flags.centreMissingSchool.push(`${c.centre_name}: school code ${c.school_code} absent in target`);
        }
        continue;
      }
      if (found.rows.length > 1) { centreIdByKey.set(ck, null); flags.centreNeedsDecision.push(`${c.centre_name} (${c.type_code}, prog${c.program_id}): ${found.rows.length} matches in target — ambiguous`); continue; }

      // no exact match: does the name+type exist under a DIFFERENT program? -> needs decision, don't guess
      const softer = await client.query<{ id: number; program_id: number | null }>(
        `SELECT id, program_id FROM centres WHERE lower(name)=lower($1) AND coalesce(type_code,'')=coalesce($2,'')`,
        [c.centre_name, c.type_code]
      );
      if (softer.rows.length > 0) {
        centreIdByKey.set(ck, null);
        flags.centreNeedsDecision.push(`${c.centre_name} (${c.type_code}): source prog${c.program_id} but target has it under prog${softer.rows.map((r) => r.program_id).join("/")} — resolve manually`);
        continue;
      }

      // truly absent -> create (link school if resolvable)
      let schoolId: number | null = null;
      if (c.school_code) {
        const sch = await client.query<{ id: number }>(`SELECT id FROM school WHERE code=$1`, [c.school_code]);
        schoolId = sch.rows[0]?.id ?? null;
        if (schoolId == null) flags.centreMissingSchool.push(`${c.centre_name}: school code ${c.school_code} absent in target — created UNLINKED`);
      }
      const ins = await client.query<{ id: number }>(
        `INSERT INTO centres (name, school_id, type_code, category_code, sub_category_code, program_id, is_physical, is_active, inserted_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,true,now(),now()) RETURNING id`,
        [c.centre_name, schoolId, c.type_code, c.category_code, c.sub_category_code, c.program_id]
      );
      centreIdByKey.set(ck, ins.rows[0].id);
      counts.centresCreated++; flags.centresCreated.push(`${c.centre_name} (${c.type_code}, prog${c.program_id})${schoolId ? ` -> school ${c.school_code}` : " UNLINKED"}`);
    }

    // ----- 2. USERS: resolve / reuse dot-variant / create -----
    const userIdByEmail = new Map<string, number>();
    for (const [email, p] of people) {
      const u = await client.query<{ id: number }>(`SELECT id FROM "user" WHERE lower(email)=$1`, [email]);
      if (u.rows.length === 1) { userIdByEmail.set(email, u.rows[0].id); continue; }
      if (u.rows.length > 1) throw new Error(`Ambiguous target user email ${email} (${u.rows.length} rows)`);
      // try dot-variant
      const variants = await client.query<{ id: number; email: string }>(
        `SELECT id, lower(email) email FROM "user" WHERE replace(lower(split_part(email,'@',1)),'.','')||'@'||lower(split_part(email,'@',2)) = $1`,
        [dotKey(email)]
      );
      if (variants.rows.length === 1) {
        userIdByEmail.set(email, variants.rows[0].id);
        flags.usersDotVariant.push(`${email} -> reused target ${variants.rows[0].email}`);
        continue;
      }
      // genuinely new
      const ins = await client.query<{ id: number }>(
        `INSERT INTO "user" (first_name, last_name, email, inserted_at, updated_at) VALUES ($1,$2,$3,now(),now()) RETURNING id`,
        [p.first_name, p.last_name, p.email]
      );
      userIdByEmail.set(email, ins.rows[0].id);
      counts.usersCreated++; flags.usersCreated.push(p.email);
    }

    // ----- 3. TEACHER / STAFF rows + perm-row presence flag -----
    for (const [email, p] of people) {
      const uid = userIdByEmail.get(email)!;
      // LINK the existing user_permission row to this user. In the old (prod) model
      // user_permission.user_id is mostly NULL; without this link both resolveScope
      // and the seat-as-source-of-truth clear (which join seats by user_id) can't
      // see the seat — so the seat would be orphaned and the scope clear a no-op.
      // This does NOT touch role/level/program_ids (owned by the perm importers).
      const linked = await client.query(
        `UPDATE user_permission SET user_id=$1, updated_at=now()
         WHERE lower(email)=$2 AND revoked_at IS NULL AND user_id IS DISTINCT FROM $1`, [uid, email]);
      counts.permLinked += linked.rowCount ?? 0;
      // flag: a seat with NO user_permission row grants no access (perms owned by the perm importers)
      const perm = await client.query<{ c: number }>(`SELECT count(*)::int c FROM user_permission WHERE lower(email)=$1 AND revoked_at IS NULL`, [email]);
      if ((perm.rows[0]?.c ?? 0) === 0) flags.permMissing.push(email);

      if (p.is_af_teacher) {
        const tRow = await client.query<{ id: number; subject_id: number | null }>(`SELECT id, subject_id FROM teacher WHERE user_id=$1 AND is_af_teacher=true`, [uid]);
        const subj = p.subject_id != null && targetSubjectIds.has(p.subject_id) ? p.subject_id : null;
        if (p.subject_id != null && subj == null) flags.subjectDropped.push(`${email}: subject_id ${p.subject_id} absent in target -> NULL`);
        if (tRow.rows.length === 0) {
          await client.query(`INSERT INTO teacher (user_id, is_af_teacher, subject_id, inserted_at, updated_at) VALUES ($1,true,$2,now(),now())`, [uid, subj]);
          counts.teacherRows++; flags.teacherRows.push(`${email} (subject ${subj ?? "—"})`);
        }
      }
      if (p.employee_code) {
        const st = await client.query<{ id: number }>(`SELECT id FROM staff WHERE upper(employee_code)=upper($1)`, [p.employee_code]);
        if (st.rows.length === 0) {
          await client.query(`INSERT INTO staff (user_id, employee_code, staff_type, designation, inserted_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
            [uid, p.employee_code, p.staff_type, p.designation]);
          counts.staffRows++; flags.staffRows.push(`${email} (${p.employee_code})`);
        }
      }
    }

    // ----- 4. SEATS: full replacement within programs P -----
    const desired = new Set<string>(); // centreId|role|userId
    for (const s of seats) {
      const cid = centreIdByKey.get(centreKey(s.centre_name, s.type_code, s.program_id));
      const uid = userIdByEmail.get(s.email);
      if (cid == null) { flags.seatsUnresolved.push(`${s.email} @ ${s.centre_name} (${s.role}) — centre needs decision`); continue; }
      if (uid == null) { flags.seatsUnresolved.push(`${s.email} @ ${s.centre_name} (${s.role}) — user unresolved`); continue; }
      desired.add(`${cid}|${s.role}|${uid}`);
    }
    counts.desiredSeats = desired.size;

    // existing active seats at ALL target centres in programs P (so dropped seats are removed)
    const existing = (await client.query<{ id: number; centre_id: number; role: string; user_id: number | null }>(
      `SELECT cp.id, cp.centre_id, cp.role, cp.user_id
       FROM centre_positions cp JOIN centres c ON c.id = cp.centre_id
       WHERE cp.deleted_at IS NULL AND c.program_id = ANY($1::int[])`,
      [cli.programs]
    )).rows;
    const existingActive = new Set<string>();
    for (const e of existing) {
      const k = `${e.centre_id}|${e.role}|${e.user_id}`;
      if (e.user_id != null && desired.has(k)) { existingActive.add(k); counts.seatsKept++; }
      else { await client.query(`UPDATE centre_positions SET deleted_at=now(), updated_at=now() WHERE id=$1`, [e.id]); counts.seatsSoftDeleted++; }
    }
    for (const k of desired) {
      if (existingActive.has(k)) continue;
      const [cid, role, uid] = k.split("|");
      await client.query(`INSERT INTO centre_positions (centre_id, role, user_id, inserted_at, updated_at) VALUES ($1,$2,$3,now(),now())`,
        [Number(cid), role, Number(uid)]);
      counts.seatsAdded++;
    }

    // ----- 5. SCOPE CLEAR (seat-as-source-of-truth) — guarded, mirrors clear-seated-scope.ts -----
    // report stranded / skipped BEFORE the update (within this txn, post-seat state)
    const seatedScope = (await client.query<{ email: string; school_codes: string[] | null; regions: string[] | null; seat_school_codes: string[] | null }>(
      `SELECT lower(up.email) email, up.school_codes, up.regions,
              array_agg(DISTINCT s.code) FILTER (WHERE s.code IS NOT NULL) seat_school_codes
       FROM user_permission up
       JOIN centre_positions cp ON cp.user_id = up.user_id AND cp.deleted_at IS NULL
       LEFT JOIN centres c ON c.id = cp.centre_id
       LEFT JOIN school s ON s.id = c.school_id
       WHERE up.revoked_at IS NULL
       GROUP BY up.user_id, up.email, up.school_codes, up.regions`
    )).rows;
    const stranded: string[] = [];
    const skippedWouldBeEmpty: string[] = [];
    for (const r of seatedScope) {
      const sc = r.school_codes ?? [], rg = r.regions ?? [], seat = new Set(r.seat_school_codes ?? []);
      if (sc.length === 0 && rg.length === 0) continue;
      if ((r.seat_school_codes ?? []).length === 0) { skippedWouldBeEmpty.push(r.email); continue; }
      const uncovered = sc.filter((c) => !seat.has(c));
      if (uncovered.length) stranded.push(`${r.email}: loses ${uncovered.join(",")}`);
    }
    const cleared = await client.query<{ user_id: number }>(
      `UPDATE user_permission up SET school_codes=NULL, regions=NULL, updated_at=now()
       WHERE up.revoked_at IS NULL AND (up.school_codes IS NOT NULL OR up.regions IS NOT NULL)
         AND EXISTS (SELECT 1 FROM centre_positions cp JOIN centres c ON c.id=cp.centre_id
                     WHERE cp.user_id=up.user_id AND cp.deleted_at IS NULL AND c.school_id IS NOT NULL)
       RETURNING up.user_id`
    );
    counts.scopeUsersCleared = cleared.rowCount ?? 0;

    // ===== commit / rollback =====
    if (cli.mode === "apply") await client.query("COMMIT");
    else await client.query("ROLLBACK");

    // ===== report =====
    const c = counts;
    console.log(`\n=== Mirror centre seats: ${sDb} (source) -> ${tDb} (target) [${cli.mode}] ===`);
    console.log(`programs: ${cli.programs.join(",")}`);
    console.log(`source seats: ${c.sourceSeats}   desired (resolved): ${c.desiredSeats}`);
    console.log(`\nCentres:  ${c.centresCreated} created, ${c.centresLinked} school-linked`);
    console.log(`Users:    ${c.usersCreated} created, ${flags.usersDotVariant.length} dot-variant reused`);
    console.log(`Rows:     ${c.teacherRows} teacher, ${c.staffRows} staff created`);
    console.log(`Perms:    ${c.permLinked} user_permission rows linked to a user (user_id backfill)`);
    console.log(`Seats:    ${c.seatsAdded} added, ${c.seatsSoftDeleted} soft-deleted, ${c.seatsKept} unchanged`);
    console.log(`Scope:    ${c.scopeUsersCleared} user_permission rows cleared (school_codes/regions -> NULL)`);

    const section = (title: string, items: string[]) => { if (items.length) { console.log(`\n${title} (${items.length}):`); for (const i of items) console.log(`  - ${i}`); } };
    console.log(`\n----- NEEDS DECISION / FLAGS -----`);
    section("⚠ centres NEEDS-DECISION (seats skipped)", flags.centreNeedsDecision);
    section("⚠ centres missing school link", flags.centreMissingSchool);
    section("⚠ seats UNRESOLVED (skipped)", flags.seatsUnresolved);
    section("⚠ seated users with NO active user_permission row (no access until perms imported)", flags.permMissing);
    section("⚠ scope-clear: users seated only at UNLINKED centres (skipped, keep explicit scope)", skippedWouldBeEmpty);
    section("⚠ scope-clear: STRANDED (cleared but a school_code no seat covers — access lost)", stranded);
    section("· subject_id dropped to NULL (absent in target)", flags.subjectDropped);
    if (cli.verbose) {
      section("centres created", flags.centresCreated);
      section("centres linked", flags.centresLinked);
      section("users created", flags.usersCreated);
      section("users dot-variant reused", flags.usersDotVariant);
      section("teacher rows created", flags.teacherRows);
      section("staff rows created", flags.staffRows);
    } else {
      console.log(`\n(run with --verbose for full created/linked lists)`);
    }
    if (cli.mode === "dry-run") console.log(`\nDRY-RUN: target transaction rolled back, nothing written. Re-run with --apply to persist.`);
    else console.log(`\nAPPLIED. Run the parity check next:  npm run pm:promodiff`);
  } catch (e) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    if (client) client.release();
    await source.end();
    await target.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.stack || e.message : e); process.exitCode = 1; });
