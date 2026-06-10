import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  getSchoolRoster,
  filterActiveRosterStudents,
} from "@/lib/school-students";
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

// student_quiz_reports_v2 holds one document per (session_id, user_id) and
// includes a stable chapter_id alongside chapter_name — see etl-next's
// student_reports_v2_flow.py and the chapter_level/question_level dbt models,
// which both COALESCE chapter_id from chapter_tagging.
const TABLE_NAME = "student_quiz_reports_v2";

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
  stream: string | null;
}

// Built from the canonical school roster (the same query + dedup the
// Enrollment tab renders) so the deep-dive can never show a student who
// isn't on the Enrollment tab for the same filters. In particular, the
// roster's academic-year filter excludes passed-out cohorts whose grade-12
// enrollment records are still marked current.
async function getSchoolStudentIdentifiers(
  schoolId: string,
  grade: number,
  program?: string,
  stream?: string
): Promise<StudentIdentifiers[]> {
  const { students } = await getSchoolRoster(schoolId);
  return filterActiveRosterStudents(students, { grade, program, stream }).map(
    (s) => ({
      user_id: s.user_id,
      student_id: s.student_id,
      apaar_id: s.apaar_id,
      first_name: s.first_name ?? "",
      last_name: s.last_name,
      gender: s.gender,
      stream: s.stream,
    })
  );
}

// --- DynamoDB: v2 document shape ---

interface V2OverallPerformance {
  marks_scored?: number | null;
  max_marks_possible?: number | null;
  percentage?: number | null;
  accuracy?: number | null;
  num_correct?: number | null;
  num_wrong?: number | null;
  num_skipped?: number | null;
  total_questions?: number | null;
}

interface V2SubjectPerformance {
  subject?: string;
  marks_scored?: number | null;
  max_marks_possible?: number | null;
  percentage?: number | null;
  accuracy?: number | null;
  num_correct?: number | null;
  num_wrong?: number | null;
  num_skipped?: number | null;
  total_questions?: number | null;
}

interface V2ChapterPerformance {
  chapter_name?: string;
  chapter_id?: string | null;
  subject?: string;
  marks_scored?: number | null;
  max_marks_possible?: number | null;
  percentage?: number | null;
  accuracy?: number | null;
  total_questions?: number | null;
  num_correct?: number | null;
  num_wrong?: number | null;
  num_skipped?: number | null;
}

interface V2ReportHeader {
  test_name?: string;
  test_date?: string;
}

interface V2ReportDoc {
  session_id: string;
  user_id: string;
  student_id?: string;
  apaar_id?: string;
  report_header?: V2ReportHeader;
  overall_performance?: V2OverallPerformance;
  subject_performance?: V2SubjectPerformance[];
  chapter_performance?: V2ChapterPerformance[];
}

// Normalize Decimal-like values (DynamoDB SDK returns numbers, but defensively
// coerce in case the doc client returns strings or Decimal-wrapped values).
function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Paginate any QueryCommand until LastEvaluatedKey is null.
async function paginatedQuery(
  buildCmd: (startKey?: Record<string, unknown>) => QueryCommand,
  label: string
): Promise<V2ReportDoc[]> {
  const client = getDynamoClient();
  const out: V2ReportDoc[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  try {
    do {
      const res = await client.send(buildCmd(exclusiveStartKey));
      out.push(...((res.Items || []) as V2ReportDoc[]));
      exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);
  } catch (error) {
    console.error(`DynamoDB ${label} query failed:`, error);
    return [];
  }
  return out;
}

// Query by school + session via the school_session_index GSI. Returns only the
// docs for one school in one session — much cheaper than scanning the whole
// session partition when other schools also took the test.
async function getReportsByGsi(
  schoolName: string,
  sessionId: string
): Promise<V2ReportDoc[]> {
  return paginatedQuery(
    (startKey) =>
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "school_session_index",
        KeyConditionExpression: "school = :school AND session_id = :sid",
        ExpressionAttributeValues: { ":school": schoolName, ":sid": sessionId },
        ExclusiveStartKey: startKey,
      }),
    "gsi"
  );
}

