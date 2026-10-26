/**
 * Last updated: 2026-10-19. One-off script — if the schema or app has moved on since this
 * date, review/update it before running.
 *
 * Seed the three 2026-27 Curriculum Plans as Drafts from the "JNV Academic and Testing
 * Calendar AY 2026-27" workbook (issue #417). The workbook is not committed; pass its path.
 * `--apply` creates all three plans in one transaction, or none.
 *
 * Usage:
 *   npm run curriculum:seed-plans -- <workbook.xlsx>
 *   npm run curriculum:seed-plans -- <workbook.xlsx> --report-file=seed-report.txt
 *   npm run curriculum:seed-plans -- <workbook.xlsx> --apply --admin-email=you@avantifellows.org
 *   npm run curriculum:seed-plans -- <workbook.xlsx> --env=staging
 *   npm run curriculum:seed-plans -- <workbook.xlsx> --env-file=.env.local
 */

import { writeFile } from "fs/promises";

import * as dotenv from "dotenv";
import ExcelJS from "exceljs";

import type { CurriculumPlanSeedResult } from "../src/lib/curriculum-plan-seed";
import {
  CURRICULUM_PLAN_SEED_USAGE,
  parseCurriculumPlanSeedArgs,
  type CurriculumPlanSeedCliOptions,
} from "../src/lib/curriculum-plan-seed-args";

async function printResult(result: CurriculumPlanSeedResult, reportFile: string | null): Promise<void> {
  console.log(`Curriculum Plan seed (${result.mode})\n`);
  console.log(result.reportText);
  if (reportFile) {
    await writeFile(reportFile, result.reportText);
    console.log(`Report written to ${reportFile}`);
  }
  for (const plan of result.created) {
    console.log(`Created Draft plan "${plan.title}" (id ${plan.id})`);
  }
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
  }
}

async function seed(options: CurriculumPlanSeedCliOptions): Promise<void> {
  dotenv.config({ path: options.envFile, quiet: true });

  const [seedModule, storeModule, dbModule] = await Promise.all([
    import("../src/lib/curriculum-plan-seed"),
    import("../src/lib/curriculum-plan-seed-store"),
    import("../src/lib/db"),
  ]);
  const store = storeModule.curriculumPlanSeedStore({
    adminEmail: options.adminEmail,
    onWarning: (message) => console.log(message),
  });

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(options.workbookPath);
    const result = await seedModule.runCurriculumPlanSeed({ workbook, mode: options.mode, store });
    await printResult(result, options.reportFile);
  } finally {
    await dbModule.default.end();
  }
}

async function main(): Promise<void> {
  const options = parseCurriculumPlanSeedArgs(process.argv.slice(2));
  if (options.help) {
    console.log(CURRICULUM_PLAN_SEED_USAGE);
    return;
  }
  await seed(options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
