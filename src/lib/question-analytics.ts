// BigQuery reads for question-level analytics: the chapter-test report today,
// Teacher View v2 (#324) next. Server-only (BigQuery client).
import { CURRENT_ACADEMIC_YEAR, PROGRAM_ID_TO_LABEL } from "@/lib/constants";
import {
  DIM_STUDENT_TABLE,
  FACT_QUESTION_LEVEL_TABLE,
  FACT_TABLE,
  SUBMITTED_ONLY,
  getBigQueryClient,
} from "@/lib/bigquery";
import { combineCohorts } from "@/lib/question-aggregates";
import type {
  ChapterTestMeta,
  ChapterTestReportData,
  GenderStat,
  QuestionStat,
  SchoolComparisonRow,
} from "@/types/question-analytics";

const DIM_TEST_TABLE = "`avantifellows.production_dbt_final.dim_test`";
const DIM_CHAPTER_TABLE = "`avantifellows.production_dbt_final.dim_chapter`";
const DIM_TOPIC_TABLE = "`avantifellows.production_dbt_final.dim_topic`";
const BRIDGE_QUESTION_TOPIC_TABLE = "`avantifellows.production_dbt_final.bridge_question_topic`";

// The question-level fact is range-partitioned on hashed_session_id, computed by
// the quiz ETL as below. Filtering on it reads one partition (~10 MB) instead of
// the whole table (~2.4 GB) — clustering on session_id alone does not prune.
const SESSION_PARTITION = "hashed_session_id = MOD(ABS(FARM_FINGERPRINT(@sessionId)), 4000) + 1";

// The report counts only students in the test's own stream (a JEE test's
// engineering students) whenever the test has one, so "X appeared", the averages,
// the gender split and the per-question numbers all describe one group. Same rule
// as the chapter-test card (getBatchOverviewData).
const IN_TEST_STREAM = "AND (test_stream IS NULL OR student_stream = test_stream)";

/** One test session at one School, narrowed like every Performance read. */
export interface SessionScope {
  udise: string;
  grade: number;
  sessionId: string;
  program?: string;
  stream?: string;
}

function scopeFilters(scope: SessionScope) {
  const params: Record<string, string | number> = {
    udise: scope.udise,
    grade: scope.grade,
    sessionId: scope.sessionId,
  };
  if (scope.program) params.program = scope.program;
  if (scope.stream) params.stream = scope.stream;
  const sql = `
      student_school_udise_code = @udise
      AND student_grade = @grade
      AND session_id = @sessionId
      AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
      ${SUBMITTED_ONLY}
      ${IN_TEST_STREAM}
      ${scope.program ? "AND student_program = @program" : ""}
      ${scope.stream ? "AND LOWER(student_stream) = @stream" : ""}`;
  return { sql, params };
}

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const toNumOrNull = (v: unknown): number | null => (v == null ? null : toNum(v));
const round1 = (v: unknown): number => Math.round(toNum(v) * 10) / 10;

/** Per-question responses for one session, with each new-CMS question's topics. */
export async function getSessionQuestionStats(scope: SessionScope): Promise<QuestionStat[]> {
  const { sql: where, params } = scopeFilters(scope);
  const query = `
    WITH responses AS (
      SELECT
        question_id,
        ANY_VALUE(question_source) AS question_source,
        ANY_VALUE(question_source_id) AS question_source_id,
        MIN(SAFE_CAST(question_position_index AS INT64)) AS position,
        LOWER(ANY_VALUE(difficulty)) AS difficulty,
        ANY_VALUE(section) AS subject,
        COUNT(*) AS responses,
        COUNTIF(is_answered = TRUE) AS attempted,
        COUNTIF(is_correct = 1) AS correct,
        COUNTIF(is_answered = FALSE) AS skipped,
        AVG(SAFE_CAST(time_spent AS FLOAT64)) AS avg_time_seconds
      FROM ${FACT_QUESTION_LEVEL_TABLE}
      WHERE ${SESSION_PARTITION}
        AND question_id IS NOT NULL
        AND ${where}
      GROUP BY question_id
    ),
    topics AS (
      SELECT b.fk_question_id, ARRAY_AGG(t.topic_name ORDER BY b.is_primary DESC, t.topic_name) AS topics
      FROM ${BRIDGE_QUESTION_TOPIC_TABLE} b
      JOIN ${DIM_TOPIC_TABLE} t ON t.pk_topic_id = b.fk_topic_id
      WHERE b.fk_question_id IN (
        SELECT SAFE_CAST(question_source_id AS INT64) FROM responses WHERE question_source = 'nex-gen-cms'
      )
      GROUP BY b.fk_question_id
    )
    SELECT r.*, IFNULL(t.topics, []) AS topics
    FROM responses r
    LEFT JOIN topics t
      ON r.question_source = 'nex-gen-cms'
      AND t.fk_question_id = SAFE_CAST(r.question_source_id AS INT64)
    ORDER BY r.position
  `;
  const [rows] = await getBigQueryClient().query({ query, params });
  return (rows as Record<string, unknown>[]).map((r) => {
    const attempted = toNum(r.attempted);
    const correct = toNum(r.correct);
    const cmsId =
      r.question_source === "nex-gen-cms" ? Number.parseInt(String(r.question_source_id), 10) : NaN;
    return {
      question_id: String(r.question_id),
      cms_question_id: Number.isFinite(cmsId) ? cmsId : null,
      position: toNumOrNull(r.position),
      difficulty: (r.difficulty as string | null) || null,
      subject: (r.subject as string | null) ?? null,
      topics: (r.topics as string[] | null) ?? [],
      responses: toNum(r.responses),
      attempted,
      correct,
      incorrect: attempted - correct,
      skipped: toNum(r.skipped),
      avg_time_seconds: r.avg_time_seconds == null ? null : Math.round(toNum(r.avg_time_seconds)),
    };
  });
}

