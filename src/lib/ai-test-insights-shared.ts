// AI Test Insights (#550): types and constants shared by the server and the
// browser. Client-safe: keep server-only imports (`@/lib/db`,
// `@/lib/permissions`) out of this module.
import { PROGRAM_IDS } from "@/lib/constants";

/** How much attention a Student has had, across all academic years. */
export interface AiTestInsightsCounts {
  /** The Student's `submitted` Insight Sessions. */
  insightSessionsCompleted: number;
  /** The Student's `completed` Insight Requests (Test Insights). */
  testInsightsGenerated: number;
  /** The newest `session_date` of a submitted Insight Session, `YYYY-MM-DD`. */
  lastInsightSessionDate: string | null;
}

/** One row of the AI Test Insights Tab, as the list route returns it. */
export interface AiTestInsightsStudent extends AiTestInsightsCounts {
  /** `student.id`. */
  studentId: number;
  name: string;
  /** `student.student_id`, the Student ID staff know the Student by. */
  studentCode: string | null;
  grade: 11 | 12;
}

/** The Student card on the Student page: who the Student is. */
export interface AiTestInsightsStudentCardData {
  name: string;
  /** `student.student_id`. */
  studentCode: string | null;
  grade: 11 | 12;
  /** Names of the Student's current batches in the Program of the centre that lists them. */
  batches: string[];
  gender: string | null;
  category: string | null;
  stream: string | null;
  insightSessionsCompleted: number;
  lastInsightSessionDate: string | null;
}

/**
 * The test formats an AI Summary can cover: Major, Full Syllabus and Mock
 * tests. Not `MAJOR_TEST_FORMATS` (`@/lib/bigquery`), which also holds Part
 * tests; Part and Chapter tests never appear in the test picker.
 */
export const AI_TEST_INSIGHTS_TEST_FORMATS = ["major_test", "full_syllabus_test", "mock_test"] as const;

export type AiTestInsightsTestFormat = (typeof AI_TEST_INSIGHTS_TEST_FORMATS)[number];

/** One test of the AI Summary card's test picker. */
export interface AiTestInsightsTest {
  /** The warehouse `test_id`, as a string. */
  id: string;
  name: string;
  /** The Student's newest sitting of the test, `YYYY-MM-DD`. */
  date: string;
  format: AiTestInsightsTestFormat;
}

/** `GET /api/ai-test-insights/students/[studentId]/tests`: newest first. */
export interface AiTestInsightsTestsResponse {
  tests: AiTestInsightsTest[];
}

/**
 * The Student page's read of the test picker route. The AI Summary card's
 * picker and the Student card's newest test line share it: one read, not two.
 */
export type AiTestInsightsTestsState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; tests: AiTestInsightsTest[] };

/** The test picker's route for a Student (`student.id`). */
export function aiTestInsightsTestsUrl(studentId: number): string {
  return `/api/ai-test-insights/students/${studentId}/tests`;
}

/** `GET /api/school/[udise]/ai-test-insights`. */
export interface AiTestInsightsListResponse {
  students: AiTestInsightsStudent[];
}

/**
 * A physical-centre Program is every Program except JNV NVS (as
 * `PHYSICAL_CENTRE_PROGRAM_IDS`, but also true of a Program onboarded since).
 * AI Test Insights is for these Programs only.
 */
export function isPhysicalCentreProgramId(programId: number | string | null | undefined): boolean {
  if (programId === null || programId === undefined || programId === "") return false;
  return Number(programId) !== PROGRAM_IDS.NVS;
}

/** The list route for a School (code or UDISE), narrowed to one centre if given. */
export function aiTestInsightsListUrl(schoolCode: string, centreId?: number | string | null): string {
  const base = `/api/school/${encodeURIComponent(schoolCode)}/ai-test-insights`;
  return centreId === undefined || centreId === null
    ? base
    : `${base}?centre_id=${encodeURIComponent(String(centreId))}`;
}

/** The Student page; on a Centre page the link carries the centre for the back link. */
export function aiTestInsightsStudentPageUrl(studentId: number, centreId?: number | string | null): string {
  const base = `/ai-test-insights/students/${studentId}`;
  return centreId === undefined || centreId === null ? base : `${base}?centre=${encodeURIComponent(String(centreId))}`;
}

/** `2026-11-14` → `14 Nov 2026`; no date stays empty. Read as a calendar date, not a moment. */
export function formatInsightSessionDate(date: string | null): string {
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
