import { BigQuery } from "@google-cloud/bigquery";
import type { TestTrendPoint } from "@/types/quiz";
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
}

/**
 * Fetch test list + enrollment count for the Batch Overview.
 */
export async function getBatchOverviewData(
  udise: string,
  grade: number,
  program?: string
): Promise<BatchOverviewRaw> {
  const client = getBigQueryClient();
  const programFilter = program ? `AND student_program = @program` : "";
  const params: Record<string, string | number> = { udise, grade };
  if (program) params.program = program;

  const testListQuery = `
    SELECT
      session_id,
      test_name,
      MIN(start_date) AS start_date,
      COUNT(DISTINCT fk_student_id) AS student_count,
      COUNT(DISTINCT CASE WHEN student_stream = test_stream THEN fk_student_id END) AS stream_student_count,
      MAX(test_format) AS test_format,
      MAX(test_stream) AS test_stream
    FROM ${FACT_TABLE}
    WHERE student_school_udise_code = @udise
      AND student_grade = @grade
      AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
      AND LOWER(section) = 'overall'
      AND session_id IS NOT NULL
      ${programFilter}
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
    GROUP BY student_stream
  `;

  try {
    const [testRows, enrolledRows] = await Promise.all([
      client.query({ query: testListQuery, params }),
      client.query({ query: enrolledQuery, params }),
    ]);

    const streamRows = enrolledRows[0] as { stream: string; total: number }[];
    const enrolledByStream: Record<string, number> = {};
    let totalEnrolled = 0;
    for (const row of streamRows) {
      enrolledByStream[row.stream] = row.total;
      totalEnrolled += row.total;
    }

    return {
      tests: testRows[0] as TestTrendPoint[],
      totalEnrolled: totalEnrolled || null,
      enrolledByStream,
    };
  } catch (error) {
    console.error("Failed to fetch batch overview data:", error);
    return { tests: [], totalEnrolled: null, enrolledByStream: {} };
  }
}