interface SessionSummary {
  meta: Omit<ChapterTestMeta, "chapter_code" | "chapter_name" | "priority" | "duration_minutes">;
  testStream: string | null;
  /** The School's program for this session (the one picked, or the only one). */
  program: string | null;
  /** Unrounded, so the whole-class figures are combined before any rounding. */
  gender: GenderStat[];
  avgTimeSeconds: number | null;
}

const roundCohort = (g: GenderStat): GenderStat => ({
  ...g,
  avg_attempt_rate: round1(g.avg_attempt_rate),
  avg_accuracy: round1(g.avg_accuracy),
  avg_score: round1(g.avg_score),
});

const strOrNull = (v: unknown): string | null => (v as string | null) ?? null;

/** The session's one program, or null when its students span several. */
function onlyProgram(rows: Record<string, unknown>[]): string | null {
  const programs = new Set(rows.flatMap((r) => (r.programs as string[] | null) ?? []));
  return programs.size === 1 ? [...programs][0] : null;
}

/** The test's own fields, from any of the session's summary rows. */
function summaryMeta(row: Record<string, unknown>, sessionId: string): SessionSummary["meta"] {
  return {
    session_id: sessionId,
    test_name: String(row.test_name ?? ""),
    test_format: strOrNull(row.test_format),
    start_date: strOrNull(row.start_date),
    test_grade: toNumOrNull(row.test_grade),
    exam: strOrNull(row.test_course),
    subject: null,
    cms_test_id: strOrNull(row.cms_test_id),
    total_questions: toNumOrNull(row.total_questions),
    max_marks: toNumOrNull(row.max_marks),
  };
}

/** Overall results for one session, split by gender, plus the test's own fields. */
async function getSessionSummary(scope: SessionScope): Promise<SessionSummary | null> {
  const { sql: where, params } = scopeFilters(scope);
  const query = `
    SELECT
      LOWER(IFNULL(student_gender, '')) AS gender,
      COUNT(DISTINCT enrollment_user_id) AS students,
      AVG(attempt_rate) AS avg_attempt_rate,
      AVG(accuracy) AS avg_accuracy,
      COUNT(accuracy) AS accuracy_students,
      AVG(percentage) AS avg_score,
      ARRAY_AGG(DISTINCT student_program IGNORE NULLS) AS programs,
      SUM(total_time_spent) AS total_time_seconds,
      COUNT(total_time_spent) AS timed_students,
      ANY_VALUE(cms_test_id) AS cms_test_id,
      ANY_VALUE(test_name) AS test_name,
      ANY_VALUE(test_format) AS test_format,
      MIN(start_date) AS start_date,
      ANY_VALUE(test_grade) AS test_grade,
      ANY_VALUE(test_stream) AS test_stream,
      ANY_VALUE(test_course) AS test_course,
      MAX(total_questions) AS total_questions,
      MAX(max_marks_possible) AS max_marks
    FROM ${FACT_TABLE}
    WHERE section = 'overall' AND ${where}
    GROUP BY gender
  `;
  const [rows] = await getBigQueryClient().query({ query, params });
  const list = rows as Record<string, unknown>[];
  if (list.length === 0) return null;
  const first = list[0];
  const timed = list.reduce((n, r) => n + toNum(r.timed_students), 0);
  const totalTime = list.reduce((n, r) => n + toNum(r.total_time_seconds), 0);
  const testStream = (first.test_stream as string | null) ?? null;
  return {
    meta: summaryMeta(first, scope.sessionId),
    testStream,
    program: scope.program ?? onlyProgram(list),
    gender: list.map((r) => ({
      gender: String(r.gender),
      students: toNum(r.students),
      avg_attempt_rate: toNum(r.avg_attempt_rate),
      avg_accuracy: toNum(r.avg_accuracy),
      accuracy_students: toNum(r.accuracy_students),
      avg_score: toNum(r.avg_score),
    })),
    avgTimeSeconds: timed > 0 ? totalTime / timed : null,
  };
}

