// AI Test Insights (#550): types and constants shared by the server and the
// browser. Client-safe: keep server-only imports (`@/lib/db`,
// `@/lib/permissions`) out of this module.
import { PROGRAM_IDS } from "@/lib/constants";
import { TestFormatOptions } from "@/lib/quiz-session-options";

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

/**
 * How the test picker names each format: the labels the LMS already uses for
 * test formats (`TestFormatOptions`), so the wording never drifts.
 */
export const AI_TEST_INSIGHTS_TEST_FORMAT_LABELS = Object.fromEntries(
  AI_TEST_INSIGHTS_TEST_FORMATS.map((format) => {
    const option = TestFormatOptions.find((candidate) => candidate.value === format);
    if (!option) throw new Error(`No label for the test format ${format}`);
    return [format, option.label];
  }),
) as Record<AiTestInsightsTestFormat, string>;

/** One test of the AI Summary card's test picker. */
export interface AiTestInsightsTest {
  /** The warehouse `test_id`, as a string. */
  id: string;
  name: string;
  /** The Student's newest sitting of the test, `YYYY-MM-DD`. */
  date: string;
  format: AiTestInsightsTestFormat;
}

/**
 * `GET …/requests/[requestKey]/pdf` asked with `Accept: application/json`
 * (the card's Download PDF): the 60-second presigned URL of the PDF, which
 * the browser then opens as a download.
 */
export interface AiTestInsightsPdfResponse {
  url: string;
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

/** The states an Insight Request is stored in. */
export type AiTestInsightsRequestState = "queued" | "running" | "completed" | "no_data" | "failed";

/** One Insight Request, as every read of the Insight Request module returns it. */
export interface InsightRequestView {
  requestKey: string;
  state: AiTestInsightsRequestState;
  outcomeCode: string | null;
  /** The ticked warehouse `test_id` values, newest first. */
  selectedTestIds: string[];
  /** UTC, ISO 8601 (`2026-11-27T05:30:00Z`). */
  requestedAt: string;
  requestedByName: string;
  /** UTC, ISO 8601; null until the request ends. */
  finishedAt: string | null;
}

/** A `queued` or `running` request holds the Student's one running slot. */
export function isInsightRequestInProgress(request: InsightRequestView | null): boolean {
  return request?.state === "queued" || request?.state === "running";
}

/**
 * `POST /api/ai-test-insights/students/[studentId]/requests`: 201 created;
 * 200 already running, or `existing` (a completed request of the same tests).
 */
export interface AiTestInsightsCreateRequestResponse {
  outcome: "created" | "already_running" | "existing";
  request: InsightRequestView;
}

/** `GET /api/ai-test-insights/students/[studentId]/requests/[requestKey]`: the request the card polls. */
export interface AiTestInsightsRequestStatusResponse {
  request: InsightRequestView;
}

/** `GET .../requests/[requestKey]/summary`: the Test Insight text of a completed request. */
export interface AiTestInsightsSummaryResponse {
  markdown: string;
}

/** The 409 code of a login whose permission links no User and no User has its email. */
export const NO_LINKED_USER_CODE = "no_linked_user";

/** What a Teacher with no User sees instead of Generate's answer or the Session Notes form. */
export const NO_LINKED_USER_MESSAGE = "Your login is not linked to a user record. Contact your program admin.";

/** The 503 code of Generate without the delivery settings, and of the summary route without the reader's settings. */
export const NOT_CONFIGURED_CODE = "not_configured";

/**
 * A route under a Student's AI Test Insights API path (`student.id`), such as
 * `requests` or `sessions/draft`; a centre the page named carries over.
 */
export function aiTestInsightsStudentApiUrl(studentId: number, path: string, centreId?: number | null): string {
  const base = `/api/ai-test-insights/students/${studentId}/${path}`;
  return centreId === undefined || centreId === null ? base : `${base}?centre=${encodeURIComponent(String(centreId))}`;
}

/** The create route for a Student (`student.id`); a centre the page named carries over. */
export function aiTestInsightsRequestsUrl(studentId: number, centreId?: number | null): string {
  return aiTestInsightsStudentApiUrl(studentId, "requests", centreId);
}

/**
 * The status route of one request, from the Student's create route: the
 * request key joins the path, and a centre the page named carries over.
 */
export function aiTestInsightsRequestStatusUrl(requestsUrl: string, requestKey: string): string {
  const [path, search] = requestsUrl.split("?", 2);
  return `${path}/${encodeURIComponent(requestKey)}${search ? `?${search}` : ""}`;
}

/**
 * The summary route of one request (its AI Summary text), from the Student's
 * create route; a centre the page named carries over.
 */
export function aiTestInsightsRequestSummaryUrl(requestsUrl: string, requestKey: string): string {
  const [path, search] = aiTestInsightsRequestStatusUrl(requestsUrl, requestKey).split("?", 2);
  return `${path}/summary${search ? `?${search}` : ""}`;
}

/**
 * The PDF route of one request (its AI Summary PDF), from the Student's
 * requests route; a `centre` value is kept.
 */
export function aiTestInsightsRequestPdfUrl(requestsUrl: string, requestKey: string): string {
  const [path, search] = aiTestInsightsRequestStatusUrl(requestsUrl, requestKey).split("?", 2);
  return `${path}/pdf${search ? `?${search}` : ""}`;
}

/**
 * The file name an AI Summary PDF downloads as: the Student's `student.id`
 * and the request's date in India, never the Student's name.
 * `2026-11-27T05:30:00Z` of Student 1001 is `ai-summary-1001-2026-11-27.pdf`.
 */
export function aiTestInsightPdfFileName(studentId: number, requestedAt: string): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(requestedAt));
  return `ai-summary-${studentId}-${date}.pdf`;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A UTC moment (`2026-11-27T05:30:00Z`) in India time: `27 Nov 2026, 11:00`. */
export function formatInsightRequestTime(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${Number(parts.day)} ${SHORT_MONTHS[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute}`;
}
