import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The History timeline of the Session Notes read (#576), through the real
// Student access helper, the real permission matrix, the real route opening,
// the real History read and the real Session Notes and Insight Request
// modules. The session and the Postgres boundary are stubbed: Postgres
// answers the permission row, centre seats, the listed-Student rows, the
// actor's User by email, and the session, audit and request rows below,
// filtered as the SQL says. Expected timelines are written by hand.
const { mockQuery, mockGetServerSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery, withTransaction: vi.fn() }));

import { GET } from "./route";

const email = "staff@avantifellows.org";
const MARKER = "[marker-576-timeline]";

// Student 1001 is listed by centre 301 of School JNV001.
const LISTED: Record<string, Array<Record<string, unknown>>> = {
  "1001": [
    {
      student_id: "1001", user_id: "5001", centre_id: "301", program_id: "1", grade: 11,
      school_id: "9", school_code: "JNV001", school_udise: "29000000001", school_region: "South",
    },
  ],
};

const VIEW_ONLY_ROLES = ["program_manager", "program_admin", "admin"] as const;
const NO_FEATURE_ROLES = [
  "holistic_mentorship_admin",
  "pmu_manager",
  "pmu_govt_school_user",
  "blended_mentor",
  "blended_admin",
  "alumni_manager",
] as const;

/** An Insight Session as the submitted-sessions read selects it, with its Student and state to filter on. */
type SessionRow = {
  student_id: number;
  state: string;
  id: number;
  revision: number;
  session_date: string;
  author_user_id: number;
  author_name: string;
  areas_of_concern: string | null;
  immediate_actions: string | null;
  other_notes: string | null;
  insight_request_id: number | null;
  submitted_at: string | null;
};
type AuditRow = { session_id: number; action: "submitted" | "submitted_edited"; occurred_at: string };
/** An Insight Request as the request view selects it, with its id, Student and state to filter on. */
type RequestRow = {
  id: number;
  student_id: number;
  request_key: string;
  state: string;
  outcome_code: string | null;
  selected_test_ids: string[];
  requested_at: string;
  requested_by_name: string;
  finished_at: string | null;
  read_at: string;
};

let permissionRow: Record<string, unknown> | null;
let usersByEmail: Array<Record<string, unknown>>;
let sessions: SessionRow[];
let audits: AuditRow[];
let requests: RequestRow[];

function row(role: string, overrides: Record<string, unknown> = {}) {
  return {
    email,
    level: role === "admin" ? 3 : 1,
    role,
    school_codes: role === "admin" ? null : ["JNV001"],
    regions: null,
    program_ids: role.startsWith("pmu") ? [64] : [1, 2],
    read_only: false,
    user_id: 777,
    ...overrides,
  };
}

const session = (overrides: Partial<SessionRow> & Pick<SessionRow, "id">): SessionRow => ({
  student_id: 1001,
  state: "submitted",
  revision: 2,
  session_date: "2026-11-14",
  author_user_id: 777,
  author_name: "Asha Teacher",
  areas_of_concern: `Concern ${MARKER}`,
  immediate_actions: `Action ${MARKER}`,
  other_notes: null,
  insight_request_id: null,
  submitted_at: "2026-11-14T08:00:00Z",
  ...overrides,
});

const request = (overrides: Partial<RequestRow> & Pick<RequestRow, "id" | "request_key">): RequestRow => ({
  student_id: 1001,
  state: "completed",
  outcome_code: null,
  selected_test_ids: ["T9"],
  requested_at: "2026-11-14T05:00:00Z",
  requested_by_name: "Asha Teacher",
  finished_at: "2026-11-14T05:04:00Z",
  read_at: "2026-11-27T10:00:00Z",
  ...overrides,
});

/** The request view of a request row, as the timeline shows it, written out. */
const viewOf = (requestKey: string, requestedAt: string, finishedAt: string | null, by = "Asha Teacher") => ({
  requestKey,
  state: "completed",
  outcomeCode: null,
  selectedTestIds: ["T9"],
  requestedAt,
  requestedByName: by,
  finishedAt,
});