/** Students enrolled at the School and grade in the test's stream. */
async function getEnrolledInStream(
  scope: SessionScope,
  testStream: string | null,
): Promise<number | null> {
  if (!testStream) return null;
  const params: Record<string, string | number> = {
    udise: scope.udise,
    grade: scope.grade,
    testStream: testStream.toLowerCase(),
  };
  if (scope.program) params.program = scope.program;
  const query = `
    SELECT COUNT(DISTINCT enrollment_user_id) AS total
    FROM ${DIM_STUDENT_TABLE}
    WHERE student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
      AND LOWER(student_stream) = @testStream
      ${scope.program ? "AND student_program = @program" : ""}
  `;
  const [rows] = await getBigQueryClient().query({ query, params });
  return toNum((rows as Record<string, unknown>[])[0]?.total);
}

const PROGRAM_MODELS = [" CoE", " Nodal"];

/** The programs a School is compared within: CoEs with CoEs, Nodals with Nodals.
 *  Empty for any other program, which gets no comparison. */
export function comparisonPrograms(program: string | null): string[] {
  const model = PROGRAM_MODELS.find((suffix) => program?.endsWith(suffix));
  return model ? Object.values(PROGRAM_ID_TO_LABEL).filter((label) => label.endsWith(model)) : [];
}

/**
 * Schools that sat the same CMS test this year, counted the way this School's
 * row is: same grade, same stream filter, and programs of the same model (CoE or
 * Nodal) as this School's.
 */
async function getSchoolComparison(
  cmsTestId: string,
  scope: SessionScope,
  program: string | null,
): Promise<SchoolComparisonRow[]> {
  const programs = comparisonPrograms(program);
  if (programs.length === 0) return [];
  const params: Record<string, string | number | string[]> = { cmsTestId, programs, grade: scope.grade };
  if (scope.stream) params.stream = scope.stream;
  const query = `
    SELECT
      student_school AS school,
      student_school_udise_code AS udise,
      ANY_VALUE(student_program) AS program,
      COUNT(DISTINCT enrollment_user_id) AS students,
      AVG(attempt_rate) AS avg_attempt_rate,
      AVG(accuracy) AS avg_accuracy,
      AVG(percentage) AS avg_score
    FROM ${FACT_TABLE}
    WHERE cms_test_id = @cmsTestId
      AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
      AND section = 'overall'
      ${SUBMITTED_ONLY}
      ${IN_TEST_STREAM}
      AND student_program IN UNNEST(@programs)
      AND student_grade = @grade
      ${scope.stream ? "AND LOWER(student_stream) = @stream" : ""}
    GROUP BY school, udise
    ORDER BY avg_score DESC
  `;
  const [rows] = await getBigQueryClient().query({ query, params });
  return (rows as Record<string, unknown>[]).map((r) => ({
    school: String(r.school ?? ""),
    udise: String(r.udise ?? ""),
    program: (r.program as string | null) ?? null,
    students: toNum(r.students),
    avg_attempt_rate: round1(r.avg_attempt_rate),
    avg_accuracy: round1(r.avg_accuracy),
    avg_score: round1(r.avg_score),
    is_this_school: r.udise === scope.udise,
  }));
}

export interface CmsTestChapter {
  chapter_code: string | null;
  chapter_name: string | null;
  subject: string | null;
  priority_engineering: string | null;
  priority_medical: string | null;
  duration_minutes: number | null;
}

