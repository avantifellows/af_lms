/**
 * Read-only PRE-PROMOTION diff: for teachers & staff in JNV CoE (program 1) and
 * JNV Nodal (program 2), how will the set of schools each person can access
 * CHANGE when we promote the staging centre-seat model to prod?
 *
 * Prod today (old model): access = user_permission.school_codes (level 1) or
 * "all" (level 3+). Staging (target model): access = explicit school_codes (L1)
 * ∪ centre-seat-derived schools (resolveScope semantics). Promotion replaces
 * prod's state with staging's, so diff(prod_now, staging) = exactly what changes.
 *
 * Scope of the comparison = the "migration domain": school codes linked to an
 * active centre in program 1 or 2 (staging). Seats only govern access to these
 * schools, so access to any other school is untouched and out of scope here.
 *
 * 100% read-only. Connects to BOTH dbs (staging .env.local, prod .env.production).
 *
 * Usage (from worktree root):
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/check-promotion-school-diff.ts
 *   npm run pm:promodiff           (if aliased)
 *   options: --staging-env= --prod-env= --out= --verbose
 */
import * as path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import * as dotenv from "dotenv";
import { Pool } from "pg";

const COE_NODAL = [1, 2];

interface Cli { stagingEnv: string; prodEnv: string; out: string; verbose: boolean; }
function parseArgs(argv: string[]): Cli {
  const o: Cli = { stagingEnv: ".env.local", prodEnv: ".env.production", out: "scripts/data/pm/promotion-school-diff.csv", verbose: false };
  for (const a of argv) {
    if (a === "--") continue;
    else if (a === "--verbose" || a === "-v") o.verbose = true;
    else if (a.startsWith("--staging-env=")) o.stagingEnv = a.slice(14);
    else if (a.startsWith("--prod-env=")) o.prodEnv = a.slice(11);
    else if (a.startsWith("--out=")) o.out = a.slice(6);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}
function poolFromEnvFile(envFile: string, label: string): Pool {
  if (!existsSync(envFile)) throw new Error(`${label} env file not found: ${envFile}`);
  const env = dotenv.parse(readFileSync(envFile));
  return new Pool({
    host: env.DATABASE_HOST, port: parseInt(env.DATABASE_PORT || "5432"),
    user: env.DATABASE_USER, password: env.DATABASE_PASSWORD, database: env.DATABASE_NAME,
    ssl: env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 4, connectionTimeoutMillis: 8000, statement_timeout: 30000,
  });
}
const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const sortedList = (s: Iterable<string>) => [...s].sort();

type PersonAgg = {
  email: string;
  prodLevel: number | null;       // max (broadest) level across prod CoE/Nodal rows
  prodRoles: Set<string>;
  prodSchools: Set<string>;       // school_codes ∩ domain (level-1 contribution)
  prodBroad: boolean;             // level>=3 → all schools
  stagingLevel: number | null;
  stagingRoles: Set<string>;      // seat roles ∪ user_permission role
  stagingSchools: Set<string>;    // (L1 school_codes ∩ D) ∪ seat schools(prog1/2)
  stagingBroad: boolean;
  seated: boolean;
};

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const staging = poolFromEnvFile(cli.stagingEnv, "STAGING");
  const prod = poolFromEnvFile(cli.prodEnv, "PROD");
  try {
    const sName = (await staging.query<{ d: string }>("SELECT current_database() d")).rows[0].d;
    const pName = (await prod.query<{ d: string }>("SELECT current_database() d")).rows[0].d;

    // --- DOMAIN: centre-linked schools in program 1/2 (staging = target model) ---
    const domRows = (await staging.query<{ code: string; name: string }>(
      `SELECT DISTINCT s.code, s.name FROM centres c JOIN school s ON s.id = c.school_id
       WHERE c.is_active = true AND c.program_id = ANY($1::int[]) AND c.school_id IS NOT NULL`,
      [COE_NODAL]
    )).rows;
    const DOMAIN = new Set(domRows.map((r) => r.code));
    const schoolName = new Map(domRows.map((r) => [r.code, r.name]));
    const inDom = (codes: string[] | null) => new Set((codes || []).filter((c) => DOMAIN.has(c)));

    const people = new Map<string, PersonAgg>();
    const get = (email: string): PersonAgg => {
      const e = email.toLowerCase();
      if (!people.has(e)) people.set(e, {
        email: e, prodLevel: null, prodRoles: new Set(), prodSchools: new Set(), prodBroad: false,
        stagingLevel: null, stagingRoles: new Set(), stagingSchools: new Set(), stagingBroad: false, seated: false,
      });
      return people.get(e)!;
    };

    // --- PROD: every active user_permission touching CoE/Nodal ---
    const prodRows = (await prod.query<{ email: string; level: number; role: string; school_codes: string[] | null }>(
      `SELECT lower(email) email, level, role, school_codes
       FROM user_permission WHERE revoked_at IS NULL AND program_ids && $1::int[]`,
      [COE_NODAL]
    )).rows;
    for (const r of prodRows) {
      const p = get(r.email);
      p.prodLevel = Math.max(p.prodLevel ?? 0, r.level);
      p.prodRoles.add(r.role);
      if (r.level >= 3) p.prodBroad = true;
      if (r.level === 1) for (const c of inDom(r.school_codes)) p.prodSchools.add(c);
    }

    // --- STAGING: seats at prog 1/2 centres ---
    const seatRows = (await staging.query<{ email: string; code: string; role: string }>(
      `SELECT lower(u.email) email, s.code, cp.role
       FROM centre_positions cp
       JOIN centres c ON c.id = cp.centre_id
       JOIN school  s ON s.id = c.school_id
       JOIN "user"  u ON u.id = cp.user_id
       WHERE cp.deleted_at IS NULL AND c.program_id = ANY($1::int[]) AND c.school_id IS NOT NULL`,
      [COE_NODAL]
    )).rows;
    for (const r of seatRows) {
      const p = get(r.email);
      p.seated = true;
      p.stagingRoles.add(r.role);
      if (DOMAIN.has(r.code)) p.stagingSchools.add(r.code);
    }
    // --- STAGING: user_permission (L1 explicit school_codes contribute; L3 broad) ---
    const stgPerm = (await staging.query<{ email: string; level: number; role: string; school_codes: string[] | null }>(
      `SELECT lower(email) email, level, role, school_codes
       FROM user_permission WHERE revoked_at IS NULL AND program_ids && $1::int[]`,
      [COE_NODAL]
    )).rows;
    for (const r of stgPerm) {
      const p = get(r.email);
      p.stagingLevel = Math.max(p.stagingLevel ?? 0, r.level);
      p.stagingRoles.add(r.role);
      if (r.level >= 3) p.stagingBroad = true;
      if (r.level === 1) for (const c of inDom(r.school_codes)) p.stagingSchools.add(c);
    }

    // --- CLASSIFY ---
    type Out = {
      email: string; bucket: string;
      prod_access: string; staging_access: string;
      schools_added: string; schools_removed: string;
      prod_role: string; staging_role: string; note: string;
    };
    const out: Out[] = [];
    const buckets: Record<string, number> = {};
    let totalAdded = 0, totalRemoved = 0;

    for (const p of people.values()) {
      // effective school sets within domain (broad = all of domain)
      const prodEff = p.prodBroad ? new Set(DOMAIN) : p.prodSchools;
      const stgEff = p.stagingBroad ? new Set(DOMAIN) : p.stagingSchools;
      const added = sortedList([...stgEff].filter((c) => !prodEff.has(c)));
      const removed = sortedList([...prodEff].filter((c) => !stgEff.has(c)));

      // The promotion importers are UPSERT-ONLY — they create/update seats and
      // mirror teacher rows, but never DELETE/revoke a prod row absent from their
      // input. So a person's prod access only CHANGES if they get SEATED in
      // staging (seating clears their explicit school_codes -> scope derives from
      // the seat). Everyone NOT seated is left exactly as prod has them today —
      // including prod L3 admins that staging (a partial env) simply doesn't
      // mirror. Counting those as "losses" would be a false alarm.
      let bucket: string;
      const inProd = p.prodLevel != null;
      if (!p.seated) {
        bucket = "UNTOUCHED"; // upsert-only importers don't revoke; prod access preserved
      } else if (!inProd) bucket = "NEW_IN_STAGING";
      else if (setsEqual(prodEff, stgEff)) bucket = "UNCHANGED";
      else if (added.length && !removed.length) bucket = "GAINED_ONLY";
      else if (removed.length && !added.length) bucket = "LOST_ONLY";
      else bucket = "CHANGED_BOTH";

      buckets[bucket] = (buckets[bucket] || 0) + 1;
      // only count access deltas for people the promotion actually touches
      if (p.seated) { totalAdded += added.length; totalRemoved += removed.length; }

      const showSets = bucket !== "UNCHANGED" && bucket !== "UNTOUCHED";
      out.push({
        email: p.email, bucket,
        prod_access: p.prodBroad ? "ALL(L3+)" : sortedList(prodEff).join("|"),
        staging_access: p.stagingBroad ? "ALL(L3+)" : sortedList(stgEff).join("|"),
        schools_added: added.join("|"),
        schools_removed: removed.join("|"),
        prod_role: `${p.prodLevel != null ? "L" + p.prodLevel + " " : ""}${[...p.prodRoles].join(",")}`,
        staging_role: `${p.stagingLevel != null ? "L" + p.stagingLevel + " " : ""}${[...p.stagingRoles].join(",")}${p.seated ? " (seated)" : ""}`,
        note: showSets ? "" : "no school-access change within domain",
      });
    }

    // --- OUTPUT ---
    const order = ["LOST_ONLY", "CHANGED_BOTH", "GAINED_ONLY", "NEW_IN_STAGING", "UNCHANGED", "UNTOUCHED"];
    console.log(`\n=== Promotion school-access diff — JNV CoE (1) + JNV Nodal (2), teachers & staff ===`);
    console.log(`staging(target): ${sName}   prod(current): ${pName}`);
    console.log(`migration domain: ${DOMAIN.size} centre-linked schools in prog 1/2`);
    console.log(`people in scope: ${people.size}`);
    console.log(`(promotion is UPSERT-ONLY: only SEATED people have their scope rewritten; UNTOUCHED = prod access preserved as-is)\n`);
    console.log(`change buckets:`);
    for (const b of order) if (buckets[b]) console.log(`  ${String(buckets[b]).padStart(3)}  ${b}`);
    const changed = (buckets.LOST_ONLY||0)+(buckets.CHANGED_BOTH||0)+(buckets.GAINED_ONLY||0)+(buckets.NEW_IN_STAGING||0);
    console.log(`\n  → ${changed} seated people have a school-access CHANGE; ${buckets.UNCHANGED||0} seated-unchanged; ${buckets.UNTOUCHED||0} untouched by promotion`);
    console.log(`  → among changed: (person,school) access GAINED: ${totalAdded}   REMOVED: ${totalRemoved}`);

    // surface the risk buckets (access removed) inline
    const losers = out.filter((r) => r.bucket === "LOST_ONLY" || r.bucket === "CHANGED_BOTH")
      .sort((a, b) => a.bucket.localeCompare(b.bucket) || a.email.localeCompare(b.email));
    if (losers.length) {
      console.log(`\n--- ACCESS REMOVED (review carefully — these people lose schools) ---`);
      for (const r of losers) {
        const rem = r.schools_removed.split("|").filter(Boolean).map((c) => `${schoolName.get(c) || "?"}(${c})`).join(", ");
        console.log(`  [${r.bucket}] ${r.email} (${r.prod_role} → ${r.staging_role}) loses: ${rem || "(all CoE/Nodal access)"}`);
      }
    }
    if (cli.verbose) {
      const gainers = out.filter((r) => r.bucket === "GAINED_ONLY" || r.bucket === "NEW_IN_STAGING").sort((a,b)=>a.email.localeCompare(b.email));
      console.log(`\n--- ACCESS GAINED ---`);
      for (const r of gainers) {
        const add = r.schools_added.split("|").filter(Boolean).map((c) => `${schoolName.get(c) || "?"}(${c})`).join(", ");
        console.log(`  [${r.bucket}] ${r.email} (${r.prod_role} → ${r.staging_role}) gains: ${add}`);
      }
    }

    // CSV
    const header = ["bucket","email","prod_role","staging_role","prod_access","staging_access","schools_added","schools_removed","note"];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [header.join(",")].concat(
      out.sort((a,b)=> order.indexOf(a.bucket)-order.indexOf(b.bucket) || a.email.localeCompare(b.email))
        .map((r)=>header.map((h)=>esc(String((r as any)[h] ?? ""))).join(","))
    ).join("\n");
    const outPath = path.resolve(cli.out);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, csv + "\n");
    console.log(`\nCSV: ${outPath}  (${out.length} rows; contains emails — gitignored dir)`);
  } finally { await staging.end(); await prod.end(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.stack || e.message : e); process.exitCode = 1; });
