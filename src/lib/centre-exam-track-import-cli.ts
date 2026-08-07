import type { CentreExamTrackImportMode } from "./centre-exam-track-import";

export interface CentreExamTrackImportCliOptions {
  mode: CentreExamTrackImportMode;
  envFile: string;
  help: boolean;
  sourcePath?: string;
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

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
    } else if (arg === "--file") {
      const sourcePath = argv[index + 1];
      if (!sourcePath || sourcePath.startsWith("--")) {
        throw new Error("--file requires a path.");
      }
      options.sourcePath = sourcePath;
      index += 1;
    } else if (arg.startsWith("--file=")) {
      const sourcePath = arg.slice("--file=".length);
      if (!sourcePath) throw new Error("--file requires a path.");
      options.sourcePath = sourcePath;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (sawApply && sawDryRun) {
    throw new Error("Use either --apply or --dry-run, not both.");
  }
  return options;
}
