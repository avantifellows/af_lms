import { BigQuery } from "@google-cloud/bigquery";
import type {
  TestTrendPoint,
  SubjectTrendPoint,
  SubjectAnalysisRow,
  ChapterAnalysisRow,
  StudentDeepDiveRow,
  StudentSubjectScore,
} from "@/types/quiz";

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

export interface QuizSessionRow {
  session_id: string;
  test_name: string;
  start_date: string;
  student_count: number;
}

/**
 * Get quiz sessions that have actual results for students at a school.
 * This queries BigQuery to find sessions where students from this UDISE took quizzes.
 */
export async function getSchoolQuizSessions(udise: string): Promise<QuizSessionRow[]> {
  try {
    const client = getBigQueryClient();

    const query = `
      SELECT
        session_id,
        test_name,
        MIN(start_date) as start_date,
        COUNT(DISTINCT student_full_name) as student_count
      FROM \`avantifellows.production_dbt_final.fact_student_test_results_overall\`
      WHERE student_school_udise_code = @udise
        AND academic_year = '2025-2026'
        AND LOWER(section) = 'overall'
        AND session_id IS NOT NULL
      GROUP BY session_id, test_name
      ORDER BY start_date DESC
      LIMIT 50
    `;

    const [rows] = await client.query({
      query,
      params: { udise },
    });

    return rows as QuizSessionRow[];
  } catch (error) {
    console.error("Failed to fetch quiz sessions from BigQuery:", error);
    return [];
  }
}

export interface QuizResultRow {
  quiz_id: string;
  student_full_name: string;
  student_school_udise_code: string;
  attendance_status: string;
  total_marks_obtained: number | null;
  total_marks: number | null;
  percentage_score: number | null;
}

export interface SubjectResultRow {
  quiz_id: string;
  student_full_name: string;
  subject_name: string;
  subject_marks_obtained: number | null;
  subject_total_marks: number | null;
}

export async function getQuizResults(
  quizId: string,
  udise: string
): Promise<QuizResultRow[]> {
  try {
    const client = getBigQueryClient();

    // Use fact_student_test_results_overall with session_id column
    // Note: No attendance_status column - students with results are "Present"
    const query = `
      SELECT DISTINCT
        session_id AS quiz_id,
        student_full_name,
        student_school_udise_code,
        'Present' AS attendance_status,
        marks_scored AS total_marks_obtained,
        max_marks_possible AS total_marks,
        percentage AS percentage_score
      FROM \`avantifellows.production_dbt_final.fact_student_test_results_overall\`
      WHERE session_id = @quizId
        AND student_school_udise_code = @udise
        AND academic_year = '2025-2026'
        AND LOWER(section) = 'overall'
    `;

    const [rows] = await client.query({
      query,
      params: { quizId, udise },
    });

    return rows as QuizResultRow[];
  } catch (error) {
    console.error("Failed to fetch quiz results from BigQuery:", error);
    return [];
  }
}

export async function getQuizSubjectResults(
  quizId: string,
  udise: string
): Promise<SubjectResultRow[]> {
  const client = getBigQueryClient();

  // Try to get subject-wise data from fact_student_test_results_overall
  // section = subject name, marks_scored/max_marks_possible = section scores
  try {
    const query = `
      SELECT
        session_id AS quiz_id,
        student_full_name,
        section AS subject_name,
        marks_scored AS subject_marks_obtained,
        max_marks_possible AS subject_total_marks
      FROM \`avantifellows.production_dbt_final.fact_student_test_results_overall\`
      WHERE session_id = @quizId
        AND student_school_udise_code = @udise
        AND academic_year = '2025-2026'
        AND section IS NOT NULL
        AND LOWER(section) != 'overall'
    `;

    const [rows] = await client.query({
      query,
      params: { quizId, udise },
    });

    return rows as SubjectResultRow[];
  } catch (error) {
    console.log("Subject results query failed, returning empty array:", error);
    return [];
  }
}

// --- New functions for Performance tab rebuild ---

const FACT_TABLE = "`avantifellows.production_dbt_final.fact_student_test_results_overall`";
const CHAPTER_TABLE = "`avantifellows.production_dbt_final.fact_student_test_results_chapter_level`";
const DIM_STUDENT_TABLE = "`avantifellows.production_dbt_final.dim_student`";

/**
 * Get distinct grades that have quiz data for a school.
 */
