/**
 * Last updated: 2026-06-30 (8bc1326). One-off script — if the schema or app has
 * moved on since this date, review/update it before running.
 *
 * Import PM-family centre assignments (apm/pm/spm/ph seats) from the ops
 * spreadsheet, plus the people + centre lifecycle they imply. Full replacement
 * of PM-family seats on the in-sheet centres; subject-teacher seats are left
 * untouched.
 *
 * Env-portable: resolves people by email/AF code and centres by name+type, so
 * the SAME inputs drive staging now and prod later. Inputs are the business-key
 * CSVs in scripts/data/pm/ (people.csv, centres.csv, seats.csv), produced by
 * the Python exporter from the sheet + budget DB.
 *
 * Dry-run executes every read/write inside a transaction then ROLLBACKs, so the
 * printed plan is exact (real ids, real diff) but nothing persists.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/import-pm-centres.ts            # dry-run vs .env.local (staging)
 *   npx ts-node ... scripts/import-pm-centres.ts -- --apply
 *   npx ts-node ... scripts/import-pm-centres.ts -- --env=production --apply
 */
import * as path from "path";
import { readFileSync } from "fs";
import * as dotenv from "dotenv";
import { parse } from "csv-parse/sync";
import type { PoolClient } from "pg";
import { PM_SEAT_ROLES } from "../src/lib/staff-shared";

