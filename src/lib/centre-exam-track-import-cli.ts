import type { CentreExamTrackImportMode } from "./centre-exam-track-import";

export interface CentreExamTrackImportCliOptions {
  mode: CentreExamTrackImportMode;
  envFile: string;
  help: boolean;
}

export function parseCentreExamTrackImportArgs(
  argv: string[]
): CentreExamTrackImportCliOptions {
  const options: CentreExamTrackImportCliOptions = {
    mode: "dry-run",
    envFile: ".env.local",
    help: false,
  };
  let sawApply = false;
  let sawDryRun = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--apply") {
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