// Fallback: scan the whole session partition. Used when the GSI is missing
// (prod hasn't provisioned school_session_index yet) or when the school name
// from Postgres doesn't match the BQ-sourced v2 doc.
//
// FilterExpression on school is server-side filtering: DynamoDB still reads
// 1MB of partition data per page (no RCU savings), but only returns items that
// match our school. For a major test where our school is 24/583 of the docs,
// this drops per-page payload from ~1MB to ~40KB and pagination from ~2s/page
// to ~150ms/page. If `school` is undefined we return the full partition.
async function getAllReportsForSession(
  sessionId: string,
  school?: string
): Promise<V2ReportDoc[]> {
  const useFilter = !!school;
  return paginatedQuery(
    (startKey) =>
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "session_id = :sid",
        ...(useFilter && {
          FilterExpression: "#school = :school",
          ExpressionAttributeNames: { "#school": "school" },
        }),
        ExpressionAttributeValues: useFilter
          ? { ":sid": sessionId, ":school": school }
          : { ":sid": sessionId },
        ExclusiveStartKey: startKey,
      }),
    useFilter ? "session-partition+filter" : "session-partition"
  );
}

// --- Main function: replaces BigQuery test deep dive ---

export async function getTestDeepDiveFromDynamo(
  schoolId: string,
  schoolName: string,
  grade: number,
  sessionId: string,
  program?: string,
  stream?: string
): Promise<TestDeepDiveData | null> {
  // Step 1: Get student identifiers from Postgres (filters by school/grade/program/stream)
  const students = await getSchoolStudentIdentifiers(schoolId, grade, program, stream);
  if (students.length === 0) return null;

  // Step 2: Pull this school's docs for this session via the school_session GSI.
  // If the GSI is missing (table hasn't provisioned it) or returns nothing
  // (e.g. school-name mismatch between Postgres and the BQ-sourced v2 doc),
  // fall back to scanning the session partition with a server-side filter on
  // the school field — same RCU cost as a full scan, but tiny payload.
  let allDocs = await getReportsByGsi(schoolName, sessionId);
  if (allDocs.length === 0) {
    console.warn(
      `[deep-dive] gsi returned 0 docs for school="${schoolName}" session=${sessionId} — falling back to filtered partition scan`
    );
    allDocs = await getAllReportsForSession(sessionId, schoolName);
  }
  if (allDocs.length === 0) return null;

  // Build a quick reverse map: any-identifier → student. user_id is the LMS PG
  // user.id (not necessarily what's in the v2 doc); the v2 doc's user_id is
  // the enrollment_user_id from BQ. We match on student_id and apaar_id —
  // user_id alignment isn't guaranteed across the two systems.
  const identifierToStudent = new Map<string, StudentIdentifiers>();
  for (const s of students) {
    if (s.student_id) identifierToStudent.set(s.student_id, s);
    if (s.apaar_id) identifierToStudent.set(s.apaar_id, s);
    if (s.user_id) identifierToStudent.set(s.user_id, s);
  }

  const matched: { student: StudentIdentifiers; doc: V2ReportDoc }[] = [];
  for (const doc of allDocs) {
    const s =
      (doc.student_id && identifierToStudent.get(doc.student_id)) ||
      (doc.apaar_id && identifierToStudent.get(doc.apaar_id)) ||
      (doc.user_id && identifierToStudent.get(doc.user_id)) ||
      null;
    if (s) matched.push({ student: s, doc });
  }
  if (matched.length === 0) return null;

  // Step 3: Transform into TestDeepDiveData
  const studentRows: StudentDeepDiveRow[] = [];
  const subjectAggMap = new Map<
    string,
    { displayName: string; totalPct: number; totalAcc: number; totalAttempt: number; totalQ: number; count: number }
  >();
  // Key chapter aggregates by chapter_id when available; fall back to
  // subject + chapter_name as a last resort so legacy/missing-id rows still
  // group correctly within a single session.
  const chapterAggMap = new Map<
    string,
    {
      subject: string;
      chapter_name: string;
      chapter_id: string | null;
      totalScore: number;
      totalAcc: number;
      totalAttempt: number;
      totalQ: number;
      count: number;
    }
  >();

  let testName = "";
  let startDate = "";

  for (const { student, doc } of matched) {
    const overall = doc.overall_performance;
    if (!overall) continue;

    if (!testName) testName = doc.report_header?.test_name || "";
    if (!startDate) startDate = doc.report_header?.test_date || "";

    const overallTotal = toNum(overall.total_questions);
    const overallSkipped = toNum(overall.num_skipped);
    const overallAttemptRate =
      overallTotal > 0 ? ((overallTotal - overallSkipped) / overallTotal) * 100 : 0;

    // Group chapters by subject for fast per-subject lookup when building
    // per-student subject scores.
    const chaptersBySubject = new Map<string, V2ChapterPerformance[]>();
    for (const ch of doc.chapter_performance || []) {
      const key = (ch.subject || "").toLowerCase();
      const list = chaptersBySubject.get(key) || [];
      list.push(ch);
      chaptersBySubject.set(key, list);
    }

    const subjectScores: StudentSubjectScore[] = (doc.subject_performance || []).map((si) => {
      const sectionDisplay = si.subject || "";
      const sectionKey = sectionDisplay.toLowerCase();

      const total = toNum(si.total_questions);
      const skipped = toNum(si.num_skipped);
      const attemptRate = total > 0 ? ((total - skipped) / total) * 100 : 0;

      // Subject analysis aggregates across the class.
      const existing = subjectAggMap.get(sectionKey) || {
        displayName: sectionDisplay,
        totalPct: 0,
        totalAcc: 0,
        totalAttempt: 0,
        totalQ: 0,
        count: 0,
      };
      existing.totalPct += toNum(si.percentage);
      existing.totalAcc += toNum(si.accuracy);
      existing.totalAttempt += attemptRate;
      existing.totalQ = Math.max(existing.totalQ, total);
      existing.count += 1;
      subjectAggMap.set(sectionKey, existing);

      // Per-student chapter rows for this subject.
      const subjectChapters = chaptersBySubject.get(sectionKey) || [];
      const chapters: StudentChapterScore[] = subjectChapters.map((c) => {
        const chTotal = toNum(c.total_questions);
        const chMax = toNum(c.max_marks_possible);
        const chMarks = toNum(c.marks_scored);
        const chSkipped = toNum(c.num_skipped);
        const chAttemptRate =
          chTotal > 0 ? ((chTotal - chSkipped) / chTotal) * 100 : 0;
        const chPct = chMax > 0 ? (chMarks / chMax) * 100 : 0;

        const chKey = c.chapter_id || `${sectionKey}||${(c.chapter_name || "").toLowerCase()}`;
        const chEx = chapterAggMap.get(chKey) || {
          subject: sectionDisplay,
          chapter_name: c.chapter_name || "",
          chapter_id: c.chapter_id || null,
          totalScore: 0,
          totalAcc: 0,
          totalAttempt: 0,
          totalQ: 0,
          count: 0,
        };
        chEx.totalScore += chPct;
        chEx.totalAcc += toNum(c.accuracy);
        chEx.totalAttempt += chAttemptRate;
        chEx.totalQ = Math.max(chEx.totalQ, chTotal);
        chEx.count += 1;
        chapterAggMap.set(chKey, chEx);

        return {
          subject: sectionDisplay,
          chapter_name: c.chapter_name || "",
          marks_scored: chMarks,
          max_marks: chMax,
          accuracy: toNum(c.accuracy),
          attempt_rate: chAttemptRate,
          total_questions: chTotal,
        };
      });

      return {
        subject: sectionDisplay,
        percentage: toNum(si.percentage),
        marks_scored: toNum(si.marks_scored),
        max_marks: toNum(si.max_marks_possible),
        accuracy: toNum(si.accuracy),
        attempt_rate: attemptRate,
        chapters,
      };
    });

    const studentName = [student.first_name, student.last_name]
      .filter(Boolean)
      .join(" ");

    studentRows.push({
      student_name: studentName,
      gender: student.gender,
      marks_scored: toNum(overall.marks_scored),
      max_marks: toNum(overall.max_marks_possible),
      percentage: toNum(overall.percentage),
      accuracy: toNum(overall.accuracy),
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
  const subjects: SubjectAnalysisRow[] = Array.from(subjectAggMap.values())
    .map((agg) => ({
      subject: agg.displayName,
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
      chapter_id: agg.chapter_id,
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
