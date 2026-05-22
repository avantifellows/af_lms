import { BigQuery } from "@google-cloud/bigquery";
import type {
  TestTrendPoint,
  CumulativeALRow,
  CumulativeALData,
  ProgressionTest,
  ProgressionEntry,
  TestQuestionLevelRow,
} from "@/types/quiz";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

let bigQueryClient: BigQuery | null = null;

export function getBigQueryClient(): BigQuery {
  if (!bigQueryClient) {
    // Option 1: Service account JSON string (for Amplify deployment)
    const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (credentialsJson) {
      try {
        const credentials = JSON.parse(credentialsJson);
        bigQueryClient = new BigQuery({
          credentials,
          projectId: credentials.project_id || "avantifellows",
        });
      } catch (parseError) {
        console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:", parseError);
        throw new Error("Invalid BigQuery credentials configuration");
      }
    }
    // Option 2: Credentials file path (for local development)
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      bigQueryClient = new BigQuery({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });
    }
    // Option 3: Default credentials (GCP environment)
    else {
      console.warn("No BigQuery credentials configured - quiz analytics will be unavailable");
      bigQueryClient = new BigQuery({
        projectId: "avantifellows",
      });
    }
  }
  return bigQueryClient;
}

// --- Performance tab functions ---

const FACT_TABLE = "`avantifellows.production_dbt_final.fact_student_test_results_overall`";
const DIM_STUDENT_TABLE = "`avantifellows.production_dbt_final.dim_student`";
const FACT_QUESTION_LEVEL_TABLE =
  "`avantifellows.production_dbt_final.fact_student_test_results_question_level`";

// Test formats that count as "major" (i.e. the Full Tests tab) — these also have
// real Academic Level (AL) values populated on the section='overall' row.
export const MAJOR_TEST_FORMATS = [
  "major_test",
  "mock_test",
  "part_test",
  "full_syllabus_test",
];

// AL values that represent meaningful achievement levels. Filters out the
// per-subject placeholder ("only for overall") that appears on non-overall rows.
const REAL_AL_VALUES = ["B1", "B2", "M1", "M2", "Not Qualified", "Not Eligible for Academic Level"];

