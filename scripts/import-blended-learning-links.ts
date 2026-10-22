/**
 * Last updated: 2026-10-22. Operator-run, re-runnable — if the schema or app
 * has moved on since this date, review/update it before running.
 *
 * Loads Blended Learning Student Links (Profile Doc, Screener Link) from the
 * "AY 26-27 - G12 + G13 - Profile Dashboard" workbook (.xlsx). Runbook:
 * .mex/patterns/load-blended-learning-links.md
 *
 * Usage:
 *   npm run blended:import-links -- --file=/path/to/profile-dashboard.xlsx
 *   npm run blended:import-links -- --file=/path/to/profile-dashboard.xlsx --apply
 *   npm run blended:import-links -- --file=... --seed-legacy
 *   npm run blended:import-links -- --file=... --env=staging
 *   npm run blended:import-links -- --file=... --env-file=.env.local
 */

import * as dotenv from "dotenv";
import ExcelJS from "exceljs";
import type { BlendedLinksImportMode } from "../src/lib/blended-learning-links-import";

interface CliOptions {
  mode: BlendedLinksImportMode;
  file: string | null;
  seedLegacy: boolean;
  envFile: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "dry-run",
    file: null,
    seedLegacy: false,
    envFile: ".env.local",
    help: false,
  };
  let sawApply = false;
  let sawDryRun = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--apply") {
      options.mode = "apply";
      sawApply = true;
    } else if (arg === "--dry-run") {
      options.mode = "dry-run";
      sawDryRun = true;
    } else if (arg === "--seed-legacy") {
      options.seedLegacy = true;
    } else if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else if (arg.startsWith("--env=")) {
      options.envFile = `.env.${arg.slice("--env=".length)}`;
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (sawApply && sawDryRun) {
    throw new Error("Use either --apply or --dry-run, not both.");
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage:
  npm run blended:import-links -- --file=/path/to/profile-dashboard.xlsx
  npm run blended:import-links -- --file=... --apply
  npm run blended:import-links -- --file=... --seed-legacy
  npm run blended:import-links -- --file=... --env=staging
  npm run blended:import-links -- --file=... --env-file=.env.local

Defaults to dry-run. Writes require the explicit --apply flag.
--seed-legacy also sets legacy_last_contact_month from the Conversation tab's
monthly call counts (placeholder pending Poojita); without it that column is untouched.`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (!options.file) {
    printUsage();
    throw new Error("--file=<workbook.xlsx> is required.");
  }

  dotenv.config({ path: options.envFile, quiet: true });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.file);

  const [{ runBlendedLinksImport, formatBlendedLinksImportReport }, dbModule] =
    await Promise.all([
      import("../src/lib/blended-learning-links-import"),
      import("../src/lib/db"),
    ]);

  try {
    const report = await runBlendedLinksImport({
      workbook,
      mode: options.mode,
      seedLegacy: options.seedLegacy,
    });
    for (const line of formatBlendedLinksImportReport(report)) {
      console.log(line);
    }
    if (report.unreadTabs.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await dbModule.default.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
