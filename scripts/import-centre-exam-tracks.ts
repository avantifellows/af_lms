/**
 * One-time Centre Exam Track mapping import. Production activation is gated on
 * the reviewed local mapping file passing dry-run with no blockers.
 *
 * Usage:
 *   npm run centres:import-exam-tracks
 *   npm run centres:import-exam-tracks -- --apply
 *   npm run centres:import-exam-tracks -- --file=path/to/reviewed.csv
 *   npm run centres:import-exam-tracks -- --env=staging
 *   npm run centres:import-exam-tracks -- --env-file=.env.local
 */

import * as dotenv from "dotenv";

import { parseCentreExamTrackImportArgs } from "../src/lib/centre-exam-track-import-cli";

function printUsage(): void {
  console.log(`Usage:
  npm run centres:import-exam-tracks
  npm run centres:import-exam-tracks -- --dry-run
  npm run centres:import-exam-tracks -- --apply
  npm run centres:import-exam-tracks -- --file=path/to/reviewed.csv
  npm run centres:import-exam-tracks -- --env=staging
  npm run centres:import-exam-tracks -- --env-file=.env.local

Defaults to dry-run. Apply refuses all writes when any blocker is reported.`);
}

async function main(): Promise<void> {
  const options = parseCentreExamTrackImportArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  dotenv.config({ path: options.envFile, quiet: true });
  const [{ runCentreExamTrackImport }, dbModule] = await Promise.all([
    import("../src/lib/centre-exam-track-import"),
    import("../src/lib/db"),
  ]);

  try {
    const report = await runCentreExamTrackImport({
      mode: options.mode,
      sourcePath: options.sourcePath,
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await dbModule.default.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
