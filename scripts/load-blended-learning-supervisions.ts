/**
 * Last updated: 2026-11-12. Operator-run, re-runnable — if the schema or app
 * has moved on since this date, review/update it before running.
 *
 * Starts (or ends) Blended Learning Supervisions: a team-lead Mentor views,
 * read-only, another Mentor's Students this academic year. Runbook:
 * .mex/patterns/load-blended-learning-supervisions.md
 *
 * Usage:
 *   npm run blended:load-supervisions -- --pair=<supervisor email>:<mentor email> --by=<your email>
 *   npm run blended:load-supervisions -- --pair=... --pair=... --by=... --reason="..." --apply
 *   npm run blended:load-supervisions -- --pair=... --by=... --end --apply
 *   npm run blended:load-supervisions -- --pair=... --by=... --env-file=.env.production
 */

import * as dotenv from "dotenv";
import type {
  SupervisionLoadAction,
  SupervisionLoadMode,
  SupervisionPair,
} from "../src/lib/blended-learning-supervisions-load";

interface CliOptions {
  mode: SupervisionLoadMode;
  action: SupervisionLoadAction;
  pairs: string[];
  by: string;
  reason: string | null;
  envFile: string;
  help: boolean;
}

const VALUE_FLAGS: Record<string, (options: CliOptions, value: string) => void> = {
  "--pair=": (options, value) => options.pairs.push(value),
  "--by=": (options, value) => (options.by = value),
  "--reason=": (options, value) => (options.reason = value),
  "--env=": (options, value) => (options.envFile = `.env.${value}`),
  "--env-file=": (options, value) => (options.envFile = value),
};

const SWITCHES: Record<string, (options: CliOptions) => void> = {
  "--help": (options) => (options.help = true),
  "-h": (options) => (options.help = true),
  "--apply": (options) => (options.mode = "apply"),
  "--end": (options) => (options.action = "end"),
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "dry-run",
    action: "start",
    pairs: [],
    by: "",
    reason: null,
    envFile: ".env.local",
    help: false,
  };
  for (const arg of argv) {
    const flag = Object.keys(VALUE_FLAGS).find((prefix) => arg.startsWith(prefix));
    if (flag) VALUE_FLAGS[flag](options, arg.slice(flag.length));
    else if (SWITCHES[arg]) SWITCHES[arg](options);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage(): void {
  console.log(`Usage:
  npm run blended:load-supervisions -- --pair=<supervisor email>:<mentor email> --by=<your email>
  npm run blended:load-supervisions -- --pair=... [--pair=...] --by=... [--reason="..."] --apply
  npm run blended:load-supervisions -- --pair=... --by=... --end [--apply]
  npm run blended:load-supervisions -- ... --env=production | --env-file=.env.production

Defaults to a dry run on a read-only connection. --apply writes every pair in one
transaction, and nothing when any pair is blocked (not a live Blended Learning
Mentor, no user id, or the same person twice). Re-running is a no-op ("unchanged").
--end ends the running Supervisions of the given pairs instead of starting them.
Supervisions are for the current academic year.`);
}

// Operator script, run by hand: no unit coverage, so CRAP reads it as untested.
// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  dotenv.config({ path: options.envFile, quiet: true });
  // A dry run can't write, whatever the code below does.
  if (options.mode === "dry-run") process.env.PGOPTIONS = "-c default_transaction_read_only=on";

  const [{ parseSupervisionPair, runSupervisionsLoad, formatSupervisionsLoadReport }, dbModule] = await Promise.all([
    import("../src/lib/blended-learning-supervisions-load"),
    import("../src/lib/db"),
  ]);

  try {
    const pairs: SupervisionPair[] = options.pairs.map(parseSupervisionPair);
    const report = await runSupervisionsLoad({ ...options, pairs });
    for (const line of formatSupervisionsLoadReport(report)) console.log(line);
    if (report.blocked) process.exitCode = 1;
  } finally {
    await dbModule.default.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
