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
