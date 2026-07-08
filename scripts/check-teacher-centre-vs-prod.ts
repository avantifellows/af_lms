/**
 * Read-only consistency check: do STAGING centre<->teacher seat mappings line
 * up with PRODUCTION user<->school mappings, for every teacher whose school is
 * linked to a centre?
 *
 * Why this exists: staging is the new model (teachers seated at centres; scope
 * derives from the seat, so staging's own user_permission.school_codes are
 * CLEARED for seated teachers). Prod is still the old model (everyone in
 * user_permission with school_codes, no seats). So prod is the only reference
 * for "which school does this teacher actually belong to" — this script joins
 * the two by email and reports every divergence.
 *
 * Connects to BOTH databases at once (staging from .env.local, prod from
 * .env.production), so it needs no MCP and can run live on a call. 100% read-only
 * — no BEGIN/COMMIT, no writes.
 *
 * Identifier note: prod user_permission.school_codes stores school.code (the AF
 * short code, e.g. "49057"), the SAME value a centre's linked school carries via
 * centres.school_id -> school.code. So the comparison is code-to-code.
 *
 * Usage (from the worktree root):
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/check-teacher-centre-vs-prod.ts
 *   # options:
 *   #   --staging-env=.env.local        (default)
 *   #   --prod-env=.env.production      (default; must exist, gitignored)
 *   #   --out=scripts/data/pm/teacher-centre-vs-prod.csv   (default; gitignored dir)
 *   #   --verbose                       (print every exception inline)
 *
 * Or: npm run pm:check
 */
import * as path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import * as dotenv from "dotenv";
import { Pool } from "pg";
import { SEAT_ROLES, PM_SEAT_ROLES } from "../src/lib/staff-shared";

// Subject-teaching seat roles = all seat roles that aren't PM-family tiers.
const TEACHER_SEAT_ROLES = SEAT_ROLES.filter(
  (r) => !(PM_SEAT_ROLES as readonly string[]).includes(r)
);

interface Cli {
  stagingEnv: string;
  prodEnv: string;
  out: string;
  verbose: boolean;
}
function parseArgs(argv: string[]): Cli {
  const o: Cli = {
    stagingEnv: ".env.local",
    prodEnv: ".env.production",
    out: "scripts/data/pm/teacher-centre-vs-prod.csv",
    verbose: false,
  };
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
  if (!existsSync(envFile)) {
    throw new Error(
      `${label} env file not found: ${envFile}\n` +
        (envFile.includes("production")
          ? `  -> copy it from the main clone: cp ~/af/af_lms/.env.production .env.production (it's gitignored)`
          : "")
    );
  }
  const env = dotenv.parse(readFileSync(envFile));
  return new Pool({
    host: env.DATABASE_HOST,
    port: parseInt(env.DATABASE_PORT || "5432"),
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    ssl: env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 4,
    connectionTimeoutMillis: 8000,
    statement_timeout: 30000,
  });
}

// gmail ignores dots in the local part; flag "same person, email typed
// differently" rather than silently treating them as equal.
function dotKey(email: string): string {
  const [local, domain] = email.toLowerCase().split("@");
  if (!domain) return email.toLowerCase();
  return `${local.replace(/\./g, "")}@${domain}`;
}

