/**
 * Seed dummy LMS Curriculum data for summary-page testing.
 *
 * Usage:
 *   npm run curriculum:seed-dummy
 *   npm run curriculum:seed-dummy -- --cleanup
 *   npm run curriculum:seed-dummy -- --env=staging
 *   npm run curriculum:seed-dummy -- --dry-run
 *
 * The script only removes rows previously created by this script's actor email.
 */

import { Pool, type PoolClient } from "pg";
import * as dotenv from "dotenv";

type ExamTrack = "jee_main" | "jee_advanced" | "neet";
type Mode = "seed" | "cleanup";

interface CliOptions {
  mode: Mode;
  dryRun: boolean;
  reset: boolean;
  env: string;
  envFile: string;
  allowProduction: boolean;
}

interface SeedCase {
  schoolCode: string;
  programId: number;
  grade: 11 | 12;
  subjectName: "Maths" | "Physics" | "Chemistry" | "Biology";
  examTrack: ExamTrack;
  chapterLimit: number;
  logChapterCount: number;
  completionCount: number;
  durationMultiplier: number;
}

interface ChapterSeedRow {
  chapter_id: string | number;
  chapter_code: string | null;
  grade_id: string | number;
  subject_id: string | number;
  prescribed_minutes: string | number;
  topic_ids: Array<string | number>;
}

interface CleanupCounts {
  logs: number;
  logTopics: number;
  completions: number;
}

const ACTOR_EMAIL = "curriculum-dummy-seed@avantifellows.org";
const BASE_LOG_DATE = new Date("2026-05-05T00:00:00.000Z");

const SEED_CASES: SeedCase[] = [
  {
    schoolCode: "64037",
    programId: 1,
    grade: 11,
    subjectName: "Maths",
    examTrack: "jee_main",
    chapterLimit: 8,
    logChapterCount: 4,
    completionCount: 3,
    durationMultiplier: 0.45,
  },
  {
    schoolCode: "64037",
    programId: 1,
    grade: 11,
    subjectName: "Physics",
    examTrack: "jee_advanced",
    chapterLimit: 8,
    logChapterCount: 5,
    completionCount: 6,
    durationMultiplier: 1.8,
  },
  {
    schoolCode: "59525",
    programId: 1,
    grade: 11,
    subjectName: "Biology",
    examTrack: "neet",
    chapterLimit: 9,
    logChapterCount: 5,
    completionCount: 5,
    durationMultiplier: 0.9,
  },
  {
    schoolCode: "59525",
    programId: 2,
    grade: 12,
    subjectName: "Chemistry",
    examTrack: "neet",
    chapterLimit: 7,
    logChapterCount: 3,
    completionCount: 2,
    durationMultiplier: 0.35,
  },
  {
    schoolCode: "14042",
    programId: 2,
    grade: 12,
    subjectName: "Maths",
    examTrack: "jee_main",
    chapterLimit: 7,
    logChapterCount: 6,
    completionCount: 6,
    durationMultiplier: 1.15,
  },
  {
    schoolCode: "14042",
    programId: 2,
    grade: 12,
    subjectName: "Physics",
    examTrack: "jee_advanced",
    chapterLimit: 6,
    logChapterCount: 2,
    completionCount: 1,
    durationMultiplier: 0.25,
  },
];

const EXAM_TRACK_CURRICULUM_IDS: Record<SeedCase["examTrack"], number> = {
  jee_main: 1,
  jee_advanced: 9,
  neet: 2,
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "seed",
    dryRun: false,
    reset: true,
    env: "local",
    envFile: ".env.local",
    allowProduction: false,
  };

  for (const arg of argv) {
    if (arg === "--cleanup") options.mode = "cleanup";
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-reset") options.reset = false;
    else if (arg === "--allow-production") options.allowProduction = true;
    else if (arg.startsWith("--env=")) {
      options.env = arg.slice("--env=".length);
      options.envFile = `.env.${options.env}`;
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
      options.env = options.envFile.replace(/^\.env\.?/, "") || "custom";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function createPool(options: CliOptions): Pool {
  dotenv.config({ path: options.envFile, quiet: true });

  const envName = options.env.toLowerCase();
  const databaseName = process.env.DATABASE_NAME ?? "";
  const host = process.env.DATABASE_HOST ?? "";
  const looksProduction =
    envName === "production" ||
    envName === "prod" ||
    options.envFile.includes("production") ||
    options.envFile.includes("prod") ||
    databaseName.toLowerCase().includes("prod") ||
    host.toLowerCase().includes("prod");

  if (looksProduction && !options.allowProduction) {
    throw new Error(
      "Refusing to seed production-like DB. Re-run with --allow-production only if this is intentional."
    );
  }

  return new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || "5432", 10),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl:
      process.env.DATABASE_SSL === "false"
        ? false
        : { rejectUnauthorized: false },
  });
}

