import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { query } from "@/lib/db";
import type {
  TestDeepDiveData,
  TestDeepDiveSummary,
  SubjectAnalysisRow,
  ChapterAnalysisRow,
  StudentDeepDiveRow,
  StudentSubjectScore,
  StudentChapterScore,
} from "@/types/quiz";

let docClient: DynamoDBDocumentClient | null = null;

const TABLE_NAME = "student_quiz_reports";

function getDynamoClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const client = new DynamoDBClient({
      endpoint: process.env.DYNAMODB_URL,
      region: process.env.DYNAMODB_REGION || "ap-south-1",
      credentials: {
        accessKeyId: process.env.DYNAMODB_ACCESS_KEY || "",
        secretAccessKey: process.env.DYNAMODB_SECRET_KEY || "",
      },
    });
    docClient = DynamoDBDocumentClient.from(client);
  }
  return docClient;
}

// --- Postgres: get student identifiers for a school + grade ---

interface StudentIdentifiers {
  user_id: string;
  student_id: string | null;
  apaar_id: string | null;
  first_name: string;
  last_name: string | null;
  gender: string | null;
}

async function getSchoolStudentIdentifiers(
  schoolId: string,
  grade: number
): Promise<StudentIdentifiers[]> {
  return query<StudentIdentifiers>(
    `SELECT DISTINCT
      u.id as user_id,
      s.student_id,
      s.apaar_id,
      u.first_name,
      u.last_name,
      u.gender
    FROM group_user gu
    JOIN "group" g ON gu.group_id = g.id
    JOIN "user" u ON gu.user_id = u.id
    LEFT JOIN student s ON s.user_id = u.id
    LEFT JOIN enrollment_record er_grade ON er_grade.user_id = u.id
      AND er_grade.group_type = 'grade'
      AND er_grade.is_current = true
    LEFT JOIN grade gr ON er_grade.group_id = gr.id
    WHERE g.type = 'school' AND g.child_id = $1
      AND gr.number = $2`,
    [schoolId, grade]
  );
}

// --- DynamoDB: query reports for a single student ---

interface DynamoReportItem {
  session_id: string;
  "user_id-section": string;
  user_id: string;
  section: string;
  marks_scored: number;
  max_marks_possible: number;
  percentage: number;
  accuracy: number;
  total_questions: number;
  num_correct: number;
  num_wrong: number;
  num_skipped: number;
  test_name: string;
  start_date: string;
  test_format?: string;
  percentile?: number;
  rank?: string;
  chapter_wise_data?: Array<{
    chapter_name: string;
    section: string;
    marks_scored: number;
    max_score: number;
    accuracy: number;
    attempt_percentage: number;
    total_questions: number;
  }>;
}

async function queryDynamoForStudent(
  sessionId: string,
  identifier: string
): Promise<DynamoReportItem[]> {
  if (!identifier) return [];
  const client = getDynamoClient();
  try {
    const result = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression:
          "session_id = :sid AND begins_with(#sk, :prefix)",
        ExpressionAttributeNames: { "#sk": "user_id-section" },
        ExpressionAttributeValues: {
          ":sid": sessionId,
          ":prefix": `${identifier}#`,
        },
      })
    );
    return (result.Items || []) as DynamoReportItem[];
  } catch (error) {
    console.error(`DynamoDB query failed for student ${identifier}, session ${sessionId}:`, error);
    return [];
  }
}

async function getStudentReports(
  sessionId: string,
  student: StudentIdentifiers
): Promise<{ student: StudentIdentifiers; items: DynamoReportItem[] } | null> {
  // Try all 3 identifiers in parallel, take the first that returns results
  const ids = [
    student.student_id,
    student.apaar_id,
    student.user_id,
  ].filter((id): id is string => !!id);

  // Deduplicate
  const uniqueIds = [...new Set(ids)];

  const results = await Promise.all(
    uniqueIds.map((id) => queryDynamoForStudent(sessionId, id))
  );

  for (const items of results) {
    if (items.length > 0) {
      return { student, items };
    }
  }
  return null;
}

// --- Main function: replaces BigQuery test deep dive ---

