import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The author's edit of submitted Session Notes (#578),
// `PATCH …/students/[studentId]/sessions/[sessionId]`, through the real
// Student access helper, the real permission matrix, the real route opening
// and the real Session Notes module. The session and the Postgres boundary
// (`query()` and `withTransaction`) are stubbed: Postgres answers the
// permission row, centre seats, the listed-Student rows of one Student and the
// actor's User by email, as declared here, and holds the
// `ai_test_insight_sessions` and `ai_test_insight_session_note_audits` rows in
// `sessions` and `audits`, applying each statement's guards as the SQL says.
// The clock is fixed: today in India is 27 Nov 2026 unless a test moves it.
const { mockQuery, mockClientQuery, mockGetServerSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: mockQuery,
  withTransaction: (fn: (client: unknown) => Promise<unknown>) => fn({ query: mockClientQuery }),
}));

import { PATCH } from "./route";

const email = "staff@avantifellows.org";
const MARKER = "[marker-578-edit]";
/** What the stub stores for `now() AT TIME ZONE 'UTC'`. */
const NOW = "now (UTC)";

// Student 1001 is listed by centre 301 (School 9, Program 1). 2001 is listed
// by centre 401 of another School, JNV002.
const LISTED: Record<string, Array<Record<string, unknown>>> = {
  "1001": [
    {
      student_id: "1001", user_id: "5001", centre_id: "301", program_id: "1", grade: 11,
      school_id: "9", school_code: "JNV001", school_udise: "29000000001", school_region: "South",
    },
  ],
  "2001": [
    {
      student_id: "2001", user_id: "6001", centre_id: "401", program_id: "1", grade: 12,
      school_id: "10", school_code: "JNV002", school_udise: "29000000002", school_region: "South",
    },
  ],
};

const VIEWER_ROLES = ["program_manager", "program_admin", "admin"] as const;
const NO_FEATURE_ROLES = [
  "holistic_mentorship_admin",
  "pmu_manager",
  "pmu_govt_school_user",
  "blended_mentor",
  "blended_admin",
  "alumni_manager",
] as const;

type SessionRow = {
  id: number;
  student_id: number;
  school_id: number;
  program_id: number;
  academic_year: string;
  author_user_id: number;
  state: "draft" | "submitted";
  session_date: string | null;
  areas_of_concern: string | null;
  immediate_actions: string | null;
  other_notes: string | null;
  insight_request_id: number | null;
  submitted_at: string | null;
  updated_at: string;
  revision: number;
};
type AuditRow = { session_id: number; actor_user_id: number; action: string; revision: number; occurred_at: string };

let permissionRow: Record<string, unknown> | null;
let usersByEmail: Array<Record<string, unknown>>;
let sessions: SessionRow[];
let audits: AuditRow[];

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

/**
 * Teacher 777's submitted session 60 of Student 1001 at revision 2, submitted
 * last year from School 5, Program 2, linked to request 70.
 */
function submitted(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 60,
    student_id: 1001,
    school_id: 5,
    program_id: 2,
    academic_year: "2025-2026",
    author_user_id: 777,
    state: "submitted",
    session_date: "2026-11-20",
    areas_of_concern: "Weak in optics",
    immediate_actions: "Two worksheets",
    other_notes: "Parents informed",
    insight_request_id: 70,
    submitted_at: "submitted earlier",
    updated_at: "earlier",
    revision: 2,
    ...overrides,
  };
}

/** The same notes as {@link submitted}'s, with spaces around them. */
const SAME_NOTES = {
  sessionDate: "2026-11-20",
  areasOfConcern: "  Weak in optics ",
  immediateActions: "\nTwo worksheets\n",
  otherNotes: " Parents informed",
};
const EDIT = {
  sessionDate: "2026-11-18",
  areasOfConcern: `  Weak in ray optics ${MARKER}  `,
  immediateActions: `\nThree worksheets a week ${MARKER}\n`,
  otherNotes: "   ",
  expectedRevision: 2,
};

