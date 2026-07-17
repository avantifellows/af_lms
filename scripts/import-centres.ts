/**
 * Last updated: 2026-06-07 (579a960). One-off script — if the schema or app has
 * moved on since this date, review/update it before running.
 *
 * One-time import for centres-for-crud-ui/centres.csv.
 *
 * Usage:
 *   npm run centres:import
 *   npm run centres:import -- --apply
 *   npm run centres:import -- --env=staging
 *   npm run centres:import -- --env-file=.env.local
 */

import * as dotenv from "dotenv";
import type {
  CentreCsvImportReport,
  CentreImportMode,
} from "../src/lib/centre-import";

interface CliOptions {
  mode: CentreImportMode;
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
  npm run centres:import
  npm run centres:import -- --dry-run
  npm run centres:import -- --apply
  npm run centres:import -- --env=staging
  npm run centres:import -- --env-file=.env.local

Defaults to dry-run. Writes require the explicit --apply flag.`);
}

function printReport(report: CentreCsvImportReport): void {
  console.log(`Centre CSV import (${report.mode})`);

  if (!report.ok && report.error) {
    console.error(report.error);
  }

  console.log(`Parsed source rows: ${report.counts.parsedRows}`);
  console.log(
    `Mapping rows: ${report.counts.mappingRows} (${report.counts.mappedRows} covered)`
  );
  console.log(
    `Physical rows: ${report.counts.physicalRows}; non-physical rows: ${report.counts.nonPhysicalRows}`
  );
  console.log(`Existing Centre rows: ${report.counts.existingCentreRows}`);
  console.log(
    `School links: approved ${report.counts.approvedSchoolRows}, auto-matched ${report.counts.autoMatchedSchoolRows}, unlinked ${report.counts.unlinkedSchoolRows}`
  );
  console.log(`Rows that would be inserted: ${report.counts.rowsThatWouldBeInserted}`);

  printList("Missing mapping source ids", report.issues.missingMappingSourceIds);
  printList("Duplicate mapping source ids", report.issues.duplicateMappingSourceIds);
  printIssueRefs("Invalid mapping rows", report.issues.invalidMappingRows);
  printIssueRefs(
    "Unresolved school name matches",
    report.issues.unresolvedSchoolNameMatches
  );
  printIssueRefs(
    "Ambiguous school name matches",
    report.issues.ambiguousSchoolNameMatches
  );
  printIssueRefs("Invalid school ids", report.issues.invalidSchoolIds);
  printIssueRefs("Invalid option codes", report.issues.invalidOptionCodes);
  printList("Blockers", report.blockers);

  for (const detail of report.details ?? []) {
    console.error(`- ${detail}`);
  }
}

function printList(label: string, values: string[]): void {
  if (values.length === 0) return;
  console.log(label);
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

function printIssueRefs(
  label: string,
  issues: Array<{
    sourceId: string;
    name?: string;
    status?: string;
    field?: string;
    code?: string;
    candidates?: string;
  }>
): void {
  if (issues.length === 0) return;
  console.log(label);
  for (const issue of issues) {
    const details = [
      issue.name,
      issue.status ? `status=${issue.status}` : "",
      issue.field ? `field=${issue.field}` : "",
      issue.code ? `code=${issue.code}` : "",
      issue.candidates ? `candidates=${issue.candidates}` : "",
    ].filter(Boolean);
    console.log(`- ${issue.sourceId}: ${details.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  dotenv.config({ path: options.envFile, quiet: true });

  const [{ runCentreCsvImport }, dbModule] = await Promise.all([
    import("../src/lib/centre-import"),
    import("../src/lib/db"),
  ]);

  try {
    const report = await runCentreCsvImport({ mode: options.mode });
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