export async function getAvailableGrades(udise: string): Promise<number[]> {
  try {
    const client = getBigQueryClient();
    const query = `
      SELECT DISTINCT student_grade
      FROM ${FACT_TABLE}
      WHERE student_school_udise_code = @udise
        AND academic_year = '2025-2026'
        AND LOWER(section) = 'overall'
        AND student_grade IS NOT NULL
      ORDER BY student_grade
    `;
    const [rows] = await client.query({ query, params: { udise } });
    return rows.map((r: { student_grade: number }) => r.student_grade);
  } catch (error) {
    console.error("Failed to fetch available grades:", error);
    return [];
  }
}

interface BatchOverviewRaw {
  tests: TestTrendPoint[];
  subjectTrend: SubjectTrendPoint[];
  totalEnrolled: number | null;
}

/**
 * Fetch all data needed for the Batch Overview view.
 * Runs 3 queries in parallel.
 */
export async function getBatchOverviewData(
  udise: string,
  grade: number
): Promise<BatchOverviewRaw> {
  const client = getBigQueryClient();

  const testTrendQuery = `
    SELECT
      session_id,
      test_name,
      MIN(start_date) AS start_date,
      COUNT(DISTINCT fk_student_id) AS student_count,
      ROUND(AVG(percentage), 1) AS avg_percentage,
      ROUND(AVG(CASE WHEN LOWER(student_gender) = 'male' THEN percentage END), 1) AS male_avg_percentage,
      ROUND(AVG(CASE WHEN LOWER(student_gender) = 'female' THEN percentage END), 1) AS female_avg_percentage
    FROM ${FACT_TABLE}
    WHERE student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '2025-2026'
      AND LOWER(section) = 'overall'
      AND session_id IS NOT NULL
    GROUP BY session_id, test_name
    ORDER BY start_date ASC
  `;

  const subjectTrendQuery = `
    WITH recent_tests AS (
      SELECT DISTINCT session_id, test_name, MIN(start_date) AS start_date
      FROM ${FACT_TABLE}
      WHERE student_school_udise_code = @udise
        AND student_grade = @grade
        AND academic_year = '2025-2026'
        AND LOWER(section) = 'overall'
        AND session_id IS NOT NULL
      GROUP BY session_id, test_name
      ORDER BY start_date DESC
      LIMIT 5
    )
    SELECT
      f.session_id,
      rt.test_name,
      f.section AS subject,
      ROUND(AVG(f.percentage), 1) AS avg_percentage
    FROM ${FACT_TABLE} f
    JOIN recent_tests rt ON f.session_id = rt.session_id
    WHERE f.student_school_udise_code = @udise
      AND f.student_grade = @grade
      AND f.academic_year = '2025-2026'
      AND f.section IS NOT NULL
      AND LOWER(f.section) != 'overall'
    GROUP BY f.session_id, rt.test_name, rt.start_date, f.section
    ORDER BY rt.start_date ASC, f.section
  `;

  const enrolledQuery = `
    SELECT COUNT(DISTINCT pk_student_id) AS total
    FROM ${DIM_STUDENT_TABLE}
    WHERE student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '2025-2026'
  `;

  try {
    const [testRows, subjectRows, enrolledRows] = await Promise.all([
      client.query({ query: testTrendQuery, params: { udise, grade } }),
      client.query({ query: subjectTrendQuery, params: { udise, grade } }),
      client.query({ query: enrolledQuery, params: { udise, grade } }),
    ]);

    return {
      tests: testRows[0] as TestTrendPoint[],
      subjectTrend: subjectRows[0] as SubjectTrendPoint[],
      totalEnrolled: enrolledRows[0]?.[0]?.total ?? null,
    };
  } catch (error) {
    console.error("Failed to fetch batch overview data:", error);
    return { tests: [], subjectTrend: [], totalEnrolled: null };
  }
}

interface TestDeepDiveRaw {
  overallResults: Array<{
    fk_student_id: string;
    student_full_name: string;
    student_gender: string | null;
    marks_scored: number;
    max_marks_possible: number;
    percentage: number;
    accuracy: number;
    attempt_rate: number;
    test_name: string;
    start_date: string;
  }>;
  subjectAggregates: SubjectAnalysisRow[];
  studentSubjectScores: Array<{
    fk_student_id: string;
    section: string;
    percentage: number;
    marks_scored: number;
    max_marks_possible: number;
    accuracy: number;
    attempt_rate: number;
  }>;
  chapters: ChapterAnalysisRow[];
}

/**
 * Fetch all data needed for the Test Deep Dive view.
 * Runs 4 queries in parallel.
 */
