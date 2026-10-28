// fallow-ignore-file code-duplication
/**
 * Last updated: 2026-10-28. Operator-run, re-runnable — if the schema or app
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
 *   npm run blended:import-links -- --file=... --legacy-docs-dir=... --legacy-conversations=/private/path/summaries.json
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
  legacyConversations: string | null;
  envFile: string;
  help: boolean;
}

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "dry-run",
    file: null,
    legacyDocsDir: null,
    legacyConversations: null,
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
    } else if (arg.startsWith("--legacy-conversations=")) {
      options.legacyConversations = arg.slice("--legacy-conversations=".length);
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
  if (options.legacyConversations && !options.legacyDocsDir) {
    throw new Error("--legacy-conversations needs --legacy-docs-dir: a summary is loaded only for its doc's latest date.");
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage:
  npm run blended:import-links -- --file=/path/to/profile-dashboard.xlsx
  npm run blended:import-links -- --file=... --apply
  npm run blended:import-links -- --file=... --legacy-docs-dir=/path/to/profile-doc-html
  npm run blended:import-links -- --file=... --legacy-docs-dir=... --legacy-conversations=/private/path/summaries.json
  npm run blended:import-links -- --file=... --env=staging
  npm run blended:import-links -- --file=... --env-file=.env.local

Defaults to dry-run. Writes require the explicit --apply flag.
--legacy-docs-dir also sets legacy_last_contact_on: the latest dated conversation
in each Student's Profile Doc, read from <dir>/<Drive file id>.html (the doc's
HTML export). A doc read with no dated conversation gives NULL; a doc with no
export keeps the stored value, so re-run once more docs are shared. Dates after
today (IST) are ignored. Without the flag that column is untouched.
--legacy-conversations (with --legacy-docs-dir) also sets legacy_conversation_summary
from { "<Drive file id>": { "occurredOn": "YYYY-MM-DD", "summary": "...",
"actionItems": [{ "text": "...", "owner": "student|mentor|parent" }] } }: loaded only
when occurredOn is the doc's latest date, else NULL. The entry's action items become
the Student's Profile Doc Action Items: new ones are inserted open, ones with the same
text and owner are kept (open or done), and open ones no longer listed (all of them
when the summary is NULL) are removed; done ones are never removed. Counts and
Student IDs only are printed.`);
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
async function loadLegacyProfileDocs(
  options: CliOptions,
  window: LegacyProfileDocs["window"]
): Promise<LegacyProfileDocs | null> {
  if (!options.legacyDocsDir) return null;
  const docs = profileDocsFrom(options.legacyDocsDir, window);
  if (!options.legacyConversations) return docs;
  const { parseLegacyConversations } = await import("../src/lib/blended-learning-legacy-conversations");
  return { ...docs, conversations: parseLegacyConversations(readJsonQuietly(options.legacyConversations)) };
}

// Parse errors can quote the file, which holds minors' records: say only that
// it is not JSON.
function readJsonQuietly(file: string): unknown {
  const text = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The legacy conversations file is not valid JSON.");
  }
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
    const legacyProfileDocs = await loadLegacyProfileDocs(options, legacyDateWindow(getTodayIST()));
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