function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

async function cleanupSeedData(
  client: PoolClient,
  dryRun: boolean
): Promise<CleanupCounts> {
  const logIds = (
    await client.query<{ id: string | number }>(
      `SELECT id
       FROM lms_curriculum_logs
       WHERE created_by_email = $1
          OR inserted_by_email = $1
          OR updated_by_email = $1`,
      [ACTOR_EMAIL]
    )
  ).rows.map((row) => toNumber(row.id));

  const logTopicCount = logIds.length
    ? Number(
        (
          await client.query<{ count: string }>(
            `SELECT COUNT(*)::int AS count
             FROM lms_curriculum_log_topics
             WHERE curriculum_log_id = ANY($1::bigint[])`,
            [logIds]
          )
        ).rows[0]?.count ?? 0
      )
    : 0;

  const completionCount = Number(
    (
      await client.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count
         FROM lms_curriculum_chapter_completions
         WHERE completed_by_email = $1
            OR inserted_by_email = $1
            OR updated_by_email = $1`,
        [ACTOR_EMAIL]
      )
    ).rows[0]?.count ?? 0
  );

  if (!dryRun) {
    if (logIds.length > 0) {
      await client.query(
        `DELETE FROM lms_curriculum_logs
         WHERE id = ANY($1::bigint[])`,
        [logIds]
      );
    }

    await client.query(
      `DELETE FROM lms_curriculum_chapter_completions
       WHERE completed_by_email = $1
          OR inserted_by_email = $1
          OR updated_by_email = $1`,
      [ACTOR_EMAIL]
    );
  }

  return {
    logs: logIds.length,
    logTopics: logTopicCount,
    completions: completionCount,
  };
}

async function fetchChaptersForCase(
  client: PoolClient,
  seedCase: SeedCase
): Promise<ChapterSeedRow[]> {
  const rows = await client.query<ChapterSeedRow>(
    `SELECT
       ch.id AS chapter_id,
       ch.code AS chapter_code,
       ch.grade_id,
       ch.subject_id,
       cfg.prescribed_minutes,
       ARRAY_AGG(t.id ORDER BY t.id) FILTER (WHERE t.id IS NOT NULL) AS topic_ids
     FROM lms_chapter_exam_configs cfg
     JOIN chapter ch ON ch.id = cfg.chapter_id
     JOIN grade g ON g.id = ch.grade_id
     JOIN subject s ON s.id = ch.subject_id
     LEFT JOIN (
       topic t
       JOIN topic_curriculum tc
         ON tc.topic_id = t.id
        AND tc.curriculum_id = $5
     ) ON t.chapter_id = ch.id
     WHERE cfg.is_in_syllabus = true
       AND cfg.exam_track = $1
       AND g.number = $2
       AND COALESCE(
         (
           SELECT item->>'subject'
           FROM jsonb_array_elements(s.name::jsonb) item
           WHERE item->>'lang_code' = 'en'
           LIMIT 1
         ),
         ''
       ) = $3
     GROUP BY
       ch.id,
       ch.code,
       ch.grade_id,
       ch.subject_id,
       cfg.prescribed_minutes,
       cfg.coverage_sequence
     HAVING COUNT(t.id) > 0
     ORDER BY cfg.coverage_sequence ASC, ch.code ASC, ch.id ASC
     LIMIT $4`,
    [
      seedCase.examTrack,
      seedCase.grade,
      seedCase.subjectName,
      seedCase.chapterLimit,
      EXAM_TRACK_CURRICULUM_IDS[seedCase.examTrack],
    ]
  );

  return rows.rows;
}

async function ensureSchoolExists(
  client: PoolClient,
  schoolCode: string
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM school WHERE code = $1) AS exists`,
    [schoolCode]
  );
  return result.rows[0]?.exists === true;
}

async function insertLogForChapter(
  client: PoolClient,
  seedCase: SeedCase,
  chapter: ChapterSeedRow,
  sequence: number
): Promise<{ logId: number; topicCount: number }> {
  const prescribedMinutes = toNumber(chapter.prescribed_minutes);
  const durationMinutes = Math.min(
    720,
    Math.max(15, Math.round(prescribedMinutes * seedCase.durationMultiplier))
  );
  const topicIds = chapter.topic_ids.map(toNumber).slice(0, 2);
  const inserted = await client.query<{ id: string | number }>(
    `INSERT INTO lms_curriculum_logs (
       school_code,
       program_id,
       grade_id,
       subject_id,
       exam_track,
       log_date,
       duration_minutes,
       created_by_email,
       inserted_by_email,
       updated_by_email
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)
     RETURNING id`,
    [
      seedCase.schoolCode,
      seedCase.programId,
      toNumber(chapter.grade_id),
      toNumber(chapter.subject_id),
      seedCase.examTrack,
      addDays(BASE_LOG_DATE, sequence),
      durationMinutes,
      ACTOR_EMAIL,
    ]
  );

  const logId = toNumber(inserted.rows[0].id);

  await client.query(
    `INSERT INTO lms_curriculum_log_topics (curriculum_log_id, topic_id)
     SELECT $1::bigint, unnest($2::bigint[])`,
    [logId, topicIds]
  );

  return { logId, topicCount: topicIds.length };
}

async function markChapterComplete(
  client: PoolClient,
  seedCase: SeedCase,
  chapter: ChapterSeedRow
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO lms_curriculum_chapter_completions (
       school_code,
       program_id,
       chapter_id,
       exam_track,
       completed_by_email,
       inserted_by_email,
       updated_by_email
     )
     VALUES ($1, $2, $3, $4, $5, $5, $5)
     ON CONFLICT (school_code, program_id, chapter_id, exam_track)
       WHERE deleted_at IS NULL
       DO NOTHING`,
    [
      seedCase.schoolCode,
      seedCase.programId,
      toNumber(chapter.chapter_id),
      seedCase.examTrack,
      ACTOR_EMAIL,
    ]
  );

  return result.rowCount === 1;
}

async function seedDummyData(
  client: PoolClient,
  dryRun: boolean
): Promise<void> {
  let insertedLogs = 0;
  let insertedLogTopics = 0;
  let insertedCompletions = 0;
  let skippedCompletions = 0;

  for (const seedCase of SEED_CASES) {
    const schoolExists = await ensureSchoolExists(client, seedCase.schoolCode);
    if (!schoolExists) {
      console.log(`Skipping ${seedCase.schoolCode}: school not found`);
      continue;
    }

    const chapters = await fetchChaptersForCase(client, seedCase);
    if (chapters.length === 0) {
      console.log(
        `Skipping ${seedCase.schoolCode} ${seedCase.programId} ${seedCase.grade} ${seedCase.subjectName} ${seedCase.examTrack}: no configured chapters with topics`
      );
      continue;
    }

    console.log(
      `Seeding ${seedCase.schoolCode} program ${seedCase.programId}, grade ${seedCase.grade}, ${seedCase.subjectName}, ${seedCase.examTrack}: ${Math.min(
        seedCase.logChapterCount,
        chapters.length
      )} logs, ${Math.min(seedCase.completionCount, chapters.length)} completions`
    );

    if (dryRun) {
      insertedLogs += Math.min(seedCase.logChapterCount, chapters.length);
      insertedLogTopics += chapters
        .slice(0, seedCase.logChapterCount)
        .reduce((sum, chapter) => sum + Math.min(chapter.topic_ids.length, 2), 0);
      insertedCompletions += Math.min(seedCase.completionCount, chapters.length);
      continue;
    }

    for (const [index, chapter] of chapters
      .slice(0, seedCase.logChapterCount)
      .entries()) {
      const inserted = await insertLogForChapter(
        client,
        seedCase,
        chapter,
        insertedLogs + index
      );
      insertedLogs += 1;
      insertedLogTopics += inserted.topicCount;
    }

    for (const chapter of chapters.slice(0, seedCase.completionCount)) {
      const inserted = await markChapterComplete(client, seedCase, chapter);
      if (inserted) insertedCompletions += 1;
      else skippedCompletions += 1;
    }
  }

  console.log("\nSeed summary:");
  console.log(`  Logs: ${insertedLogs}`);
  console.log(`  Log topics: ${insertedLogTopics}`);
  console.log(`  Completions: ${insertedCompletions}`);
  console.log(`  Existing completions skipped: ${skippedCompletions}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pool = createPool(options);
  const client = await pool.connect();

  console.log(`Using env file: ${options.envFile}`);
  console.log(`Mode: ${options.mode}${options.dryRun ? " (dry run)" : ""}`);
  console.log(`Seed marker: ${ACTOR_EMAIL}\n`);

  try {
    await client.query("BEGIN");

    if (options.mode === "cleanup" || options.reset) {
      const counts = await cleanupSeedData(client, options.dryRun);
      console.log("Cleanup summary:");
      console.log(`  Logs: ${counts.logs}`);
      console.log(`  Log topics: ${counts.logTopics}`);
      console.log(`  Completions: ${counts.completions}\n`);
    }

    if (options.mode === "seed") {
      await seedDummyData(client, options.dryRun);
    }

    if (options.dryRun) {
      await client.query("ROLLBACK");
      console.log("\nDry run complete; no changes committed.");
    } else {
      await client.query("COMMIT");
      console.log("\nCommitted.");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
