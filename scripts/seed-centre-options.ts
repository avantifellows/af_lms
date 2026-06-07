/**
 * Seed fixed Centre option sets and seed-managed Centre options.
 *
 * Usage:
 *   npm run centres:seed-options
 *   npm run centres:seed-options -- --apply
 *   npm run centres:seed-options -- --env=staging
 *   npm run centres:seed-options -- --env-file=.env.local
 */

import * as dotenv from "dotenv";
import type {
  CentreOptionSeedMode,
  CentreOptionSeedReport,
} from "../src/lib/centre-option-seed";

interface CliOptions {
  mode: CentreOptionSeedMode;
  envFile: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "dry-run",
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
  npm run centres:seed-options
  npm run centres:seed-options -- --dry-run
  npm run centres:seed-options -- --apply
  npm run centres:seed-options -- --env=staging
  npm run centres:seed-options -- --env-file=.env.local

Defaults to dry-run. Writes require the explicit --apply flag.`);
}

function printReport(report: CentreOptionSeedReport): void {
  console.log(`Centre option seed (${report.mode})`);

  if (!report.ok) {
    console.error(report.error);
    for (const detail of report.details ?? []) {
      console.error(`- ${detail}`);
    }
    return;
  }

  console.log(
    `Option sets: created ${report.counts.optionSets.created}, updated ${report.counts.optionSets.updated}, unchanged ${report.counts.optionSets.unchanged}, skipped ${report.counts.optionSets.skipped}`
  );
  console.log(
    `Options: created ${report.counts.options.created}, updated ${report.counts.options.updated}, unchanged ${report.counts.options.unchanged}, skipped ${report.counts.options.skipped}`
  );

  printChanges("Option sets to create", report.changes.optionSets.created);
  printChanges("Option sets to update", report.changes.optionSets.updated);
  printChanges("Options to create", report.changes.options.created);
  printChanges("Options to update", report.changes.options.updated);
  printChanges("Options skipped", report.changes.options.skipped);
}

function printChanges(
  label: string,
  changes: Array<{ code: string; label: string; optionSetCode?: string; reason: string }>
): void {
  if (changes.length === 0) return;

  console.log(label);
  for (const change of changes) {
    const prefix = change.optionSetCode
      ? `${change.optionSetCode}.${change.code}`
      : change.code;
    console.log(`- ${prefix}: ${change.label} (${change.reason})`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  dotenv.config({ path: options.envFile, quiet: true });

  const [{ runCentreOptionSeed }, dbModule] = await Promise.all([
    import("../src/lib/centre-option-seed"),
    import("../src/lib/db"),
  ]);

  try {
    const report = await runCentreOptionSeed({ mode: options.mode });
    printReport(report);
    if (!report.ok) {
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