export async function getTestDeepDiveFromDynamo(
  schoolId: string,
  grade: number,
  sessionId: string
): Promise<TestDeepDiveData | null> {
  // Step 1: Get student identifiers from Postgres
  const students = await getSchoolStudentIdentifiers(schoolId, grade);
  if (students.length === 0) return null;

  // Step 2: Query DynamoDB for each student in parallel
  const reportResults = await Promise.all(
    students.map((s) => getStudentReports(sessionId, s))
  );

  const matched = reportResults.filter(
    (r): r is NonNullable<typeof r> => r !== null
  );
  if (matched.length === 0) return null;

  // Step 3: Transform into TestDeepDiveData
  const studentRows: StudentDeepDiveRow[] = [];
  const subjectAggMap = new Map<
    string,
    { totalPct: number; totalAcc: number; totalAttempt: number; totalQ: number; count: number }
  >();
  const chapterAggMap = new Map<
    string,
    { subject: string; chapter_name: string; totalScore: number; totalAcc: number; totalAttempt: number; totalQ: number; count: number }
  >();

  let testName = "";
  let startDate = "";

  for (const { student, items } of matched) {
    const overallItem = items.find((i) => i.section.toLowerCase() === "overall");
    if (!overallItem) continue;

    if (!testName) {
      testName = overallItem.test_name || "";
      startDate = overallItem.start_date || "";
    }

    const subjectItems = items.filter(
      (i) => i.section.toLowerCase() !== "overall"
    );

    const subjectScores: StudentSubjectScore[] = subjectItems.map((si) => {
      // Aggregate for subject analysis
      const existing = subjectAggMap.get(si.section) || {
        totalPct: 0, totalAcc: 0, totalAttempt: 0, totalQ: 0, count: 0,
      };
      existing.totalPct += si.percentage || 0;
      existing.totalAcc += si.accuracy || 0;
      // attempt_rate isn't directly on the item; compute from num_skipped/total_questions
      const attemptRate =
        si.total_questions > 0
          ? ((si.total_questions - (si.num_skipped || 0)) / si.total_questions) * 100
          : 0;
      existing.totalAttempt += attemptRate;
      existing.totalQ = Math.max(existing.totalQ, si.total_questions || 0);
      existing.count += 1;
      subjectAggMap.set(si.section, existing);

      // Build chapter scores for this subject
      const chapters: StudentChapterScore[] = (si.chapter_wise_data || [])
        .filter((c) => c.section === si.section)
        .map((c) => {
          // Aggregate for chapter analysis
          const chKey = `${c.section}||${c.chapter_name}`;
          const chEx = chapterAggMap.get(chKey) || {
            subject: c.section,
            chapter_name: c.chapter_name,
            totalScore: 0, totalAcc: 0, totalAttempt: 0, totalQ: 0, count: 0,
          };
          const chPct = c.max_score > 0 ? (c.marks_scored / c.max_score) * 100 : 0;
          chEx.totalScore += chPct;
          chEx.totalAcc += c.accuracy || 0;
          chEx.totalAttempt += c.attempt_percentage || 0;
          chEx.totalQ = Math.max(chEx.totalQ, c.total_questions || 0);
          chEx.count += 1;
          chapterAggMap.set(chKey, chEx);

          return {
            subject: c.section,
            chapter_name: c.chapter_name,
            marks_scored: c.marks_scored,
            max_marks: c.max_score,
            accuracy: c.accuracy || 0,
            attempt_rate: c.attempt_percentage || 0,
            total_questions: c.total_questions || 0,
          };
        });

      return {
        subject: si.section,
        percentage: si.percentage || 0,
        marks_scored: si.marks_scored || 0,
        max_marks: si.max_marks_possible || 0,
        accuracy: si.accuracy || 0,
        attempt_rate: attemptRate,
        chapters,
      };
    });

    const studentName = [student.first_name, student.last_name]
      .filter(Boolean)
      .join(" ");

    const overallAttemptRate =
      overallItem.total_questions > 0
        ? ((overallItem.total_questions - (overallItem.num_skipped || 0)) /
            overallItem.total_questions) *
          100
        : 0;

    studentRows.push({
      student_name: studentName,
      gender: student.gender,
      marks_scored: overallItem.marks_scored || 0,
      max_marks: overallItem.max_marks_possible || 0,
      percentage: overallItem.percentage || 0,
      accuracy: overallItem.accuracy || 0,
      attempt_rate: overallAttemptRate,
      subject_scores: subjectScores,
    });
  }

  if (studentRows.length === 0) return null;

  // Compute summary
  const percentages = studentRows.map((s) => s.percentage);
  const accuracies = studentRows.map((s) => s.accuracy);
  const attemptRates = studentRows.map((s) => s.attempt_rate);

  const avg = (arr: number[]) =>
    arr.length > 0
      ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
      : 0;

  const summary: TestDeepDiveSummary = {
    test_name: testName,
    start_date: startDate,
    students_appeared: studentRows.length,
    avg_score: avg(percentages),
    min_score: Math.round(Math.min(...percentages) * 10) / 10,
    max_score: Math.round(Math.max(...percentages) * 10) / 10,
    avg_accuracy: avg(accuracies),
    avg_attempt_rate: avg(attemptRates),
  };

  // Build subject analysis
  const subjects: SubjectAnalysisRow[] = Array.from(subjectAggMap.entries())
    .map(([subject, agg]) => ({
      subject,
      avg_score: Math.round((agg.totalPct / agg.count) * 10) / 10,
      avg_accuracy: Math.round((agg.totalAcc / agg.count) * 10) / 10,
      avg_attempt_rate: Math.round((agg.totalAttempt / agg.count) * 10) / 10,
      total_questions: agg.totalQ,
    }))
    .sort((a, b) => a.avg_score - b.avg_score);

  // Build chapter analysis
  const chapters: ChapterAnalysisRow[] = Array.from(chapterAggMap.values())
    .map((agg) => ({
      subject: agg.subject,
      chapter_name: agg.chapter_name,
      avg_score: Math.round((agg.totalScore / agg.count) * 10) / 10,
      accuracy: Math.round((agg.totalAcc / agg.count) * 10) / 10,
      attempt_rate: Math.round((agg.totalAttempt / agg.count) * 10) / 10,
      questions: agg.totalQ,
      avg_time: null,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.avg_score - b.avg_score);

  return {
    summary,
    subjects,
    chapters,
    students: studentRows.sort((a, b) => b.percentage - a.percentage),
  };
}