export async function getTestDeepDiveData(
  udise: string,
  grade: number,
  sessionId: string
): Promise<TestDeepDiveRaw> {
  const client = getBigQueryClient();

  const overallQuery = `
    SELECT
      fk_student_id,
      student_full_name,
      student_gender,
      marks_scored,
      max_marks_possible,
      percentage,
      COALESCE(accuracy, 0) AS accuracy,
      COALESCE(attempt_rate, 0) AS attempt_rate,
      test_name,
      start_date
    FROM ${FACT_TABLE}
    WHERE session_id = @sessionId
      AND student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '2025-2026'
      AND LOWER(section) = 'overall'
  `;

  const subjectAggQuery = `
    SELECT
      section AS subject,
      ROUND(AVG(percentage), 1) AS avg_score,
      ROUND(AVG(accuracy), 1) AS avg_accuracy,
      ROUND(AVG(attempt_rate), 1) AS avg_attempt_rate,
      MAX(total_questions) AS total_questions
    FROM ${FACT_TABLE}
    WHERE session_id = @sessionId
      AND student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '2025-2026'
      AND section IS NOT NULL
      AND LOWER(section) != 'overall'
    GROUP BY section
    ORDER BY avg_score ASC
  `;

  const studentSubjectQuery = `
    SELECT
      fk_student_id,
      section,
      percentage,
      marks_scored,
      max_marks_possible,
      COALESCE(accuracy, 0) AS accuracy,
      COALESCE(attempt_rate, 0) AS attempt_rate
    FROM ${FACT_TABLE}
    WHERE session_id = @sessionId
      AND student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '2025-2026'
      AND section IS NOT NULL
      AND LOWER(section) != 'overall'
  `;

  const chapterQuery = `
    SELECT
      section AS subject,
      chapter_name,
      ROUND(AVG(percentage), 1) AS avg_score,
      ROUND(AVG(accuracy), 1) AS accuracy,
      ROUND(AVG(attempt_percentage), 1) AS attempt_rate,
      MAX(total_questions) AS questions,
      ROUND(AVG(avg_time_per_question), 1) AS avg_time
    FROM ${CHAPTER_TABLE}
    WHERE session_id = @sessionId
      AND student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '2025-2026'
      AND chapter_name IS NOT NULL
    GROUP BY section, chapter_name
    ORDER BY section, avg_score ASC
  `;

  try {
    const [overallRows, subjectAggRows, studentSubjectRows, chapterRows] =
      await Promise.all([
        client.query({ query: overallQuery, params: { sessionId, udise, grade } }),
        client.query({ query: subjectAggQuery, params: { sessionId, udise, grade } }),
        client.query({ query: studentSubjectQuery, params: { sessionId, udise, grade } }),
        client.query({ query: chapterQuery, params: { sessionId, udise, grade } }),
      ]);

    return {
      overallResults: overallRows[0] as TestDeepDiveRaw["overallResults"],
      subjectAggregates: subjectAggRows[0] as SubjectAnalysisRow[],
      studentSubjectScores: studentSubjectRows[0] as TestDeepDiveRaw["studentSubjectScores"],
      chapters: chapterRows[0] as ChapterAnalysisRow[],
    };
  } catch (error) {
    console.error("Failed to fetch test deep dive data:", error);
    return { overallResults: [], subjectAggregates: [], studentSubjectScores: [], chapters: [] };
  }
}

/**
 * Merge per-student subject scores into StudentDeepDiveRow[].
 */
export function mergeStudentDeepDiveRows(
  raw: TestDeepDiveRaw
): StudentDeepDiveRow[] {
  const subjectMap = new Map<string, StudentSubjectScore[]>();
  for (const row of raw.studentSubjectScores) {
    const scores = subjectMap.get(row.fk_student_id) || [];
    scores.push({
      subject: row.section,
      percentage: row.percentage,
      marks_scored: row.marks_scored,
      max_marks: row.max_marks_possible,
      accuracy: row.accuracy,
      attempt_rate: row.attempt_rate,
    });
    subjectMap.set(row.fk_student_id, scores);
  }

  return raw.overallResults.map((r) => ({
    student_name: r.student_full_name,
    gender: r.student_gender,
    marks_scored: r.marks_scored,
    max_marks: r.max_marks_possible,
    percentage: r.percentage,
    accuracy: r.accuracy,
    attempt_rate: r.attempt_rate,
    subject_scores: subjectMap.get(r.fk_student_id) || [],
  }));
}