// Canonicalize stream values to lowercase keys (Engg/engineering → engineering,
// PCM/pcm → pcm). The DB and BQ have both cased and lowercased duplicates.
export function canonicalStream(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

// Display label for a canonical stream key. Falls back to the key itself.
export function streamDisplayLabel(canonical: string): string {
  switch (canonical) {
    case "pcm":
      return "PCM";
    case "pcb":
      return "PCB";
    case "pcmb":
      return "PCMB";
    case "engineering":
      return "Engineering";
    case "medical":
      return "Medical";
    case "foundation":
      return "Foundation";
    case "clat":
      return "CLAT";
    case "ca":
      return "CA";
    default:
      return canonical.charAt(0).toUpperCase() + canonical.slice(1);
  }
}

/**
 * Get distinct programs that have quiz data for a school.
 */
export async function getAvailablePrograms(udise: string): Promise<string[]> {
  try {
    const client = getBigQueryClient();
    const query = `
      SELECT DISTINCT student_program
      FROM ${FACT_TABLE}
      WHERE student_school_udise_code = @udise
        AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
        AND LOWER(section) = 'overall'
        AND student_program IS NOT NULL
      ORDER BY student_program
    `;
    const [rows] = await client.query({ query, params: { udise } });
    return rows.map((r: { student_program: string }) => r.student_program);
  } catch (error) {
    console.error("Failed to fetch available programs:", error);
    return [];
  }
}

/**
 * Get distinct grades that have quiz data for a school + program.
 */
export async function getAvailableGrades(udise: string, program?: string): Promise<number[]> {
  try {
    const client = getBigQueryClient();
    const programFilter = program ? `AND student_program = @program` : "";
    const query = `
      SELECT DISTINCT student_grade
      FROM ${FACT_TABLE}
      WHERE student_school_udise_code = @udise
        AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
        AND LOWER(section) = 'overall'
        AND student_grade IS NOT NULL
        ${programFilter}
      ORDER BY student_grade
    `;
    const params: Record<string, string | number> = { udise };
    if (program) params.program = program;
    const [rows] = await client.query({ query, params });
    return rows.map((r: { student_grade: number }) => r.student_grade);
  } catch (error) {
    console.error("Failed to fetch available grades:", error);
    return [];
  }
}

interface BatchOverviewRaw {
  tests: TestTrendPoint[];
  totalEnrolled: number | null;
  enrolledByStream: Record<string, number>;
  streams: string[];
}

/**
 * Fetch test list + enrollment count for the Batch Overview.
 * If `stream` is provided (canonical lowercase), tests + enrollment are filtered
 * to that student stream.
 */
export async function getBatchOverviewData(
  udise: string,
  grade: number,
  program?: string,
  stream?: string
): Promise<BatchOverviewRaw> {
  const client = getBigQueryClient();
  const programFilter = program ? `AND student_program = @program` : "";
  const streamFilter = stream ? `AND LOWER(student_stream) = @stream` : "";
  const params: Record<string, string | number> = { udise, grade };
  if (program) params.program = program;
  if (stream) params.stream = stream;

  const testListQuery = `
    SELECT
      session_id,
      test_name,
      MIN(start_date) AS start_date,
      COUNT(DISTINCT fk_student_id) AS student_count,
      COUNT(DISTINCT CASE WHEN student_stream = test_stream THEN fk_student_id END) AS stream_student_count,
      MAX(test_format) AS test_format,
      MAX(test_stream) AS test_stream,
      ARRAY_AGG(DISTINCT section IGNORE NULLS) AS sections
    FROM ${FACT_TABLE}
    WHERE student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
      AND session_id IS NOT NULL
      ${programFilter}
      ${streamFilter}
    GROUP BY session_id, test_name
    ORDER BY start_date ASC
  `;

  const enrolledQuery = `
    SELECT
      COALESCE(student_stream, '') AS stream,
      COUNT(DISTINCT pk_student_id) AS total
    FROM ${DIM_STUDENT_TABLE}
    WHERE student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
      ${programFilter}
      ${streamFilter}
    GROUP BY student_stream
  `;

  try {
    const [testRows, enrolledRows] = await Promise.all([
      client.query({ query: testListQuery, params }),
      client.query({ query: enrolledQuery, params }),
    ]);

    interface RawTestRow {
      session_id: string;
      test_name: string;
      start_date: string;
      student_count: number;
      stream_student_count: number;
      test_format: string | null;
      test_stream: string | null;
      sections: string[] | null;
    }

    const tests: TestTrendPoint[] = (testRows[0] as RawTestRow[]).map((r) => {
      const subjectSections = (r.sections || []).filter(
        (s) => s && s.toLowerCase() !== "overall"
      );
      return {
        session_id: r.session_id,
        test_name: r.test_name,
        start_date: r.start_date,
        student_count: r.student_count,
        stream_student_count: r.stream_student_count,
        test_format: r.test_format,
        test_stream: r.test_stream,
        subjects: subjectSections,
      };
    });

    const streamRows = enrolledRows[0] as { stream: string; total: number }[];
    const enrolledByStream: Record<string, number> = {};
    const streamsSet = new Set<string>();
    let totalEnrolled = 0;
    for (const row of streamRows) {
      enrolledByStream[row.stream] = row.total;
      totalEnrolled += row.total;
      const c = canonicalStream(row.stream);
      if (c) streamsSet.add(c);
    }

    return {
      tests,
      totalEnrolled: totalEnrolled || null,
      enrolledByStream,
      streams: [...streamsSet].sort(),
    };
  } catch (error) {
    console.error("Failed to fetch batch overview data:", error);
    return { tests: [], totalEnrolled: null, enrolledByStream: {}, streams: [] };
  }
}

// Unified AL rank — M and B are stream-specific parallel scales.
// M1 (engineering top) and B1 (medical top) share rank 3, M2/B2 share rank 2,
// NQ rank 1, NE rank 0. Used for sorting + mode AL tie-break.
export const AL_RANK: Record<string, number> = {
  M1: 3,
  B1: 3,
  M2: 2,
  B2: 2,
  "Not Qualified": 1,
  "Not Eligible for Academic Level": 0,
};

function alRank(al: string | null | undefined): number {
  if (!al) return -1;
  return AL_RANK[al] ?? -1;
}

/**
 * Per-student AL summary + per-test AL progression across all major-test
 * formats, in chronological order. Mode AL is the AL value that appears most
 * often for the student (ties broken by tier: M1/B1 > M2/B2 > NQ > NE).
 */
export async function getCumulativeALData(
  udise: string,
  grade: number,
  program?: string,
  stream?: string
): Promise<CumulativeALData> {
  const client = getBigQueryClient();
  const programFilter = program ? `AND student_program = @program` : "";
  const streamFilter = stream ? `AND LOWER(student_stream) = @stream` : "";
  const formatList = MAJOR_TEST_FORMATS.map((f) => `'${f}'`).join(",");
  const alList = REAL_AL_VALUES.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(",");

  const params: Record<string, string | number> = { udise, grade };
  if (program) params.program = program;
  if (stream) params.stream = stream;

  // One row per (student, session) — gives us both the test list (for the
  // matrix columns) and per-student AL points.
  const sql = `
    SELECT
      fk_student_id AS student_id,
      ANY_VALUE(student_full_name) AS student_name,
      ANY_VALUE(student_stream) AS student_stream,
      session_id,
      ANY_VALUE(test_name) AS test_name,
      MIN(start_date) AS start_date,
      ANY_VALUE(test_stream) AS test_stream,
      ANY_VALUE(academic_level) AS academic_level,
      ANY_VALUE(marks_scored) AS marks_scored,
      ANY_VALUE(max_marks_possible) AS max_marks_possible
    FROM ${FACT_TABLE}
    WHERE student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
      AND LOWER(section) = 'overall'
      AND test_format IN (${formatList})
      AND academic_level IN (${alList})
      AND fk_student_id IS NOT NULL
      AND session_id IS NOT NULL
      ${programFilter}
      ${streamFilter}
    GROUP BY fk_student_id, session_id
    ORDER BY start_date ASC
  `;

  try {
    const [rows] = await client.query({ query: sql, params });
    interface AggRow {
      student_id: string;
      student_name: string | null;
      student_stream: string | null;
      session_id: string;
      test_name: string;
      start_date: string;
      test_stream: string | null;
      academic_level: string;
      marks_scored: number | string | null;
      max_marks_possible: number | string | null;
    }

    const toNumOrNull = (v: number | string | null | undefined): number | null => {
      if (v === null || v === undefined) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    // Build the chronological test list (deduped by session_id).
    const testMap = new Map<string, ProgressionTest>();
    const studentMap = new Map<
      string,
      {
        student_id: string;
        student_name: string;
        student_stream: string | null;
        al_counts: Record<string, number>;
        progression: ProgressionEntry[];
      }
    >();

    for (const r of rows as AggRow[]) {
      // BigQuery DATE returns as { value: "..." } — normalise to string.
      const startDate =
        typeof r.start_date === "string"
          ? r.start_date
          : (r.start_date as { value?: string } | null)?.value || "";

      if (!testMap.has(r.session_id)) {
        testMap.set(r.session_id, {
          session_id: r.session_id,
          test_name: r.test_name,
          start_date: startDate,
          stream: canonicalStream(r.test_stream),
        });
      }

      const existing = studentMap.get(r.student_id) || {
        student_id: r.student_id,
        student_name: r.student_name || r.student_id,
        student_stream: r.student_stream,
        al_counts: {} as Record<string, number>,
        progression: [] as ProgressionEntry[],
      };
      existing.al_counts[r.academic_level] = (existing.al_counts[r.academic_level] || 0) + 1;
      existing.progression.push({
        session_id: r.session_id,
        academic_level: r.academic_level,
        marks_scored: toNumOrNull(r.marks_scored),
        max_marks_possible: toNumOrNull(r.max_marks_possible),
      });
      if (!existing.student_name && r.student_name) existing.student_name = r.student_name;
      if (!existing.student_stream && r.student_stream) existing.student_stream = r.student_stream;
      studentMap.set(r.student_id, existing);
    }

    const tests = [...testMap.values()].sort((a, b) =>
      a.start_date.localeCompare(b.start_date)
    );
    const sessionOrder = new Map(tests.map((t, idx) => [t.session_id, idx]));

    const students: CumulativeALRow[] = [];
    for (const v of studentMap.values()) {
      let modeAl: string | null = null;
      let modeCount = 0;
      let modeRank = -1;
      let total = 0;
      for (const [al, count] of Object.entries(v.al_counts)) {
        total += count;
        const rank = alRank(al);
        if (count > modeCount || (count === modeCount && rank > modeRank)) {
          modeAl = al;
          modeCount = count;
          modeRank = rank;
        }
      }
      // Sort each student's progression by the global chronological order.
      v.progression.sort(
        (a, b) =>
          (sessionOrder.get(a.session_id) ?? 0) -
          (sessionOrder.get(b.session_id) ?? 0)
      );
      const canonical = canonicalStream(v.student_stream);
      students.push({
        student_id: v.student_id,
        student_name: v.student_name,
        stream: canonical ? streamDisplayLabel(canonical) : null,
        total_major_tests: total,
        al_counts: v.al_counts,
        mode_al: modeAl,
        progression: v.progression,
      });
    }

    // Sort students by mode AL rank desc, then by total tests desc, then name.
    students.sort((a, b) => {
      const ar = alRank(a.mode_al);
      const br = alRank(b.mode_al);
      if (ar !== br) return br - ar;
      if (a.total_major_tests !== b.total_major_tests)
        return b.total_major_tests - a.total_major_tests;
      return a.student_name.localeCompare(b.student_name);
    });

    return { students, tests };
  } catch (error) {
    console.error("Failed to fetch cumulative AL data:", error);
    return { students: [], tests: [] };
  }
}

/**
 * Per-question class-wide aggregates for a single test.
 * Groups question-level fact rows by (chapter, question_id, position_index) and
 * computes attempt rate, accuracy, and correct/wrong/skipped counts across the
 * filtered student set.
 */
export async function getTestQuestionLevelData(
  udise: string,
  grade: number,
  sessionId: string,
  program?: string,
  stream?: string
): Promise<TestQuestionLevelRow[]> {
  const client = getBigQueryClient();
  const programFilter = program ? `AND student_program = @program` : "";
  const streamFilter = stream ? `AND LOWER(student_stream) = @stream` : "";

  const params: Record<string, string | number> = { udise, grade, sessionId };
  if (program) params.program = program;
  if (stream) params.stream = stream;

  const sql = `
    SELECT
      section AS subject,
      chapter_name,
      chapter_id,
      question_id,
      ANY_VALUE(question_position_index) AS position_index,
      COUNT(*) AS total_students,
      COUNTIF(is_answered = TRUE) AS attempted,
      COUNTIF(is_correct = 1) AS correct,
      COUNTIF(is_answered = TRUE AND is_correct = 0) AS wrong,
      COUNTIF(is_answered = FALSE) AS skipped
    FROM ${FACT_QUESTION_LEVEL_TABLE}
    WHERE student_school_udise_code = @udise
      AND student_grade = @grade
      AND session_id = @sessionId
      AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
      AND question_id IS NOT NULL
      ${programFilter}
      ${streamFilter}
    GROUP BY section, chapter_name, chapter_id, question_id
    ORDER BY section, chapter_name, position_index
  `;

  interface RawRow {
    subject: string | null;
    chapter_name: string | null;
    chapter_id: string | null;
    question_id: string;
    position_index: number | string | null;
    total_students: number | string;
    attempted: number | string;
    correct: number | string;
    wrong: number | string;
    skipped: number | string;
  }

  const toInt = (v: number | string | null | undefined): number => {
    if (v == null) return 0;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  try {
    const [rows] = await client.query({ query: sql, params });
    return (rows as RawRow[]).map((r) => {
      const total = toInt(r.total_students);
      const attempted = toInt(r.attempted);
      const correct = toInt(r.correct);
      return {
        subject: r.subject || "",
        chapter_name: r.chapter_name || "",
        chapter_id: r.chapter_id || null,
        question_id: r.question_id,
        position_index:
          r.position_index == null ? null : toInt(r.position_index),
        total_students: total,
        attempted,
        correct,
        wrong: toInt(r.wrong),
        skipped: toInt(r.skipped),
        attempt_rate: total > 0 ? Math.round((attempted / total) * 100) : 0,
        accuracy:
          attempted > 0 ? Math.round((correct / attempted) * 100) : 0,
      };
    });
  } catch (error) {
    console.error("Failed to fetch question-level data:", error);
    return [];
  }
}