/** Chapter details for new-CMS tests, keyed by CMS test id (as a string). */
export async function getCmsTestChapters(cmsTestIds: string[]): Promise<Map<string, CmsTestChapter>> {
  const ids = Array.from(
    new Set(cmsTestIds.filter((id) => /^\d+$/.test(id)).map((id) => Number(id))),
  );
  if (ids.length === 0) return new Map();
  const query = `
    SELECT
      t.pk_test_id,
      c.chapter_code,
      c.chapter_name,
      c.subject_name,
      c.priority_engineering,
      c.priority_medical,
      t.duration_minutes
    FROM ${DIM_TEST_TABLE} t
    LEFT JOIN ${DIM_CHAPTER_TABLE} c ON c.pk_chapter_id = t.fk_chapter_id
    WHERE t.pk_test_id IN UNNEST(@ids)
  `;
  const [rows] = await getBigQueryClient().query({ query, params: { ids }, types: { ids: ["INT64"] } });
  return new Map(
    (rows as Record<string, unknown>[]).map((r) => [
      String(r.pk_test_id),
      {
        chapter_code: (r.chapter_code as string | null) ?? null,
        chapter_name: (r.chapter_name as string | null) ?? null,
        subject: (r.subject_name as string | null) ?? null,
        priority_engineering: (r.priority_engineering as string | null) ?? null,
        priority_medical: (r.priority_medical as string | null) ?? null,
        duration_minutes: toNumOrNull(r.duration_minutes),
      },
    ]),
  );
}

/** The chapter's priority for the test's stream (medical → NEET priority). */
export function priorityForStream(
  chapter: CmsTestChapter | undefined,
  testStream: string | null | undefined,
): string | null {
  if (!chapter) return null;
  return testStream?.toLowerCase() === "medical"
    ? chapter.priority_medical
    : chapter.priority_engineering;
}

/**
 * The CMS test a session at this School sat, read server-side so callers never
 * trust a test id from the browser. With `cmsQuestionId`, also checks the question
 * was in that session. Reads one partition of the question fact (~10 MB).
 */
export async function getSessionCmsTest(
  scope: SessionScope,
  cmsQuestionId?: number,
): Promise<string | null> {
  const { sql: where, params } = scopeFilters(scope);
  const query = `
    SELECT ANY_VALUE(cms_test_id) AS cms_test_id
    FROM ${FACT_QUESTION_LEVEL_TABLE}
    WHERE ${SESSION_PARTITION}
      AND question_source = 'nex-gen-cms'
      ${cmsQuestionId != null ? "AND question_source_id = @questionId" : ""}
      AND ${where}
  `;
  const [rows] = await getBigQueryClient().query({
    query,
    params: cmsQuestionId != null ? { ...params, questionId: String(cmsQuestionId) } : params,
  });
  const id = (rows as Record<string, unknown>[])[0]?.cms_test_id;
  return typeof id === "string" && /^\d+$/.test(id) ? id : null;
}

/** Everything the chapter-test report shows, or null when the session has no results. */
export async function getChapterTestReport(scope: SessionScope): Promise<ChapterTestReportData | null> {
  const [summary, questions] = await Promise.all([
    getSessionSummary(scope),
    getSessionQuestionStats(scope),
  ]);
  if (!summary) return null;

  const cmsTestId = summary.meta.cms_test_id;
  const [enrolled, comparison, chapters] = await Promise.all([
    getEnrolledInStream(scope, summary.testStream),
    cmsTestId ? getSchoolComparison(cmsTestId, scope, summary.program) : Promise.resolve([]),
    cmsTestId ? getCmsTestChapters([cmsTestId]) : Promise.resolve(new Map<string, CmsTestChapter>()),
  ]);
  const chapter = cmsTestId ? chapters.get(cmsTestId) : undefined;
  const subject = chapter?.subject ?? questions.find((q) => q.subject)?.subject ?? null;

  const overview = combineCohorts(summary.gender);
  // This School's row is the report's own cohort (same program and stream filters
  // as the overview), so it always matches the cards above it.
  const thisSchool = comparison.find((c) => c.is_this_school);
  if (thisSchool) Object.assign(thisSchool, overview);
  comparison.sort((a, b) => b.avg_score - a.avg_score);

  return {
    test: {
      ...summary.meta,
      subject,
      chapter_code: chapter?.chapter_code ?? null,
      chapter_name: chapter?.chapter_name ?? null,
      priority: priorityForStream(chapter, summary.testStream),
      duration_minutes: chapter?.duration_minutes ?? null,
    },
    overview: {
      ...overview,
      appeared: overview.students,
      enrolled,
      avg_time_minutes:
        summary.avgTimeSeconds == null ? null : Math.round(summary.avgTimeSeconds / 6) / 10,
    },
    gender: summary.gender.map(roundCohort),
    questions,
    comparison,
  };
}