interface Cli { mode: "dry-run" | "apply"; envFile: string; dataDir: string; verbose: boolean; }
function parseArgs(argv: string[]): Cli {
  const o: Cli = { mode: "dry-run", envFile: ".env.local", dataDir: "scripts/data/pm", verbose: false };
  for (const a of argv) {
    if (a === "--") continue;
    else if (a === "--apply") o.mode = "apply";
    else if (a === "--dry-run") o.mode = "dry-run";
    else if (a === "--verbose" || a === "-v") o.verbose = true;
    else if (a.startsWith("--env=")) o.envFile = `.env.${a.slice(6)}`;
    else if (a.startsWith("--env-file=")) o.envFile = a.slice(11);
    else if (a.startsWith("--data=")) o.dataDir = a.slice(7);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

type PersonRow = { af_code: string; email: string; first_name: string; last_name: string; designation: string; staff_type: string; up_role: string };
type CentreRow = { action: string; name: string; type_code: string; category_code: string; sub_category_code: string };
type SeatRow = { centre_name: string; centre_type: string; seat_role: string; af_code: string; email: string };

function loadCsv<T>(file: string): T[] {
  return parse(readFileSync(file), { columns: true, skip_empty_lines: true, trim: true }) as T[];
}

const PROGRAM_FOR_TYPE: Record<string, number> = { coe: 1, nodal: 2 };

async function run(client: PoolClient, cli: Cli) {
  const dir = path.resolve(cli.dataDir);
  const people = loadCsv<PersonRow>(path.join(dir, "people.csv"));
  const centresInput = loadCsv<CentreRow>(path.join(dir, "centres.csv"));
  const seats = loadCsv<SeatRow>(path.join(dir, "seats.csv"));

  const log: string[] = [];
  const counts = { centresCreated: 0, centresClosed: 0, usersCreated: 0, staffCreated: 0,
    permsUpserted: 0, seatsAdded: 0, seatsSoftDeleted: 0, seatsKept: 0 };

  // ---- 1. Centre lifecycle ----
  for (const c of centresInput) {
    if (c.action === "create") {
      const found = await client.query<{ id: number }>(
        `SELECT id FROM centres WHERE lower(name)=lower($1) AND coalesce(type_code,'')=$2`,
        [c.name, c.type_code]);
      if (found.rows.length > 0) { log.push(`centre exists, skip create: ${c.name} (${c.type_code}) id=${found.rows[0].id}`); continue; }
      const programId = PROGRAM_FOR_TYPE[c.type_code] ?? null;
      const ins = await client.query<{ id: number }>(
        `INSERT INTO centres (name, type_code, category_code, sub_category_code, program_id, is_physical, is_active, inserted_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,true,true,now(),now()) RETURNING id`,
        [c.name, c.type_code, c.category_code || null, c.sub_category_code || null, programId]);
      counts.centresCreated++; log.push(`CREATE centre ${c.name} (${c.type_code}/${c.category_code}/${c.sub_category_code}) -> id=${ins.rows[0].id}`);
    } else if (c.action === "close") {
      const upd = await client.query(
        `UPDATE centres SET is_active=false, updated_at=now()
         WHERE lower(name)=lower($1) AND coalesce(type_code,'')=$2 AND is_active=true`, [c.name, c.type_code]);
      if (upd.rowCount && upd.rowCount > 0) { counts.centresClosed++; log.push(`CLOSE centre ${c.name} (set is_active=false)`); }
      else log.push(`close no-op (already inactive/not found): ${c.name}`);
    }
  }

  // ---- 2. People: user + staff + user_permission ----
  // program_ids per person = distinct program_id over the centres they're seated on (admins get full set)
  const seatsByAf = new Map<string, SeatRow[]>();
  for (const s of seats) { (seatsByAf.get(s.af_code) ?? seatsByAf.set(s.af_code, []).get(s.af_code)!).push(s); }

  const userIdByEmail = new Map<string, number>();
  for (const p of people) {
    const email = p.email.toLowerCase();
    // resolve / create user
    const u = await client.query<{ id: number }>(`SELECT id FROM "user" WHERE lower(email)=$1`, [email]);
    let userId: number;
    if (u.rows.length === 0) {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO "user" (first_name, last_name, email, inserted_at, updated_at) VALUES ($1,$2,$3,now(),now()) RETURNING id`,
        [p.first_name, p.last_name || null, p.email]);
      userId = ins.rows[0].id; counts.usersCreated++; log.push(`CREATE user ${p.email} (${p.first_name} ${p.last_name}) -> id=${userId}`);
    } else if (u.rows.length === 1) { userId = u.rows[0].id; }
    else { throw new Error(`Ambiguous user email ${p.email} (${u.rows.length} rows)`); }
    userIdByEmail.set(p.af_code, userId);

    // ensure staff by employee_code
    const st = await client.query<{ id: number }>(`SELECT id FROM staff WHERE upper(employee_code)=upper($1)`, [p.af_code]);
    if (st.rows.length === 0) {
      await client.query(
        `INSERT INTO staff (user_id, employee_code, staff_type, designation, inserted_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
        [userId, p.af_code, p.staff_type, p.designation || null]);
      counts.staffCreated++; log.push(`CREATE staff ${p.af_code} (${p.designation}) user=${userId}`);
    }

    // program_ids
    let programIds: number[];
    if (p.up_role === "admin") programIds = [1, 2, 64];
    else {
      const pids = new Set<number>();
      for (const s of seatsByAf.get(p.af_code) ?? []) {
        const row = await client.query<{ program_id: number | null }>(
          `SELECT program_id FROM centres WHERE lower(name)=lower($1) AND coalesce(type_code,'')=$2`, [s.centre_name, s.centre_type]);
        if (row.rows[0]?.program_id != null) pids.add(row.rows[0].program_id);
      }
      programIds = [...pids].sort((a, b) => a - b);
    }
    const level = p.up_role === "admin" ? 3 : 1;
    // upsert user_permission by email; seat-derived scope -> clear school_codes/regions
    await client.query(
      `INSERT INTO user_permission (email, role, level, program_ids, user_id, school_codes, regions, read_only, inserted_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,NULL,NULL,false,now(),now())
       ON CONFLICT (email) DO UPDATE SET role=EXCLUDED.role, level=EXCLUDED.level, program_ids=EXCLUDED.program_ids,
         user_id=EXCLUDED.user_id, school_codes=NULL, regions=NULL, updated_at=now(), revoked_at=NULL`,
      [p.email, p.up_role, level, programIds, userId]);
    counts.permsUpserted++;
    if (cli.verbose) log.push(`perm ${p.email} role=${p.up_role} level=${level} programs=[${programIds}] user=${userId}`);
  }

  // ---- 3. Seats: full replacement of PM-family roles on in-sheet centres ----
  // resolve desired (centre_id, role, user_id)
  const centreIdCache = new Map<string, number | null>();
  async function centreId(name: string, type: string): Promise<number | null> {
    const key = `${name.toLowerCase()}|${type}`;
    if (centreIdCache.has(key)) return centreIdCache.get(key)!;
    const r = await client.query<{ id: number }>(
      `SELECT id FROM centres WHERE lower(name)=lower($1) AND coalesce(type_code,'')=$2`, [name, type]);
    const id = r.rows[0]?.id ?? null; centreIdCache.set(key, id); return id;
  }
  const desired = new Set<string>();           // `${centreId}|${role}|${userId}`
  const inScopeCentres = new Set<number>();
  const unresolvedSeats: string[] = [];
  for (const s of seats) {
    const cid = await centreId(s.centre_name, s.centre_type);
    const uid = userIdByEmail.get(s.af_code);
    if (cid == null) { unresolvedSeats.push(`centre ${s.centre_name} (${s.centre_type})`); continue; }
    if (uid == null) { unresolvedSeats.push(`person ${s.af_code}`); continue; }
    desired.add(`${cid}|${s.seat_role}|${uid}`);
    inScopeCentres.add(cid);
  }

  const centreIds = [...inScopeCentres];
  const existing = await client.query<{ id: number; centre_id: number; role: string; user_id: number | null }>(
    `SELECT id, centre_id, role, user_id FROM centre_positions
     WHERE centre_id = ANY($1::bigint[]) AND role = ANY($2::varchar[]) AND deleted_at IS NULL`,
    [centreIds, [...PM_SEAT_ROLES]]);
  const existingActive = new Set<string>();
  for (const e of existing.rows) {
    const key = `${e.centre_id}|${e.role}|${e.user_id}`;
    if (e.user_id != null && desired.has(key)) { existingActive.add(key); counts.seatsKept++; }
    else {
      await client.query(`UPDATE centre_positions SET deleted_at=now(), updated_at=now() WHERE id=$1`, [e.id]);
      counts.seatsSoftDeleted++;
      if (cli.verbose) log.push(`soft-delete seat id=${e.id} centre=${e.centre_id} role=${e.role} user=${e.user_id}`);
    }
  }
  for (const key of desired) {
    if (existingActive.has(key)) continue;
    const [cid, role, uid] = key.split("|");
    await client.query(
      `INSERT INTO centre_positions (centre_id, role, user_id, inserted_at, updated_at) VALUES ($1,$2,$3,now(),now())`,
      [Number(cid), role, Number(uid)]);
    counts.seatsAdded++;
  }

  return { counts, log, unresolvedSeats, inScope: centreIds.length };
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
    if (cli.mode === "apply") { await client.query("COMMIT"); }
    else { await client.query("ROLLBACK"); }

    console.log(`\nPM centre-assignment import (${cli.mode}) :: env=${cli.envFile}`);
    console.log(`In-scope centres (PM-family seats managed): ${r.inScope}`);
    const c = r.counts;
    console.log(`Centres:   ${c.centresCreated} created, ${c.centresClosed} closed`);
    console.log(`People:    ${c.usersCreated} users created, ${c.staffCreated} staff created, ${c.permsUpserted} permissions upserted`);
    console.log(`Seats:     ${c.seatsAdded} added, ${c.seatsSoftDeleted} soft-deleted, ${c.seatsKept} unchanged`);
    if (r.unresolvedSeats.length) {
      console.log(`\nUNRESOLVED (${r.unresolvedSeats.length}) — these seats were skipped:`);
      for (const u of [...new Set(r.unresolvedSeats)]) console.log(`  - ${u}`);
    }
    if (cli.verbose) { console.log(`\nDetail:`); for (const l of r.log) console.log(`  ${l}`); }
    else { console.log(`\n(run with --verbose for per-row detail)`); }
    if (cli.mode === "dry-run") console.log(`\nDRY-RUN: transaction rolled back, nothing written. Re-run with --apply to persist.`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.stack || e.message : e); process.exitCode = 1; });
