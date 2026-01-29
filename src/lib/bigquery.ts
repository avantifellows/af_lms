import { BigQuery } from "@google-cloud/bigquery";

let bigQueryClient: BigQuery | null = null;

export function getBigQueryClient(): BigQuery {
  if (!bigQueryClient) {
    // Option 1: Service account JSON string (for Vercel/Amplify deployment)
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
