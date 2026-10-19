/**
 * Last updated: 2026-10-19. One-off script — if the schema or app has moved on since this
 * date, review/update it before running.
 *
 * Seed the three 2026-27 Curriculum Plans as Drafts from the "JNV Academic and Testing
 * Calendar AY 2026-27" workbook (issue #417). The workbook is not committed; pass its path.
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

import type {
  CurriculumPlanSeedMode,
  CurriculumPlanSeedStore,
} from "../src/lib/curriculum-plan-seed";

interface CliOptions {
  mode: CurriculumPlanSeedMode;
  envFile: string;
  workbookPath: string;
  adminEmail: string;
  reportFile: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "dry-run",
    envFile: ".env.local",
    workbookPath: "",
    adminEmail: "curriculum-plan-seed-script",
    reportFile: null,
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
    } else if (arg.startsWith("--env=")) {
      options.envFile = `.env.${arg.slice("--env=".length)}`;
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
    } else if (arg.startsWith("--admin-email=")) {
      options.adminEmail = arg.slice("--admin-email=".length);
    } else if (arg.startsWith("--report-file=")) {
      options.reportFile = arg.slice("--report-file=".length);
    } else if (!arg.startsWith("--") && !options.workbookPath) {
      options.workbookPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (sawApply && sawDryRun) {
    throw new Error("Use either --apply or --dry-run, not both.");
  }
  if (!options.help && !options.workbookPath) {
    throw new Error("Pass the workbook path, e.g. npm run curriculum:seed-plans -- calendar.xlsx");
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage:
  npm run curriculum:seed-plans -- <workbook.xlsx>
  npm run curriculum:seed-plans -- <workbook.xlsx> --report-file=seed-report.txt
  npm run curriculum:seed-plans -- <workbook.xlsx> --apply --admin-email=you@avantifellows.org
  npm run curriculum:seed-plans -- <workbook.xlsx> --env=staging
  npm run curriculum:seed-plans -- <workbook.xlsx> --env-file=.env.local

Defaults to dry-run. Writes require the explicit --apply flag. --apply creates the three
2026-27 plans as Drafts with no assignments and refuses if any of them already exists.`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  dotenv.config({ path: options.envFile, quiet: true });

  const [seedModule, plansModule, rulesModule, dbModule] = await Promise.all([
    import("../src/lib/curriculum-plan-seed"),
    import("../src/lib/curriculum-plans"),
    import("../src/lib/curriculum-plan-rules"),
    import("../src/lib/db"),
  ]);

  // Writes go through the Curriculum Plans module's create + Chapter date paths, so the seed
  // gets the same validation as the plan editor.
  const store: CurriculumPlanSeedStore = {
    async loadChapters(grade) {
      const chapters = await plansModule.listEffectiveChaptersForGrade(
        grade,
        rulesModule.CONTENT_EXAM_TRACKS
      );
      return chapters.map(({ chapterId, chapterCode, chapterName, subjectName }) => ({
        chapterId,
        chapterCode,
        chapterName,
        subjectName,
      }));
    },
    async existingPlanTitles(academicYear, grade) {
      const listed = await plansModule.listCurriculumPlans({ academicYear, grade });
      if (!listed.ok) throw new Error(`${listed.error}: ${listed.details.join("; ")}`);
      return listed.plans.map((plan) => plan.title);
    },
    async createDraftPlan(draft) {
      const created = await plansModule.createCurriculumPlan({
        adminEmail: options.adminEmail,
        body: {
          title: draft.title,
          exam_tracks: draft.examTracks,
          academic_year: draft.academicYear,
          grade: draft.grade,
          closure_date: draft.closureDate,
        },
      });
      if (!created.ok) {
        const details = "errors" in created ? created.errors.map((e) => e.message) : created.details;
        throw new Error(`Could not create "${draft.title}": ${created.error}: ${details.join("; ")}`);
      }
      if (draft.chapters.length === 0) return { id: created.plan.id };

      const saved = await plansModule.saveCurriculumPlanChapterDates({
        id: created.plan.id,
        adminEmail: options.adminEmail,
        body: {
          chapters: draft.chapters.map((chapter) => ({
            chapter_id: chapter.chapterId,
            due_date: chapter.dueDate,
            test_date: chapter.testDate,
          })),
        },
      });
      if (!saved.ok) {
        const details =
          "errors" in saved
            ? saved.errors.map((e) => `${e.chapterName ?? e.chapterId ?? e.field}: ${e.message}`)
            : "details" in saved
              ? saved.details
              : [];
        throw new Error(
          `Created Draft "${draft.title}" (id ${created.plan.id}) but its Chapter dates were rejected — delete the Draft and fix before re-running: ${saved.error}: ${details.join("; ")}`
        );
      }
      for (const warning of saved.warnings) {
        console.log(`Warning (${draft.title}): ${warning.chapterName}: ${warning.message}`);
      }
      return { id: created.plan.id };
    },
  };

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(options.workbookPath);
    const result = await seedModule.runCurriculumPlanSeed({ workbook, mode: options.mode, store });

    console.log(`Curriculum Plan seed (${result.mode})\n`);
    console.log(result.reportText);
    if (options.reportFile) {
      await writeFile(options.reportFile, result.reportText);
      console.log(`Report written to ${options.reportFile}`);
    }
    for (const plan of result.created) {
      console.log(`Created Draft plan "${plan.title}" (id ${plan.id})`);
    }
    if (!result.ok) {
      console.error(result.error);
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