/** Statements that write (a `SELECT … FOR UPDATE` lock is a read). */
const writes = () =>
  [...mockQuery.mock.calls, ...mockClientQuery.mock.calls].filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(String(sql)));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
  for (const level of ["error", "info", "warn", "log"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  permissionRow = row("teacher");
  usersByEmail = [];
  sessions = [];
  audits = [];
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    if (sql.includes('FROM "user"') && sql.includes("LOWER(email)")) return usersByEmail;
    return [];
  });
  mockClientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT[\s\S]*FROM ai_test_insight_sessions/.test(sql)) {
      // A submitted session of this Student by its id: id $1, student_id $2.
      expect(sql).toMatch(/WHERE id = \$1 AND student_id = \$2 AND state = 'submitted'/);
      return {
        rows: sessions
          .filter((s) => s.id === params[0] && s.student_id === params[1] && s.state === "submitted")
          .map((s) => ({ ...s })),
      };
    }
    if (/UPDATE ai_test_insight_sessions/.test(sql)) {
      // The author's submitted session of the Student at the expected revision, as the WHERE says.
      expect(sql).toMatch(
        /WHERE id = \$1 AND student_id = \$2 AND author_user_id = \$3 AND revision = \$4 AND state = 'submitted'/,
      );
      expect(sql).toMatch(/revision = revision \+ 1/);
      expect(sql).toMatch(/updated_at = \(now\(\) AT TIME ZONE 'UTC'\)/);
      // What the session records is kept: the SET names none of it.
      expect(sql).not.toMatch(/SET[\s\S]*(submitted_at|insight_request_id|school_id|program_id|academic_year|author_user_id|state =)[\s\S]*WHERE/);
      const [id, studentId, author, revision, date, areas, actions, other] = params as [
        number, number, number, number, string, string, string, string | null,
      ];
      const target = sessions.find(
        (s) =>
          s.id === id && s.student_id === studentId && s.author_user_id === author && s.revision === revision && s.state === "submitted",
      );
      if (!target) return { rows: [] };
      Object.assign(target, {
        session_date: date,
        areas_of_concern: areas,
        immediate_actions: actions,
        other_notes: other,
        updated_at: NOW,
        revision: target.revision + 1,
      });
      return { rows: [{ revision: target.revision }] };
    }
    if (/INSERT INTO ai_test_insight_session_note_audits/.test(sql)) {
      expect(sql).toMatch(/'submitted_edited'/);
      expect(sql).toContain("now() AT TIME ZONE 'UTC'");
      const [sessionId, actor, revision] = params as [number, number, number];
      audits.push({ session_id: sessionId, actor_user_id: actor, action: "submitted_edited", revision, occurred_at: NOW });
      return { rows: [] };
    }
    return { rows: [] };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function patch(studentId: string, sessionId: string, body: unknown) {
  return PATCH(
    new NextRequest(`http://localhost/api/ai-test-insights/students/${studentId}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ studentId, sessionId }) },
  );
}

describe("PATCH /api/ai-test-insights/students/[studentId]/sessions/[sessionId]", () => {
  describe("an edit", () => {
    it("saves the trimmed notes at the next revision, keeps what the session records, and answers 200 { revision }", async () => {
      sessions = [submitted()];

      const response = await patch("1001", "60", EDIT);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ revision: 3 });
      expect(sessions).toEqual([
        {
          id: 60,
          student_id: 1001,
          school_id: 5,
          program_id: 2,
          academic_year: "2025-2026",
          author_user_id: 777,
          state: "submitted",
          session_date: "2026-11-18",
          areas_of_concern: `Weak in ray optics ${MARKER}`,
          immediate_actions: `Three worksheets a week ${MARKER}`,
          other_notes: null,
          insight_request_id: 70,
          submitted_at: "submitted earlier",
          updated_at: NOW,
          revision: 3,
        },
      ]);
    });

    it("writes one submitted_edited audit row with the acting User and the new revision, and no note text", async () => {
      sessions = [submitted()];

      await patch("1001", "60", EDIT);

      expect(audits).toEqual([
        { session_id: 60, actor_user_id: 777, action: "submitted_edited", revision: 3, occurred_at: NOW },
      ]);
      const [[, auditParams]] = mockClientQuery.mock.calls.filter(([sql]) => /session_note_audits/.test(String(sql)));
      expect(JSON.stringify(auditParams)).not.toContain(MARKER);
    });

    it("keeps Other notes, trimmed, when it has text", async () => {
      sessions = [submitted()];

      await patch("1001", "60", { ...EDIT, otherNotes: "  Called home  " });

      expect(sessions[0].other_notes).toBe("Called home");
    });

    it("changes only the date when only the date changed", async () => {
      sessions = [submitted()];

      const response = await patch("1001", "60", { ...SAME_NOTES, sessionDate: "2026-11-27", expectedRevision: 2 });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ revision: 3 });
      expect(sessions[0]).toMatchObject({ session_date: "2026-11-27", areas_of_concern: "Weak in optics", revision: 3 });
      expect(audits).toHaveLength(1);
    });

    it("writes nothing and answers 200 with the same revision when nothing changed after trim", async () => {
      sessions = [submitted()];

      const response = await patch("1001", "60", { ...SAME_NOTES, expectedRevision: 2 });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ revision: 2 });
      expect(writes()).toHaveLength(0);
      expect(sessions).toEqual([submitted()]);
      expect(audits).toEqual([]);
    });

    it("counts a blank Other notes as no change from none", async () => {
      sessions = [submitted({ other_notes: null })];

      const response = await patch("1001", "60", { ...SAME_NOTES, otherNotes: " ", expectedRevision: 2 });

      expect(await response.json()).toEqual({ revision: 2 });
      expect(writes()).toHaveLength(0);
    });

    it("saves two edits in a row, each at the revision the last one answered", async () => {
      sessions = [submitted()];

      expect(await (await patch("1001", "60", EDIT)).json()).toEqual({ revision: 3 });
      const second = await patch("1001", "60", { ...EDIT, otherNotes: "Called home", expectedRevision: 3 });

      expect(await second.json()).toEqual({ revision: 4 });
      expect(audits.map((audit) => audit.revision)).toEqual([3, 4]);
    });
  });

  describe("not this Student's submitted session", () => {
    it.each([
      ["the caller's own draft", () => [submitted({ state: "draft", revision: 2 })], "60"],
      ["another Student's session", () => [submitted({ student_id: 2001 })], "60"],
      ["an unknown id", () => [submitted()], "61"],
      ["a malformed id", () => [submitted()], "abc"],
      ["an id of 0", () => [submitted()], "0"],
      ["a fractional id", () => [submitted()], "60.5"],
      ["a negative id", () => [submitted()], "-60"],
    ])("answers 404 for %s and writes nothing", async (_label, seed, sessionId) => {
      sessions = seed();
      const before = structuredClone(sessions);

      const response = await patch("1001", sessionId, EDIT);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Insight Session not found" });
      expect(writes()).toHaveLength(0);
      expect(sessions).toEqual(before);
    });
  });

  describe("not the author", () => {
    it("answers 403 for another Teacher's session and changes nothing", async () => {
      sessions = [submitted({ author_user_id: 888 })];

      const response = await patch("1001", "60", EDIT);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Only the author can edit these notes." });
      expect(writes()).toHaveLength(0);
      expect(sessions).toEqual([submitted({ author_user_id: 888 })]);
    });

    it("answers 403 before the revision check", async () => {
      sessions = [submitted({ author_user_id: 888, revision: 5 })];

      expect((await patch("1001", "60", EDIT)).status).toBe(403);
    });
  });

  describe("stale", () => {
    it("answers 409 stale with the session's current revision, and changes no row", async () => {
      sessions = [submitted({ revision: 4 })];

      const response = await patch("1001", "60", EDIT);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "These notes were changed in another tab.",
        code: "stale",
        currentRevision: 4,
      });
      expect(sessions).toEqual([submitted({ revision: 4 })]);
      expect(audits).toEqual([]);
    });

    it("refuses an older tab's edit after a newer one saved", async () => {
      sessions = [submitted()];

      await patch("1001", "60", EDIT);
      const older = await patch("1001", "60", { ...EDIT, areasOfConcern: "Older tab text" });

      expect(older.status).toBe(409);
      expect(await older.json()).toMatchObject({ code: "stale", currentRevision: 3 });
      expect(sessions[0].areas_of_concern).toBe(`Weak in ray optics ${MARKER}`);
      expect(audits).toHaveLength(1);
    });

    it("answers stale, not no change, when an older tab sends the notes as they now read", async () => {
      sessions = [submitted({ revision: 4 })];

      const response = await patch("1001", "60", { ...SAME_NOTES, expectedRevision: 2 });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "stale", currentRevision: 4 });
    });
  });

  describe("body rules", () => {
    it.each([
      ["Areas of concern blank", { ...EDIT, areasOfConcern: "" }, "areasOfConcern"],
      ["Areas of concern only whitespace", { ...EDIT, areasOfConcern: " \n " }, "areasOfConcern"],
      ["Areas of concern null", { ...EDIT, areasOfConcern: null }, "areasOfConcern"],
      ["Immediate actions blank", { ...EDIT, immediateActions: "   " }, "immediateActions"],
      ["Immediate actions null", { ...EDIT, immediateActions: null }, "immediateActions"],
      ["no date", { ...EDIT, sessionDate: null }, "sessionDate"],
      ["a date after today", { ...EDIT, sessionDate: "2026-11-28" }, "sessionDate"],
      ["an impossible date", { ...EDIT, sessionDate: "2026-02-30" }, "sessionDate"],
      ["a field over 2,000 characters", { ...EDIT, otherNotes: "a".repeat(2001) }, "otherNotes"],
      ["a text field that is a number", { ...EDIT, immediateActions: 7 }, "immediateActions"],
      ["an expectedRevision of 0", { ...EDIT, expectedRevision: 0 }, "expectedRevision"],
      ["a negative expectedRevision", { ...EDIT, expectedRevision: -1 }, "expectedRevision"],
      ["a fractional expectedRevision", { ...EDIT, expectedRevision: 1.5 }, "expectedRevision"],
      ["a string expectedRevision", { ...EDIT, expectedRevision: "2" }, "expectedRevision"],
      ["no expectedRevision", { ...SAME_NOTES, areasOfConcern: "New" }, "expectedRevision"],
    ])("answers 422 to %s, naming the field, and writes nothing", async (_label, body, field) => {
      sessions = [submitted()];

      const response = await patch("1001", "60", body);

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ field });
      expect(writes()).toHaveLength(0);
      expect(sessions).toEqual([submitted()]);
    });

    it("accepts a text field of exactly 2,000 characters", async () => {
      sessions = [submitted()];

      expect((await patch("1001", "60", { ...EDIT, otherNotes: "a".repeat(2000) })).status).toBe(200);
    });

    it.each([
      ["a body that is not an object", ["a"]],
      ["a body that is not JSON", "{not json"],
    ])("answers 422 to %s and writes nothing", async (_label, body) => {
      expect((await patch("1001", "60", body)).status).toBe(422);
      expect(writes()).toHaveLength(0);
    });

    it("checks the body before the session id", async () => {
      expect((await patch("1001", "abc", { ...EDIT, areasOfConcern: "" })).status).toBe(422);
    });
  });

  describe("today in India, from the server's clock", () => {
    it("refuses 28 Nov 2026 at 2026-11-27T18:29:59Z, still the 27th in India", async () => {
      vi.setSystemTime(new Date("2026-11-27T18:29:59Z"));
      sessions = [submitted()];

      const response = await patch("1001", "60", { ...EDIT, sessionDate: "2026-11-28" });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ field: "sessionDate" });
      expect(writes()).toHaveLength(0);
    });

    it("accepts 28 Nov 2026 at 2026-11-27T18:30:00Z, midnight in India", async () => {
      vi.setSystemTime(new Date("2026-11-27T18:30:00Z"));
      sessions = [submitted()];

      const response = await patch("1001", "60", { ...EDIT, sessionDate: "2026-11-28" });

      expect(response.status).toBe(200);
      expect(sessions[0].session_date).toBe("2026-11-28");
    });
  });

  describe("the actor's User", () => {
    it("edits as the User with the same email when the permission has no linked User", async () => {
      permissionRow = row("teacher", { user_id: null });
      usersByEmail = [{ id: "888" }];
      sessions = [submitted({ author_user_id: 888 })];

      expect((await patch("1001", "60", EDIT)).status).toBe(200);
      expect(audits).toEqual([
        { session_id: 60, actor_user_id: 888, action: "submitted_edited", revision: 3, occurred_at: NOW },
      ]);
    });

    it("answers 409 no_linked_user and writes nothing when there is no User, before the session id", async () => {
      permissionRow = row("teacher", { user_id: null });
      sessions = [submitted()];

      for (const sessionId of ["60", "abc", "61"]) {
        const response = await patch("1001", sessionId, EDIT);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "no_linked_user" });
      }
      expect(writes()).toHaveLength(0);
    });

    it("checks the body before the User", async () => {
      permissionRow = row("teacher", { user_id: null });

      expect((await patch("1001", "60", { ...EDIT, areasOfConcern: "" })).status).toBe(422);
    });
  });

  describe("refusal order", () => {
    it("answers 401 without a session, before checking the ids", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect((await patch("1001", "60", EDIT)).status).toBe(401);
      expect((await patch("abc", "abc", EDIT)).status).toBe(401);
      expect(writes()).toHaveLength(0);
    });

    it.each(["abc", "0", "-1", "1.5"])("answers 422 for the Student id %j, before the feature check", async (id) => {
      permissionRow = row("pmu_manager");

      expect((await patch(id, "60", EDIT)).status).toBe(422);
    });

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, whose role has no AI Test Insights view", async (role) => {
      permissionRow = row(role);
      sessions = [submitted()];

      expect((await patch("1001", "60", EDIT)).status).toBe(403);
      expect((await patch("9999", "60", EDIT)).status).toBe(403);
      expect(writes()).toHaveLength(0);
    });

    it.each(VIEWER_ROLES)("answers 403 to %s, a viewer, before the Student lookup, and changes nothing", async (role) => {
      permissionRow = row(role);
      sessions = [submitted()];

      expect((await patch("1001", "60", EDIT)).status).toBe(403);
      expect((await patch("9999", "60", EDIT)).status).toBe(403);
      expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("centre_students"))).toBe(false);
      expect(writes()).toHaveLength(0);
      expect(sessions).toEqual([submitted()]);
    });

    it("answers 403 to a read_only Teacher, even the author, before the Student lookup", async () => {
      permissionRow = row("teacher", { read_only: true });
      sessions = [submitted()];

      expect((await patch("1001", "60", EDIT)).status).toBe(403);
      expect((await patch("9999", "60", EDIT)).status).toBe(403);
      expect(writes()).toHaveLength(0);
      expect(sessions).toEqual([submitted()]);
    });

    it("answers 403 to a Teacher with only JNV NVS", async () => {
      permissionRow = row("teacher", { program_ids: [64] });

      expect((await patch("1001", "60", EDIT)).status).toBe(403);
    });

    it("answers 404 for a Student who does not exist, before the body rules", async () => {
      expect((await patch("9999", "60", EDIT)).status).toBe(404);
      expect((await patch("9999", "60", { ...EDIT, areasOfConcern: "" })).status).toBe(404);
      expect(writes()).toHaveLength(0);
    });

    it("answers 404 for a listed Student of another School, even for the caller's own session of them", async () => {
      sessions = [submitted({ student_id: 2001 })];

      expect((await patch("2001", "60", EDIT)).status).toBe(404);
      expect(writes()).toHaveLength(0);
    });
  });

  describe("logs", () => {
    const logged = () =>
      (["error", "info", "warn", "log"] as const)
        .flatMap((level) => vi.mocked(console[level]).mock.calls.flat())
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg)))
        .join(" ");

    it("answers 500 for a database error, logging only the Student's id, the session id and the error name", async () => {
      sessions = [submitted()];
      mockClientQuery.mockImplementation(async () => {
        throw Object.assign(new Error(`value too long: "${MARKER}"`), { name: "DatabaseError", code: "22001" });
      });

      const response = await patch("1001", "60", EDIT);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Session Notes could not be saved" });
      expect(logged()).toContain("student=1001");
      expect(logged()).toContain("session=60");
      expect(logged()).toContain("DatabaseError");
      expect(logged()).not.toContain(MARKER);
      expect(logged()).not.toContain(email);
    });

    it("logs no raw session id that is not an id", async () => {
      vi.mocked(mockQuery).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM user_permission")) return [row("teacher", { user_id: null })];
        if (sql.includes("centre_students")) return LISTED["1001"];
        if (sql.includes('FROM "user"')) throw Object.assign(new Error("boom"), { name: "DatabaseError" });
        return [];
      });

      const response = await patch("1001", `x${MARKER}`, EDIT);

      expect(response.status).toBe(500);
      expect(logged()).toContain("student=1001");
      expect(logged()).not.toContain(MARKER);
    });

    it("logs no note text on an edit, a stale edit, a refused body, a not-the-author or a not-found edit", async () => {
      sessions = [submitted()];

      await patch("1001", "60", EDIT);
      await patch("1001", "60", EDIT);
      await patch("1001", "60", { ...EDIT, sessionDate: "2026-12-01" });
      await patch("1001", "61", EDIT);
      sessions = [submitted({ author_user_id: 888 })];
      await patch("1001", "60", EDIT);

      expect(logged()).not.toContain(MARKER);
    });
  });
});
