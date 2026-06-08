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
  { table: "lms_curriculum_logs", column: "log_date" },
  { table: "lms_curriculum_logs", column: "duration_minutes" },
  { table: "lms_curriculum_logs", column: "deleted_at" },
  { table: "lms_curriculum_log_topics", column: "curriculum_log_id" },
  { table: "lms_curriculum_log_topics", column: "topic_id" },
  { table: "topic_curriculum", column: "topic_id" },
  { table: "topic_curriculum", column: "curriculum_id" },
  { table: "lms_curriculum_chapter_completions", column: "school_code" },
  { table: "lms_curriculum_chapter_completions", column: "program_id" },
  { table: "lms_curriculum_chapter_completions", column: "chapter_id" },
  { table: "lms_curriculum_chapter_completions", column: "exam_track" },
  { table: "lms_curriculum_chapter_completions", column: "deleted_at" },
];

const CONFIG_MANAGEMENT_REQUIRED_COLUMNS: Array<{
  table: string;
  column: string;
}> = [
  ...REQUIRED_COLUMNS,
  { table: "lms_chapter_exam_configs", column: "id" },
  { table: "lms_chapter_exam_configs", column: "inserted_by_email" },
  { table: "lms_chapter_exam_configs", column: "updated_by_email" },
  { table: "lms_chapter_exam_configs", column: "inserted_at" },
  { table: "lms_chapter_exam_configs", column: "updated_at" },
];

let cachedStatus: Promise<CurriculumSchemaStatus> | null = null;
let cachedConfigManagementStatus: Promise<CurriculumSchemaStatus> | null = null;

interface MissingColumnRow {
  table_name: string;
  column_name: string;
}

interface MissingRequirementRow {
  detail: string;
}

async function loadCurriculumSchemaStatus(
  requiredColumns: Array<{ table: string; column: string }>,
  options: { requireConfigUniqueIndex?: boolean } = {}
): Promise<CurriculumSchemaStatus> {
  const values = requiredColumns.map(
    (_column, index) => `($${index * 2 + 1}, $${index * 2 + 2})`
  ).join(", ");
  const params = requiredColumns.flatMap(({ table, column }) => [table, column]);

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

  const details = missing.map((row) => `${row.table_name}.${row.column_name}`);

  if (missing.length === 0 && options.requireConfigUniqueIndex) {
    const missingRequirements = await query<MissingRequirementRow>(
      `SELECT 'lms_chapter_exam_configs.chapter_id_exam_track_unique' AS detail
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_index idx
         JOIN pg_class tbl ON tbl.oid = idx.indrelid
         JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
         WHERE ns.nspname = 'public'
           AND tbl.relname = 'lms_chapter_exam_configs'
           AND idx.indisunique = true
           AND idx.indpred IS NULL
           AND (
             SELECT array_agg(att.attname::text ORDER BY keys.ordinality)
             FROM unnest(idx.indkey) WITH ORDINALITY AS keys(attnum, ordinality)
             JOIN pg_attribute att
               ON att.attrelid = tbl.oid
              AND att.attnum = keys.attnum
             WHERE keys.ordinality <= idx.indnkeyatts
           ) = ARRAY['chapter_id', 'exam_track']::text[]
       )`,
      []
    );
    details.push(...missingRequirements.map((row) => row.detail));
  }

  if (details.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 503,
    error: "LMS curriculum schema unavailable",
    details,
  };
}

export function checkCurriculumSchema(): Promise<CurriculumSchemaStatus> {
  cachedStatus ??= loadCurriculumSchemaStatus(REQUIRED_COLUMNS).then(
    (status) => {
      if (!status.ok) {
        cachedStatus = null;
      }
      return status;
    },
    (error) => {
      cachedStatus = null;
      throw error;
    }
  );
  return cachedStatus;
}

export function checkCurriculumConfigManagementSchema(): Promise<CurriculumSchemaStatus> {
  cachedConfigManagementStatus ??= loadCurriculumSchemaStatus(
    CONFIG_MANAGEMENT_REQUIRED_COLUMNS,
    { requireConfigUniqueIndex: true }
  ).then(
    (status) => {
      if (!status.ok) {
        cachedConfigManagementStatus = null;
      }
      return status;
    },
    (error) => {
      cachedConfigManagementStatus = null;
      throw error;
    }
  );
  return cachedConfigManagementStatus;
}

export function resetCurriculumSchemaCheckForTests() {
  cachedStatus = null;
  cachedConfigManagementStatus = null;
}
