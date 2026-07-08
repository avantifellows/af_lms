/**
 * Backfill teachers/PMs from user_permission into user/teacher/staff +
 * centre_positions. See src/lib/staff-backfill.ts for the rules.
 *
 * Usage:
 *   npm run staff:backfill                       # dry-run against .env.local (staging)
 *   npm run staff:backfill -- --apply
 *   npm run staff:backfill -- --env-file=.env.production
 *   npm run staff:backfill -- --sheet=path.tsv --hr=path.json
 */

import * as dotenv from "dotenv";
import type { BackfillMode, BackfillReport } from "../src/lib/staff-backfill";

interface CliOptions {
  mode: BackfillMode;
  envFile: string;
  sheetPath: string;
  hrPath: string;
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "dry-run",
    envFile: ".env.local",
    sheetPath: "docs/ai/teacher-staff/review-sheet-latest.tsv",
    hrPath: "docs/ai/teacher-staff/hr-employees.json",
    verbose: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--apply") options.mode = "apply";
    else if (arg === "--dry-run") options.mode = "dry-run";
    else if (arg === "--verbose" || arg === "-v") options.verbose = true;
    else if (arg.startsWith("--env=")) options.envFile = `.env.${arg.slice(6)}`;
    else if (arg.startsWith("--env-file=")) options.envFile = arg.slice(11);
    else if (arg.startsWith("--sheet=")) options.sheetPath = arg.slice(8);
    else if (arg.startsWith("--hr=")) options.hrPath = arg.slice(5);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printReport(report: BackfillReport, verbose: boolean): void {
  console.log(`Staff backfill (${report.mode})`);
  if (!report.ok && report.error) console.error(report.error);

  const c = report.counts;
  console.log(`Source rows: ${c.sourceTeachers} teachers, ${c.sourcePms} PMs`);
  console.log(`Skipped (test account / excluded): ${c.skipped}`);
  console.log(`Users: ${c.usersToCreate} to create, ${c.usersLinked} linked to existing`);
  console.log(
    `Teachers: ${c.teachersToCreate} to create, ${c.teachersLinkedExisting} existing rows updated; ` +
      `${c.teachersWithCode} with AF code, ${c.teachersWithoutCode} WITHOUT code (fill via admin UI)`
  );
  console.log(
    `Staff (PMs): ${c.staffToCreate} to create, ${c.staffPendingNoCode} pending (no code -> no staff row yet)`
  );
  console.log(`Seats: ${c.seatsToCreate} to create, ${c.seatsExisting} already present`);

  const skipped = report.plans.filter((p) => p.skipped);
  if (skipped.length > 0) {
    console.log(`\nSkipped people:`);
    for (const p of skipped) console.log(`- ${p.email} (${p.skipReason})`);
  }

  if (report.warnings.length > 0) {
    console.log(`\nWarnings / gaps (${report.warnings.length}):`);
    for (const w of report.warnings) console.log(`- ${w}`);
  }

  if (verbose) {
    console.log(`\nPer-person plan:`);
    for (const p of report.plans) {
      if (p.skipped) continue;
      const seats = p.seats
        .map((s) => `${s.role}@${s.centreName}`)
        .join(", ");
      console.log(
        `- ${p.email} [${p.role}] code=${p.code ?? "—"} (${p.codeSource}) user=${p.userAction}` +
          (p.role === "teacher" ? ` teacher=${p.teacherAction}` : ` staff=${p.staffAction}`) +
          (seats ? ` seats: ${seats}` : "")
      );
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      `Usage: npm run staff:backfill -- [--apply|--dry-run] [--env-file=.env.local] [--sheet=path.tsv] [--hr=path.json] [--verbose]`
    );
    return;
  }

  dotenv.config({ path: options.envFile, quiet: true });

  const [{ runStaffBackfill }, dbModule] = await Promise.all([
    import("../src/lib/staff-backfill"),
    import("../src/lib/db"),
  ]);

  try {
    const report = await runStaffBackfill({
      mode: options.mode,
      sheetPath: options.sheetPath,
      hrPath: options.hrPath,
    });
    printReport(report, options.verbose);
    if (!report.ok) process.exitCode = 1;
  } finally {
    await dbModule.default.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