/** The rows of the timeline: sessions by Teachers 777 and 888, a draft, and requests in four states. */
function seedTimelineRows() {
  sessions = [
    // Recorded R-51; edited twice.
    session({ id: 11, revision: 4, other_notes: `Other ${MARKER}`, insight_request_id: 51 }),
    // Teacher 888's, last year.
    session({
      id: 12,
      revision: 2,
      session_date: "2026-02-10",
      author_user_id: 888,
      author_name: "Bina Teacher",
      areas_of_concern: `Older concern ${MARKER}`,
      immediate_actions: `Older action ${MARKER}`,
      submitted_at: "2026-02-10T09:00:00Z",
    }),
    // Drafts never show.
    session({ id: 13, state: "draft", revision: 1, session_date: "2026-11-20", submitted_at: null }),
  ];
  audits = [
    { session_id: 11, action: "submitted", occurred_at: "2026-11-14T08:00:00Z" },
    { session_id: 11, action: "submitted_edited", occurred_at: "2026-11-15T19:00:00Z" },
    { session_id: 11, action: "submitted_edited", occurred_at: "2026-11-16T03:00:00Z" },
    { session_id: 12, action: "submitted", occurred_at: "2026-02-10T09:00:00Z" },
  ];
  requests = [
    request({ id: 51, request_key: "rk-51" }),
    // Not recorded by any session: an entry of its own, on the same day as session 12, later.
    request({ id: 52, request_key: "rk-52", requested_at: "2026-02-10T10:00:00Z", finished_at: "2026-02-10T10:05:00Z" }),
    request({ id: 53, request_key: "rk-53", state: "failed", outcome_code: "pipeline_error", requested_at: "2026-11-20T05:00:00Z" }),
    request({ id: 54, request_key: "rk-54", state: "running", requested_at: "2026-11-27T09:55:00Z", finished_at: null }),
  ];
}

/** The timeline of {@link seedTimelineRows}, by hand, for a caller who is the author of `author`'s sessions. */
function expectedTimeline({ isAuthorOf }: { isAuthorOf: number | null }) {
  return [
    {
      kind: "session",
      sessionId: 11,
      revision: 4,
      sessionDate: "2026-11-14",
      authorName: "Asha Teacher",
      isAuthor: isAuthorOf === 777,
      areasOfConcern: `Concern ${MARKER}`,
      immediateActions: `Action ${MARKER}`,
      otherNotes: `Other ${MARKER}`,
      lastEditedAt: "2026-11-16T03:00:00Z",
      testInsight: viewOf("rk-51", "2026-11-14T05:00:00Z", "2026-11-14T05:04:00Z"),
    },
    { kind: "test_insight", testInsight: viewOf("rk-52", "2026-02-10T10:00:00Z", "2026-02-10T10:05:00Z") },
    {
      kind: "session",
      sessionId: 12,
      revision: 2,
      sessionDate: "2026-02-10",
      authorName: "Bina Teacher",
      isAuthor: isAuthorOf === 888,
      areasOfConcern: `Older concern ${MARKER}`,
      immediateActions: `Older action ${MARKER}`,
      otherNotes: null,
      lastEditedAt: null,
      testInsight: null,
    },
  ];
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const level of ["error", "info", "warn", "log"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  permissionRow = row("teacher");
  usersByEmail = [];
  sessions = [];
  audits = [];
  requests = [];
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    if (sql.includes('FROM "user"') && sql.includes("LOWER(email)")) return usersByEmail;
    if (sql.includes("FROM ai_test_insight_sessions") && sql.includes("state = 'draft'")) return [];
    if (sql.includes("FROM ai_test_insight_sessions")) {
      expect(sql).toMatch(/s\.student_id = \$1 AND s\.state = 'submitted'/);
      expect(sql).toMatch(/a\.action = 'submitted_edited'/);
      return sessions
        .filter((s) => s.student_id === params[0] && s.state === "submitted")
        .map((s) => {
          const edits = audits
            .filter((a) => a.session_id === s.id && a.action === "submitted_edited")
            .map((a) => a.occurred_at)
            .sort();
          return { ...s, last_edited_at: edits.at(-1) ?? null };
        });
    }
    if (sql.includes("FROM ai_test_insight_requests")) {
      expect(sql).toMatch(/r\.student_id = \$1 AND r\.state = 'completed'/);
      return requests.filter((r) => r.student_id === params[0] && r.state === "completed");
    }
    return [];
  });
});

async function get(studentId: string) {
  return GET(new NextRequest(`http://localhost/api/ai-test-insights/students/${studentId}/sessions`), {
    params: Promise.resolve({ studentId }),
  });
}

const timelineReads = () =>
  mockQuery.mock.calls.filter(
    ([sql]) =>
      (String(sql).includes("ai_test_insight_sessions") && !String(sql).includes("state = 'draft'")) ||
      String(sql).includes("ai_test_insight_requests"),
  );

