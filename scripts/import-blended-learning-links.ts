// fallow-ignore-file code-duplication
/**
 * Last updated: 2026-10-23. Operator-run, re-runnable — if the schema or app
 * has moved on since this date, review/update it before running.
 *
 * Loads Blended Learning Student Links (Profile Doc, Screener Link) from the
 * "AY 26-27 - G12 + G13 - Profile Dashboard" workbook (.xlsx). Runbook:
 * .mex/patterns/load-blended-learning-links.md
 *
 * Usage:
 *   npm run blended:import-links -- --file=/path/to/profile-dashboard.xlsx
 *   npm run blended:import-links -- --file=/path/to/profile-dashboard.xlsx --apply
 *   npm run blended:import-links -- --file=... --legacy-docs-dir=/path/to/profile-doc-html
 *   npm run blended:import-links -- --file=... --env=staging
 *   npm run blended:import-links -- --file=... --env-file=.env.local
 */

import * as dotenv from "dotenv";
import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";
import type { BlendedLinksImportMode, LegacyProfileDocs } from "../src/lib/blended-learning-links-import";

interface CliOptions {
  mode: BlendedLinksImportMode;
  file: string | null;
  legacyDocsDir: string | null;
  envFile: string;
  help: boolean;
}

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "dry-run",
    file: null,
    legacyDocsDir: null,
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
    } else if (arg.startsWith("--legacy-docs-dir=")) {
      options.legacyDocsDir = arg.slice("--legacy-docs-dir=".length);
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
  npm run blended:import-links -- --file=... --legacy-docs-dir=/path/to/profile-doc-html
  npm run blended:import-links -- --file=... --env=staging
  npm run blended:import-links -- --file=... --env-file=.env.local

Defaults to dry-run. Writes require the explicit --apply flag.
--legacy-docs-dir also sets legacy_last_contact_on: the latest dated conversation
in each Student's Profile Doc, read from <dir>/<Drive file id>.html (the doc's
HTML export). A doc read with no dated conversation gives NULL; a doc with no
export keeps the stored value, so re-run once more docs are shared. Dates after
today (IST) are ignored. Without the flag that column is untouched.`);
}

// Profile Doc HTML exports in a directory, named <Drive file id>.html.
function profileDocsFrom(dir: string, window: LegacyProfileDocs["window"]): LegacyProfileDocs {
  if (!fs.statSync(dir).isDirectory()) throw new Error(`Not a directory: ${dir}`);
  return {
    readProfileDocHtml: (docId) => {
      const file = path.join(dir, `${docId}.html`);
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    },
    window,
  };
}

// fallow-ignore-next-line complexity
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

  const [{ runBlendedLinksImport, formatBlendedLinksImportReport, legacyDateWindow }, dbModule, { getTodayIST }] =
    await Promise.all([
      import("../src/lib/blended-learning-links-import"),
      import("../src/lib/db"),
      import("../src/lib/curriculum-date-helpers"),
    ]);

  try {
    const legacyProfileDocs = options.legacyDocsDir
      ? profileDocsFrom(options.legacyDocsDir, legacyDateWindow(getTodayIST()))
      : null;
    const report = await runBlendedLinksImport({
      workbook,
      mode: options.mode,
      legacyProfileDocs,
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
