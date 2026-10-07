import { NextRequest } from "next/server";
import * as curriculumOptions from "@/app/api/curriculum/options/route";
import * as curriculumProgress from "@/app/api/curriculum/progress/route";
import * as curriculumChapters from "@/app/api/curriculum/chapters/route";
import * as quizGrades from "@/app/api/quiz-analytics/[udise]/grades/route";
import * as quizBatchOverview from "@/app/api/quiz-analytics/[udise]/batch-overview/route";
import * as quizCumulativeAls from "@/app/api/quiz-analytics/[udise]/cumulative-als/route";
import * as quizTestDeepDive from "@/app/api/quiz-analytics/[udise]/test-deep-dive/route";
import * as holisticProgress from "@/app/api/holistic-mentorship/progress/route";

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
  // The route checks school access but not the caller's programs (the LMS UI
  // narrows by program instead). get_view requires `program` and only allows
  // one the caller's own grades view lists — see `programGuard`.
  programScoped?: boolean;
  // Rewrites a successful JSON body before Claude sees it, to drop fields the
  // LMS shows on screen that shouldn't reach Claude by default (e.g. mentorship
  // notes). `includeNotes` is the caller's explicit opt-in (see NOTES_PARAM).
  redact?: (body: unknown, opts: { includeNotes: boolean }) => unknown;
}

const CURRICULUM_SCOPE = {
  school_code: "required — school code",
  program_id: "required — from curriculum options",
  exam_track: "required — from curriculum options",
  grade: "required — from curriculum options",
  subject: "required — from curriculum options",
};

const QUIZ_FILTERS = {
  program: "required — one of the programs the grades view returns",
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
    programScoped: true,
  },
  {
    path: "/api/quiz-analytics/[udise]/cumulative-als",
    description: "Each student's academic level across major tests for a grade at a school, with the progression.",
    query: { grade: "required — integer", ...QUIZ_FILTERS },
    handler: handler(quizCumulativeAls.GET),
    programScoped: true,
  },
  {
    path: "/api/quiz-analytics/[udise]/test-deep-dive",
    description: "One test at a school: per-student marks and per-subject/chapter breakdown.",
    query: { grade: "required — integer", sessionId: "required — from batch-overview", ...QUIZ_FILTERS },
    handler: handler(quizTestDeepDive.GET),
    programScoped: true,
  },
  {
    path: "/api/holistic-mentorship/progress",
    description:
      "Holistic Mentorship progress for one program and academic year: counts (total / completed / pending / skipped / noActivePhase mentees, where completed = post-session notes submitted for the phase), coverage (eligible / assigned / unassigned students), filter options (schools, mentors, phases), and one page of 50 mentee rows (student, school, grade, mentor, phase, progress). Filter by phase_id for a given session/phase; by school_code for one school. Note text is omitted unless include_notes=true.",
    query: {
      program_id: "required — 1 JNV CoE, 74 Punjab CoE, 94 Punjab Nodal, 78 EMRS CoE, 88 Uttarakhand CoE, 99 Maharashtra Coaching Test Prep",
      academic_year: "required — e.g. 2026-2027 (current)",
      phase_id: "optional — from options.phases",
      school_code: "optional",
      grade: "optional — 11 or 12",
      progress: "optional — pending | completed | skipped | no_active_phase | unassigned",
      mentor_user_id: "optional — from options.mentors",
      search: "optional — student name",
      page: "optional — 50 rows per page",
      include_notes:
        "optional — 'true' returns the mentors' submitted note answers. Set it ONLY when the user explicitly asks to read note content; counts and progress never need it.",
    },
    handler: handler(holisticProgress.GET),
    redact: redactHolisticProgress,
  },
];

// Handled by get_view itself, never forwarded to the LMS route.
export const NOTES_PARAM = "include_notes";

// Mentor-authored session notes are sensitive: by default keep only how many
// answers exist. The LMS route has already applied its own visibility rules
// (draft privacy, program/school scope), so opting in shows only what the
// user could read in the LMS.
function redactHolisticProgress(body: unknown, { includeNotes }: { includeNotes: boolean }): unknown {
  if (includeNotes) return body;
  if (!body || typeof body !== "object" || !("rows" in body) || !Array.isArray(body.rows)) return body;
  return {
    ...body,
    rows: body.rows.map((row: Record<string, unknown>) => {
      if (!("answers" in row)) return row;
      const { answers, ...rest } = row;
      return { ...rest, answersSubmitted: Array.isArray(answers) ? answers.length : 0 };
    }),
  };
}

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

const GRADES_VIEW = "/api/quiz-analytics/[udise]/grades";

// For programScoped views: the requested program must be one the LMS's own
// grades route offers this caller at this school (it filters by the caller's
// program_ids). Returns an error message, or null when the call may proceed.
// Must run inside `runAsMcpCaller`.
export async function programGuard(
  match: { view: LmsView; params: Record<string, string> },
  query: Record<string, string | number>,
  baseUrl: string,
): Promise<string | null> {
  if (!match.view.programScoped) return null;
  const grades = LMS_VIEWS.find((v) => v.path === GRADES_VIEW)!;
  const path = GRADES_VIEW.replace("[udise]", encodeURIComponent(match.params.udise));
  const response = await invokeView({ view: grades, params: match.params }, path, {}, baseUrl);
  if (!response.ok) return `HTTP ${response.status}: ${await response.text()}`;
  const { programs } = (await response.json()) as { programs: string[] };
  const program = query.program === undefined ? "" : String(query.program);
  if (!programs.includes(program)) {
    return programs.length
      ? `\`program\` is required and must be one of: ${programs.join(", ")}.`
      : "No test-result programs at this school are available to you.";
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
