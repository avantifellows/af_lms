/**
 * One-time migration: clear explicit user_permission.school_codes/regions for
 * everyone holding a centre seat, so seats become the sole source of school
 * scope (strict per-user exclusivity). See src/lib/clear-seated-scope.ts.
 *
 * Usage:
 *   npm run staff:clear-seated-scope                      # dry-run vs .env.local (staging)
 *   npm run staff:clear-seated-scope -- --apply
 *   npm run staff:clear-seated-scope -- --env-file=.env.production --apply
 *
 * Run dry-run first and read the STRANDED worklist: those people lose access to
 * uncovered schools on clear — ops must create/link the missing centres + seats
 * before (or right after) applying.
 */

import * as dotenv from "dotenv";
import type {
  ClearSeatedScopeMode,
  ClearSeatedScopeReport,
} from "../src/lib/clear-seated-scope";

interface CliOptions {
  mode: ClearSeatedScopeMode;
  envFile: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "dry-run",
    envFile: ".env.local",
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--apply") options.mode = "apply";
    else if (arg === "--dry-run") options.mode = "dry-run";
    else if (arg.startsWith("--env=")) options.envFile = `.env.${arg.slice(6)}`;
    else if (arg.startsWith("--env-file=")) options.envFile = arg.slice(11);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printReport(report: ClearSeatedScopeReport): void {
  console.log(`Clear seated school scope (${report.mode})`);
  if (!report.ok && report.error) console.error(report.error);
  console.log(
    `Seated users still carrying explicit school_codes/regions: ${report.usersWithExplicitScope}`
  );
  console.log(
    `${report.mode === "apply" ? "Cleared" : "Would clear"}: ${report.usersCleared}`
  );

  if (report.skippedWouldBeEmpty.length > 0) {
    console.log(
      `\n⏭️  SKIPPED (${report.skippedWouldBeEmpty.length}) — seated at school-less (unlinked) centres only.`
    );
    console.log(
      `   Clearing would empty their scope (lockout), so they keep their school_codes. Ops: link the centre, then re-run.`
    );
    for (const u of report.skippedWouldBeEmpty) {
      console.log(
        `   - ${u.email} (user_id=${u.userId}) keeps: ${u.schoolCodes.join(", ") || u.regions.join(", ")}`
      );
    }
  }

  if (report.strandedUsers.length > 0) {
    console.log(
      `\n⚠️  STRANDED (${report.strandedUsers.length}) — seated people whose school_codes are NOT all seat-covered.`
    );
    console.log(
      `   These schools LOSE access on clear. Ops: create/link the centres + seats for them.`
    );
    for (const u of report.strandedUsers) {
      console.log(
        `   - ${u.email} (user_id=${u.userId}) loses: ${u.uncoveredCodes.join(", ")} | ` +
          `seats cover: ${u.seatSchoolCodes.join(", ") || "(none)"}`
      );
    }
  } else {
    console.log(
      `\nNo stranded users — every seated person's school_codes are fully seat-covered.`
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      `Usage: npm run staff:clear-seated-scope -- [--apply|--dry-run] [--env-file=.env.local]`
    );
    return;
  }

  dotenv.config({ path: options.envFile, quiet: true });

  const [{ runClearSeatedScope }, dbModule] = await Promise.all([
    import("../src/lib/clear-seated-scope"),
    import("../src/lib/db"),
  ]);

  try {
    const report = await runClearSeatedScope({ mode: options.mode });
    printReport(report);
    if (!report.ok) process.exitCode = 1;
  } finally {
    await dbModule.default.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
