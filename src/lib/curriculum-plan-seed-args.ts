// Command-line options for the one-time Curriculum Plan workbook seed
// (`scripts/seed-curriculum-plans.ts`, #425). Pure, so the script can parse before loading
// env-dependent modules.

import type { CurriculumPlanSeedMode } from "./curriculum-plan-seed";

export interface CurriculumPlanSeedCliOptions {
  mode: CurriculumPlanSeedMode;
  envFile: string;
  workbookPath: string;
  adminEmail: string;
  reportFile: string | null;
  help: boolean;
}

export const CURRICULUM_PLAN_SEED_USAGE = `Usage:
  npm run curriculum:seed-plans -- <workbook.xlsx>
  npm run curriculum:seed-plans -- <workbook.xlsx> --report-file=seed-report.txt
  npm run curriculum:seed-plans -- <workbook.xlsx> --apply --admin-email=you@avantifellows.org
  npm run curriculum:seed-plans -- <workbook.xlsx> --env=staging
  npm run curriculum:seed-plans -- <workbook.xlsx> --env-file=.env.local

Defaults to dry-run. Writes require the explicit --apply flag. --apply creates the three
2026-27 plans as Drafts with no assignments, all in one transaction, and refuses if any of
them already exists.`;

type Options = CurriculumPlanSeedCliOptions;

const FLAGS: Record<string, (options: Options, modes: Set<CurriculumPlanSeedMode>) => void> = {
  "--help": (options) => {
    options.help = true;
  },
  "-h": (options) => {
    options.help = true;
  },
  "--apply": (_options, modes) => {
    modes.add("apply");
  },
  "--dry-run": (_options, modes) => {
    modes.add("dry-run");
  },
};

const VALUE_FLAGS: Array<[prefix: string, apply: (options: Options, value: string) => void]> = [
  ["--env=", (options, value) => (options.envFile = `.env.${value}`)],
  ["--env-file=", (options, value) => (options.envFile = value)],
  ["--admin-email=", (options, value) => (options.adminEmail = value)],
  ["--report-file=", (options, value) => (options.reportFile = value)],
];

function applyArg(options: Options, modes: Set<CurriculumPlanSeedMode>, arg: string): void {
  const flag = FLAGS[arg];
  if (flag) return flag(options, modes);
  const valueFlag = VALUE_FLAGS.find(([prefix]) => arg.startsWith(prefix));
  if (valueFlag) return valueFlag[1](options, arg.slice(valueFlag[0].length));
  if (arg.startsWith("--") || options.workbookPath) throw new Error(`Unknown argument: ${arg}`);
  options.workbookPath = arg;
}

export function parseCurriculumPlanSeedArgs(argv: string[]): CurriculumPlanSeedCliOptions {
  const options: Options = {
    mode: "dry-run",
    envFile: ".env.local",
    workbookPath: "",
    adminEmail: "curriculum-plan-seed-script",
    reportFile: null,
    help: false,
  };
  const modes = new Set<CurriculumPlanSeedMode>();
  for (const arg of argv) applyArg(options, modes, arg);

  if (modes.size > 1) throw new Error("Use either --apply or --dry-run, not both.");
  if (!options.help && !options.workbookPath) {
    throw new Error("Pass the workbook path, e.g. npm run curriculum:seed-plans -- calendar.xlsx");
  }
  return { ...options, mode: modes.has("apply") ? "apply" : "dry-run" };
}
