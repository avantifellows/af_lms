import { NextRequest } from "next/server";
import * as curriculumOptions from "@/app/api/curriculum/options/route";
import * as curriculumProgress from "@/app/api/curriculum/progress/route";
import * as curriculumChapters from "@/app/api/curriculum/chapters/route";
import * as quizGrades from "@/app/api/quiz-analytics/[udise]/grades/route";
import * as quizBatchOverview from "@/app/api/quiz-analytics/[udise]/batch-overview/route";
import * as quizCumulativeAls from "@/app/api/quiz-analytics/[udise]/cumulative-als/route";
import * as quizTestDeepDive from "@/app/api/quiz-analytics/[udise]/test-deep-dive/route";

// LMS read endpoints Claude may call through `get_view`. An explicit
// allow-list: a route only belongs here once it (and every gate it calls)
// resolves identity through `getSession()` from `@/lib/session` — otherwise
// it would read the outer MCP request instead of the caller — and once its
// response is checked for student contact details (phone, email, DOB,
// address), which must never be listed.
type Handler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

// Route handlers differ in their params type; matchView supplies exactly the
// segments in the view's path, so widening here is safe.
function handler<P>(
  fn: (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>,
): Handler {
  return fn as unknown as Handler;
}

export interface LmsView {
  path: string; // `[segment]` = path parameter
  description: string;
  query: Record<string, string>; // query parameter → meaning ("required" when needed)
  handler: Handler;
}

const CURRICULUM_SCOPE = {
  school_code: "required — school code",
  program_id: "required — from curriculum options",
  exam_track: "required — from curriculum options",
  grade: "required — from curriculum options",
  subject: "required — from curriculum options",
};

const QUIZ_FILTERS = {
  program: "optional — program name, from the grades view",
  stream: "optional — e.g. engineering / medical",
};

export const LMS_VIEWS: LmsView[] = [
  {
    path: "/api/curriculum/options",
    description:
      "Curriculum tracker setup for a school: its programs, exam tracks, grades and subjects, and the defaults. Call first to get the values the other curriculum views need.",
    query: { school_code: "required — school code", program_id: "optional" },
    handler: handler(curriculumOptions.GET),
  },
  {
    path: "/api/curriculum/progress",
    description:
      "Curriculum completion for one school / program / track / grade / subject: per chapter, taught time and completion, plus subject totals.",
    query: CURRICULUM_SCOPE,
    handler: handler(curriculumProgress.GET),
  },
  {
    path: "/api/curriculum/chapters",
    description: "The chapter and topic list (with planned time) for one curriculum scope.",
    query: CURRICULUM_SCOPE,
    handler: handler(curriculumChapters.GET),
  },
  {
    path: "/api/quiz-analytics/[udise]/grades",
    description: "Grades and programs that have test results at a school. Call first for quiz analytics.",
    query: { program: "optional" },
    handler: handler(quizGrades.GET),
  },
  {
    path: "/api/quiz-analytics/[udise]/batch-overview",
    description: "Test-by-test summary for a grade at a school: attendance, average scores, the list of tests (with sessionId).",
    query: { grade: "required — integer", ...QUIZ_FILTERS },
    handler: handler(quizBatchOverview.GET),
  },
  {
    path: "/api/quiz-analytics/[udise]/cumulative-als",
    description: "Each student's academic level across major tests for a grade at a school, with the progression.",
    query: { grade: "required — integer", ...QUIZ_FILTERS },
    handler: handler(quizCumulativeAls.GET),
  },
  {
    path: "/api/quiz-analytics/[udise]/test-deep-dive",
    description: "One test at a school: per-student marks and per-subject/chapter breakdown.",
    query: { grade: "required — integer", sessionId: "required — from batch-overview", ...QUIZ_FILTERS },
    handler: handler(quizTestDeepDive.GET),
  },
];

// Match a concrete path ("/api/quiz-analytics/123/grades") to its view and
// pull out the path parameters.
export function matchView(path: string): { view: LmsView; params: Record<string, string> } | null {
  const parts = path.split("?")[0].replace(/\/+$/, "").split("/");
  for (const view of LMS_VIEWS) {
    const pattern = view.path.split("/");
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((seg, i) => {
      const m = /^\[(\w+)\]$/.exec(seg);
      if (m) {
        if (!parts[i]) return false;
        params[m[1]] = decodeURIComponent(parts[i]);
        return true;
      }
      return seg === parts[i];
    });
    if (ok) return { view, params };
  }
  return null;
}

// Invoke a view's handler in-process. The caller must already be inside
// `runAsMcpCaller` so the handler's own gates see the MCP caller.
export async function invokeView(
  match: { view: LmsView; params: Record<string, string> },
  path: string,
  query: Record<string, string | number>,
  baseUrl: string,
): Promise<Response> {
  const url = new URL(path.split("?")[0], baseUrl);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const request = new NextRequest(url, { method: "GET" });
  return match.view.handler(request, { params: Promise.resolve(match.params) });
}