describe("GET /api/ai-test-insights/students/[studentId]/sessions: the timeline", () => {
  it("lists submitted sessions and unrecorded completed requests, newest first; a recorded request shows only in its session", async () => {
    seedTimelineRows();

    const response = await get("1001");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).timeline).toEqual(expectedTimeline({ isAuthorOf: 777 }));
  });

  it("answers an empty timeline for a Student with no submitted session and no completed request", async () => {
    sessions = [session({ id: 13, state: "draft", submitted_at: null })];
    requests = [request({ id: 53, request_key: "rk-53", state: "failed" })];

    expect((await (await get("1001")).json()).timeline).toEqual([]);
  });

  it("reads the timeline by Student only, whatever School, Program or year the rows were recorded under", async () => {
    seedTimelineRows();

    await get("1001");

    for (const [sql, params] of timelineReads()) {
      expect(String(sql)).not.toMatch(/school_id|program_id|academic_year/);
      expect(params).toEqual([1001]);
    }
  });

  describe("isAuthor", () => {
    beforeEach(seedTimelineRows);

    it("is true only on the caller's own sessions for their author", async () => {
      expect((await (await get("1001")).json()).timeline).toEqual(expectedTimeline({ isAuthorOf: 777 }));
    });

    it("is true on another Teacher's own sessions for that Teacher, found by email", async () => {
      permissionRow = row("teacher", { user_id: null });
      usersByEmail = [{ id: "888" }];

      expect((await (await get("1001")).json()).timeline).toEqual(expectedTimeline({ isAuthorOf: 888 }));
    });

    it("is false everywhere for a Teacher who wrote none of them", async () => {
      permissionRow = row("teacher", { user_id: 999 });

      expect((await (await get("1001")).json()).timeline).toEqual(expectedTimeline({ isAuthorOf: null }));
    });

    it("is false everywhere for a Teacher with no User", async () => {
      permissionRow = row("teacher", { user_id: null });

      const body = await (await get("1001")).json();

      expect(body.notesAccess).toBe("no_linked_user");
      expect(body.timeline).toEqual(expectedTimeline({ isAuthorOf: null }));
    });

    it.each([...VIEW_ONLY_ROLES])("is false everywhere for %s, even whose User wrote a session", async (role) => {
      permissionRow = row(role, { user_id: 777 });

      const response = await get("1001");

      expect(response.status).toBe(200);
      expect((await response.json()).timeline).toEqual(expectedTimeline({ isAuthorOf: null }));
    });

    it("is false everywhere for a read_only Teacher, even on their own session", async () => {
      permissionRow = row("teacher", { read_only: true, user_id: 777 });

      const body = await (await get("1001")).json();

      expect(body.notesAccess).toBe("read");
      expect(body.timeline).toEqual(expectedTimeline({ isAuthorOf: null }));
    });
  });

  describe("refusal order", () => {
    beforeEach(seedTimelineRows);

    it("answers 401 without a session, reading no timeline", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect((await get("1001")).status).toBe(401);
      expect(timelineReads()).toHaveLength(0);
    });

    it("answers 422 for a bad id, reading no timeline", async () => {
      expect((await get("abc")).status).toBe(422);
      expect(timelineReads()).toHaveLength(0);
    });

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, reading no timeline", async (role) => {
      permissionRow = row(role);

      expect((await get("1001")).status).toBe(403);
      expect(timelineReads()).toHaveLength(0);
    });

    it.each(["teacher", ...VIEW_ONLY_ROLES])("answers 404 to %s for a Student who does not exist, reading no timeline", async (role) => {
      permissionRow = row(role);

      expect((await get("9999")).status).toBe(404);
      expect(timelineReads()).toHaveLength(0);
    });

    it("answers 404 to a read_only Teacher for a Student who does not exist, reading no timeline", async () => {
      permissionRow = row("teacher", { read_only: true });

      expect((await get("9999")).status).toBe(404);
      expect(timelineReads()).toHaveLength(0);
    });
  });

  it("answers 500 for a timeline read error, logging only the Student's id and the error name", async () => {
    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM user_permission")) return [permissionRow];
      if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
      if (sql.includes("ai_test_insight_requests")) {
        throw Object.assign(new Error(`bad value "${MARKER}"`), { name: "DatabaseError" });
      }
      return [];
    });
    permissionRow = row("program_manager");

    const response = await get("1001");

    expect(response.status).toBe(500);
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("1001");
    expect(logged).toContain("DatabaseError");
    expect(logged).not.toContain(MARKER);
  });
});
