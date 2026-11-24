/**
 * Last updated: 2026-10-27. Operator-run, re-runnable — if the Profile Doc
 * parsing or the links importer has moved on since this date, review/update
 * it before running.
 *
 * Exports each Profile Doc's latest dated conversation (the entry that
 * legacy_last_contact_on dates) as plain text, for the external step that
 * summarises it into the links importer's --legacy-conversations file.
 * Runbook: .mex/patterns/load-blended-learning-links.md
 *
 * Usage:
 *   npm run blended:export-latest-entries -- --legacy-docs-dir=/path/to/profile-doc-html --out=/private/path/entries.json
 *
 * Reads <dir>/<Drive file id>.html and writes
 * { "<Drive file id>": { "occurredOn": "YYYY-MM-DD", "text": "..." } } to --out
 * with mode 0600. The file holds minors' records: keep it outside the repo and
 * delete it once the summaries are imported. Prints counts only. No database.
 */

import * as fs from "fs";
import * as path from "path";

interface CliOptions {
  legacyDocsDir: string | null;
  out: string | null;
  help: boolean;
}

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { legacyDocsDir: null, out: null, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--legacy-docs-dir=")) {
      options.legacyDocsDir = arg.slice("--legacy-docs-dir=".length);
    } else if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log(`Usage:
  npm run blended:export-latest-entries -- --legacy-docs-dir=/path/to/profile-doc-html --out=/private/path/entries.json

Writes each Profile Doc's latest dated conversation (the same entry the links
importer's --legacy-docs-dir dates) as { "<Drive file id>": { "occurredOn", "text" } }
to --out, created with mode 0600. Docs with no dated conversation are left out.
Prints counts only, never content.`);
}

// Owner read/write only, even when the file already existed.
function writePrivateJson(file: string, value: unknown): void {
  const fd = fs.openSync(file, "w", 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (!options.legacyDocsDir || !options.out) {
    printUsage();
    throw new Error("--legacy-docs-dir=<dir> and --out=<file.json> are required.");
  }
  const dir = options.legacyDocsDir;
  if (!fs.statSync(dir).isDirectory()) throw new Error(`Not a directory: ${dir}`);

  const [{ exportLatestProfileDocEntries, formatProfileDocExportReport, profileDocExportIds }, { legacyDateWindow }, { getTodayIST }] =
    await Promise.all([
      import("../src/lib/blended-learning-profile-doc-export"),
      import("../src/lib/blended-learning-profile-doc-dates"),
      import("../src/lib/curriculum-date-helpers"),
    ]);

  const { docIds, skippedFiles } = profileDocExportIds(fs.readdirSync(dir));
  const { entries, counts } = exportLatestProfileDocEntries(
    docIds,
    (docId) => fs.readFileSync(path.join(dir, `${docId}.html`), "utf8"),
    legacyDateWindow(getTodayIST())
  );
  writePrivateJson(options.out, entries);
  for (const line of formatProfileDocExportReport({ ...counts, skippedFiles })) console.log(line);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
