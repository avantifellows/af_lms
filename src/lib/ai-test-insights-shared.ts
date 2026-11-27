// AI Test Insights (#550): types and constants shared by the server and the
// browser. Client-safe: keep server-only imports (`@/lib/db`,
// `@/lib/permissions`) out of this module.
import { PROGRAM_IDS } from "@/lib/constants";

/** One row of the AI Test Insights Tab, as the list route returns it. */
export interface AiTestInsightsStudent {
  /** `student.id`. */
  studentId: number;
  name: string;
  /** `student.student_id`, the Student ID staff know the Student by. */
  studentCode: string | null;
  grade: 11 | 12;
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