type SeatRow = {
  email: string;
  school_code: string;
  school_name: string;
  centre_id: string;
  centre_name: string;
  centre_program_id: number | null;
  role: string;
};
type ProdRow = {
  email: string;
  school_codes: string[];
  program_ids: number[] | null;
  read_only: boolean;
};
type CentreSchool = {
  code: string;
  centres: { id: string; name: string; program_id: number | null }[];
};

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const staging = poolFromEnvFile(cli.stagingEnv, "STAGING");
  const prod = poolFromEnvFile(cli.prodEnv, "PROD");

  try {
    // --- sanity: confirm we're pointed where we think ---
    const sName = (await staging.query<{ d: string }>("SELECT current_database() d")).rows[0].d;
    const pName = (await prod.query<{ d: string }>("SELECT current_database() d")).rows[0].d;

    // --- STAGING: teacher seats at centres WITH a linked school ---
    const seats = (
      await staging.query<SeatRow>(
        `SELECT lower(u.email)   AS email,
                s.code           AS school_code,
                s.name           AS school_name,
                c.id::text       AS centre_id,
                c.name           AS centre_name,
                c.program_id     AS centre_program_id,
                cp.role          AS role
         FROM centre_positions cp
         JOIN centres c ON c.id = cp.centre_id
         JOIN school  s ON s.id = c.school_id
         JOIN "user"  u ON u.id = cp.user_id
         WHERE cp.deleted_at IS NULL
           AND cp.role = ANY($1::text[])
           AND c.school_id IS NOT NULL
         ORDER BY 1, 2`,
        [TEACHER_SEAT_ROLES]
      )
    ).rows;

    // --- STAGING: every email holding ANY active seat (incl PM-family) ---
    // Lets us distinguish "not seated at all" from "seated, but as a PM/etc.".
    const anySeatEmails = new Set(
      (
        await staging.query<{ email: string }>(
          `SELECT DISTINCT lower(u.email) AS email
           FROM centre_positions cp JOIN "user" u ON u.id = cp.user_id
           WHERE cp.deleted_at IS NULL AND cp.user_id IS NOT NULL`
        )
      ).rows.map((r) => r.email)
    );

    // --- STAGING: active centres with a linked school -> code + its centres ---
    const centreSchoolRows = (
      await staging.query<{ code: string; centre_id: string; centre_name: string; program_id: number | null }>(
        `SELECT s.code AS code, c.id::text AS centre_id, c.name AS centre_name, c.program_id AS program_id
         FROM centres c JOIN school s ON s.id = c.school_id
         WHERE c.is_active = true AND c.school_id IS NOT NULL`
      )
    ).rows;
    const centreSchools = new Map<string, CentreSchool>();
    for (const r of centreSchoolRows) {
      if (!centreSchools.has(r.code)) centreSchools.set(r.code, { code: r.code, centres: [] });
      centreSchools.get(r.code)!.centres.push({ id: r.centre_id, name: r.centre_name, program_id: r.program_id });
    }

    // --- PROD: level-1 teachers (the population that maps to a single school) ---
    const prodTeachers = (
      await prod.query<ProdRow>(
        `SELECT lower(email) AS email, school_codes, program_ids, read_only
         FROM user_permission
         WHERE level = 1 AND role = 'teacher' AND revoked_at IS NULL`
      )
    ).rows;
    const prodByEmail = new Map<string, ProdRow>();
    const prodByDotKey = new Map<string, ProdRow>();
    for (const p of prodTeachers) {
      prodByEmail.set(p.email, p);
      prodByDotKey.set(dotKey(p.email), p);
    }

    // --- school code -> name, for display of prod-only codes ---
    const allCodes = new Set<string>();
    for (const s of seats) allCodes.add(s.school_code);
    for (const c of centreSchools.keys()) allCodes.add(c);
    for (const p of prodTeachers) for (const c of p.school_codes || []) allCodes.add(c);
    const nameRows = (
      await staging.query<{ code: string; name: string }>(
        `SELECT code, name FROM school WHERE code = ANY($1::text[])`,
        [[...allCodes]]
      )
    ).rows;
    const schoolName = new Map(nameRows.map((r) => [r.code, r.name]));
    const nm = (code: string) => schoolName.get(code) || "?";

    // staging teacher-seat schools per email
    const seatSchoolsByEmail = new Map<string, Set<string>>();
    for (const s of seats) {
      if (!seatSchoolsByEmail.has(s.email)) seatSchoolsByEmail.set(s.email, new Set());
      seatSchoolsByEmail.get(s.email)!.add(s.school_code);
    }

    type Csv = {
      issue: string;
      email: string;
      prod_school_code: string;
      prod_school_name: string;
      seat_school_code: string;
      seat_school_name: string;
      seat_centre: string;
      seat_role: string;
      note: string;
    };
    const rows: Csv[] = [];

    // ===== FORWARD: is each staging teacher-seat backed by prod? =====
    let fwdMatch = 0;
    const fwdMismatch: SeatRow[] = [];
    const fwdNoProd: SeatRow[] = [];
    for (const s of seats) {
      const p = prodByEmail.get(s.email);
      if (!p) {
        const fuzzy = prodByDotKey.get(dotKey(s.email));
        fwdNoProd.push(s);
        rows.push({
          issue: "SEAT_NO_PROD_ROW",
          email: s.email,
          prod_school_code: fuzzy ? fuzzy.school_codes.join("|") : "",
          prod_school_name: fuzzy ? fuzzy.school_codes.map(nm).join("|") : "",
          seat_school_code: s.school_code,
          seat_school_name: s.school_name,
          seat_centre: s.centre_name,
          seat_role: s.role,
          note: fuzzy
            ? `no exact prod match; email dot-variant exists in prod: ${fuzzy.email} (likely same person)`
            : "teacher seated in staging but has no prod level-1 teacher grant",
        });
        continue;
      }
      if ((p.school_codes || []).includes(s.school_code)) {
        fwdMatch++;
        continue;
      }
      fwdMismatch.push(s);
      const otherSeatMatches = [...(seatSchoolsByEmail.get(s.email) || [])].some((c) =>
        (p.school_codes || []).includes(c)
      );
      rows.push({
        issue: otherSeatMatches ? "SEAT_EXTRA_SCHOOL" : "SEAT_SCHOOL_MISMATCH",
        email: s.email,
        prod_school_code: (p.school_codes || []).join("|"),
        prod_school_name: (p.school_codes || []).map(nm).join("|"),
        seat_school_code: s.school_code,
        seat_school_name: s.school_name,
        seat_centre: s.centre_name,
        seat_role: s.role,
        note: otherSeatMatches
          ? "second/extra seat; teacher's primary seat DOES match prod"
          : "staging seats this teacher at a school prod does not assign them",
      });
    }

    // ===== REVERSE: is every prod centre-linked teacher seated in staging? =====
    let revOk = 0;
    const revElsewhere: { email: string; code: string }[] = [];
    const revNotSeated: { email: string; code: string; note: string }[] = [];
    for (const p of prodTeachers) {
      for (const code of p.school_codes || []) {
        if (!centreSchools.has(code)) continue; // school isn't linked to a centre -> out of scope
        const seatCodes = seatSchoolsByEmail.get(p.email);
        if (seatCodes && seatCodes.has(code)) {
          revOk++;
          continue;
        }
        const centreList = centreSchools
          .get(code)!
          .centres.map((c) => `${c.name}(prog${c.program_id ?? "?"})`)
          .join("; ");
        if (seatCodes && seatCodes.size > 0) {
          revElsewhere.push({ email: p.email, code });
          rows.push({
            issue: "PROD_SEATED_DIFFERENT_SCHOOL",
            email: p.email,
            prod_school_code: code,
            prod_school_name: nm(code),
            seat_school_code: [...seatCodes].join("|"),
            seat_school_name: [...seatCodes].map(nm).join("|"),
            seat_centre: centreList,
            seat_role: "",
            note: "prod says this school; staging seats them at a different school",
          });
        } else {
          let note: string;
          if (anySeatEmails.has(p.email)) note = "has a staging seat but NOT a teacher seat (likely seated as PM/other)";
          else {
            const fuzzyEmail = [...seatSchoolsByEmail.keys()].find((e) => dotKey(e) === dotKey(p.email) && e !== p.email);
            note = fuzzyEmail
              ? `no seat under this email; email dot-variant IS seated: ${fuzzyEmail} (likely same person)`
              : "no staging seat at all";
          }
          revNotSeated.push({ email: p.email, code, note });
          rows.push({
            issue: "PROD_NOT_SEATED",
            email: p.email,
            prod_school_code: code,
            prod_school_name: nm(code),
            seat_school_code: "",
            seat_school_name: "",
            seat_centre: centreList,
            seat_role: "",
            note,
          });
        }
      }
    }

    // ===== OUTPUT =====
    console.log(`\n=== Teacher centre<->prod consistency check ===`);
    console.log(`staging: ${sName} (${cli.stagingEnv})   prod: ${pName} (${cli.prodEnv})`);
    console.log(`teacher seat roles: ${TEACHER_SEAT_ROLES.join(", ")}`);
    console.log(`centre-linked schools (staging, active): ${centreSchools.size}`);
    console.log();
    console.log(`FORWARD — staging teacher seats vs prod school_codes (${seats.length} seats):`);
    console.log(`  ${fwdMatch}  match prod`);
    console.log(`  ${fwdMismatch.length}  seated at a school prod doesn't assign (incl. extra second seats)`);
    console.log(`  ${fwdNoProd.length}  teacher has no prod level-1 teacher grant`);
    console.log();
    const pop = revOk + revElsewhere.length + revNotSeated.length;
    console.log(`REVERSE — prod teachers whose school is centre-linked (${pop} teacher-school pairs):`);
    console.log(`  ${revOk}  seated at the centre for their prod school`);
    console.log(`  ${revElsewhere.length}  seated, but at a different school`);
    console.log(`  ${revNotSeated.length}  not seated as a teacher in staging`);
    console.log();
    console.log(`Total exception rows written: ${rows.length}`);

    if (cli.verbose) {
      console.log(`\n--- all exceptions ---`);
      for (const r of rows) console.log(`  [${r.issue}] ${r.email}  prod=${r.prod_school_code} seat=${r.seat_school_code} ${r.seat_centre}  :: ${r.note}`);
    } else {
      // always surface the sharpest bucket inline — useful live. Forward
      // (seat-based) and reverse (prod-based) catch the same divergence from
      // both ends, so dedupe by person+schools for a clean read.
      const sharp = rows.filter((r) => r.issue === "SEAT_SCHOOL_MISMATCH" || r.issue === "PROD_SEATED_DIFFERENT_SCHOOL");
      const seen = new Set<string>();
      const lines: string[] = [];
      for (const r of sharp) {
        const key = `${r.email}|${r.seat_school_code}|${r.prod_school_code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`  ${r.email}: staging "${r.seat_school_name || r.seat_centre}" (${r.seat_school_code}) vs prod "${r.prod_school_name}" (${r.prod_school_code})`);
      }
      if (lines.length) {
        console.log(`\n--- wrong-school divergences (staging seat != prod school), ${lines.length} distinct ---`);
        for (const l of lines) console.log(l);
      }
    }

    // CSV
    const header = ["issue", "email", "prod_school_code", "prod_school_name", "seat_school_code", "seat_school_name", "seat_centre", "seat_role", "note"];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [header.join(",")]
      .concat(
        rows
          .sort((a, b) => a.issue.localeCompare(b.issue) || a.email.localeCompare(b.email))
          .map((r) => header.map((h) => esc(String((r as unknown as Record<string, unknown>)[h] ?? ""))).join(","))
      )
      .join("\n");
    const outPath = path.resolve(cli.out);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, csv + "\n");
    console.log(`\nCSV: ${outPath}`);
    console.log(`(${rows.length} rows. Contains emails — path is under a gitignored dir.)`);
  } finally {
    await staging.end();
    await prod.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : e);
  process.exitCode = 1;
});
