import { query } from "./db";

export interface CurriculumSchemaReady {
  ok: true;
}

export interface CurriculumSchemaUnavailable {
  ok: false;
  status: 503;
  error: string;
  details: string[];
}

export type CurriculumSchemaStatus =
  | CurriculumSchemaReady
  | CurriculumSchemaUnavailable;

const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "lms_chapter_exam_configs", column: "chapter_id" },
  { table: "lms_chapter_exam_configs", column: "exam_track" },
  { table: "lms_chapter_exam_configs", column: "is_in_syllabus" },
  { table: "lms_chapter_exam_configs", column: "prescribed_minutes" },
  { table: "lms_chapter_exam_configs", column: "coverage_sequence" },
  { table: "lms_curriculum_logs", column: "school_code" },
  { table: "lms_curriculum_logs", column: "program_id" },
  { table: "lms_curriculum_logs", column: "grade_id" },
  { table: "lms_curriculum_logs", column: "subject_id" },
  { table: "lms_curriculum_logs", column: "exam_track" },
  { table: "lms_curriculum_logs", column: "duration_minutes" },
  { table: "lms_curriculum_log_topics", column: "curriculum_log_id" },
  { table: "lms_curriculum_log_topics", column: "topic_id" },
  { table: "lms_curriculum_chapter_completions", column: "school_code" },
  { table: "lms_curriculum_chapter_completions", column: "program_id" },
  { table: "lms_curriculum_chapter_completions", column: "chapter_id" },
  { table: "lms_curriculum_chapter_completions", column: "exam_track" },
  { table: "lms_curriculum_chapter_completions", column: "deleted_at" },
];

let cachedStatus: Promise<CurriculumSchemaStatus> | null = null;

interface MissingColumnRow {
  table_name: string;
  column_name: string;
}

async function loadCurriculumSchemaStatus(): Promise<CurriculumSchemaStatus> {
  const values = REQUIRED_COLUMNS.map(
    (_column, index) => `($${index * 2 + 1}, $${index * 2 + 2})`
  ).join(", ");
  const params = REQUIRED_COLUMNS.flatMap(({ table, column }) => [table, column]);

  const missing = await query<MissingColumnRow>(
    `WITH required(table_name, column_name) AS (VALUES ${values})
     SELECT required.table_name, required.column_name
     FROM required
     LEFT JOIN information_schema.columns cols
       ON cols.table_schema = 'public'
      AND cols.table_name = required.table_name
      AND cols.column_name = required.column_name
     WHERE cols.column_name IS NULL
     ORDER BY required.table_name, required.column_name`,
    params
  );

  if (missing.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 503,
    error: "LMS curriculum schema unavailable",
    details: missing.map((row) => `${row.table_name}.${row.column_name}`),
  };
}

export function checkCurriculumSchema(): Promise<CurriculumSchemaStatus> {
  cachedStatus ??= loadCurriculumSchemaStatus();
  return cachedStatus;
}

export function resetCurriculumSchemaCheckForTests() {
  cachedStatus = null;
}
