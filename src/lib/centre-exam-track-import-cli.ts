import { parseArgs } from "node:util";

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
  let values: ReturnType<typeof parseArgs>["values"];
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        apply: { type: "boolean" },
        "dry-run": { type: "boolean" },
        env: { type: "string" },
        "env-file": { type: "string" },
        file: { type: "string" },
      },
      strict: true,
    }));
  } catch (error) {
    if (argv.at(-1) === "--file" || argv.includes("--file=")) {
      throw new Error("--file requires a path.");
    }
    throw error;
  }

  if (values.apply && values["dry-run"]) {
    throw new Error("Use either --apply or --dry-run, not both.");
  }

  return {
    mode: values.apply ? "apply" : "dry-run",
    envFile:
      (values["env-file"] as string | undefined) ??
      (values.env ? `.env.${values.env}` : ".env.local"),
    help: values.help === true,
    sourcePath: values.file as string | undefined,
  };
}
