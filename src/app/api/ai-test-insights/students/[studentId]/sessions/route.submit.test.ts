import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Submit of Session Notes (#575), `POST …/students/[studentId]/sessions`,
// through the real Student access helper, the real permission matrix, the
// real route opening and the real Session Notes module. (The same route
// file's GET is tested in `route.test.ts`.) The session and the Postgres
// boundary (`query()` and `withTransaction`) are stubbed: Postgres answers the
// permission row, centre seats, the listed-Student rows of one Student and the
// actor's User by email, as declared here, and holds the
// `ai_test_insight_sessions`, `ai_test_insight_requests` and
// `ai_test_insight_session_note_audits` rows in `sessions`, `requests` and
// `audits`, applying each statement's guards as the SQL says. The clock is
// fixed: today in India is 27 Nov 2026 unless a test moves it.
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

import { POST } from "./route";

const email = "staff@avantifellows.org";
const MARKER = "[marker-575-submit]";
/** What the stub stores for `now() AT TIME ZONE 'UTC'`. */
const NOW = "now (UTC)";

// Student 1001 is listed by centre 301 (School 9, Program 1) and by centre
// 302 (same School, Program 2). 2001 is listed by centre 401 of another
// School, JNV002.
const LISTED: Record<string, Array<Record<string, unknown>>> = {
  "1001": [
    {
      student_id: "1001", user_id: "5001", centre_id: "301", program_id: "1", grade: 11,
      school_id: "9", school_code: "JNV001", school_udise: "29000000001", school_region: "South",
    },
    {
      student_id: "1001", user_id: "5001", centre_id: "302", program_id: "2", grade: 11,
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
type RequestRow = { id: number; request_key: string; student_id: number; state: string };
type AuditRow = { session_id: number; actor_user_id: number; action: string; revision: number; occurred_at: string };

let permissionRow: Record<string, unknown> | null;
let usersByEmail: Array<Record<string, unknown>>;
let sessions: SessionRow[];
let requests: RequestRow[];
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
 * Teacher 777's draft of Student 1001 at revision 3, saved last year from
 * centre 302 (Program 2), with text that still has its spaces.
 */
function storedDraft(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 50,
    student_id: 1001,
    school_id: 9,
    program_id: 2,
    academic_year: "2025-2026",
    author_user_id: 777,
    state: "draft",
    session_date: "2026-11-20",
    areas_of_concern: "Older concern",
    immediate_actions: null,
    other_notes: null,
    insight_request_id: null,
    submitted_at: null,
    updated_at: "earlier",
    revision: 3,
    ...overrides,
  };
}

const NOTES = {
  sessionDate: "2026-11-26",
  areasOfConcern: `  Weak in rotational motion ${MARKER}  `,
  immediateActions: `\nTwo torque worksheets a week ${MARKER}\n`,
  otherNotes: "   ",
};

const writes = () =>
  [...mockQuery.mock.calls, ...mockClientQuery.mock.calls].filter(([sql]) => /INSERT|UPDATE|DELETE/.test(String(sql)));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
  for (const level of ["error", "info", "warn", "log"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  permissionRow = row("teacher");
  usersByEmail = [];
  sessions = [];
  audits = [];
  requests = [
    { id: 70, request_key: "req-completed-1001", student_id: 1001, state: "completed" },
    { id: 71, request_key: "req-failed-1001", student_id: 1001, state: "failed" },
    { id: 72, request_key: "req-running-1001", student_id: 1001, state: "running" },
    { id: 73, request_key: "req-queued-1001", student_id: 1001, state: "queued" },
    { id: 74, request_key: "req-no-data-1001", student_id: 1001, state: "no_data" },
    { id: 80, request_key: "req-completed-2001", student_id: 2001, state: "completed" },
  ];
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    if (sql.includes('FROM "user"') && sql.includes("LOWER(email)")) return usersByEmail;
    if (/SELECT[\s\S]*FROM ai_test_insight_sessions/.test(sql)) {
      // The caller's own draft of this Student: student_id $1, author $2.
      expect(sql).toMatch(/student_id = \$1 AND author_user_id = \$2 AND state = 'draft'/);
      return sessions
        .filter((s) => s.student_id === params[0] && s.author_user_id === params[1] && s.state === "draft")
        .map((s) => ({ ...s }));
    }
    return [];
  });
  mockClientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT[\s\S]*FROM ai_test_insight_requests/.test(sql)) {
      // A completed request of this Student by its key: student_id $1, request_key $2.
      expect(sql).toMatch(/student_id = \$1 AND request_key = \$2 AND state = 'completed'/);
      return {
        rows: requests
          .filter((r) => r.student_id === params[0] && r.request_key === params[1] && r.state === "completed")
          .map((r) => ({ id: String(r.id) })),
      };
    }
    if (/UPDATE ai_test_insight_sessions/.test(sql)) {
      // The author's draft of the Student by its id, at the expected revision, as the WHERE says.
      expect(sql).toMatch(
        /WHERE id = \$12 AND student_id = \$1 AND author_user_id = \$2 AND revision = \$3 AND state = 'draft'/,
      );
      expect(sql).toMatch(/state = 'submitted'/);
      expect(sql).toMatch(/revision = revision \+ 1/);
      expect(sql).toMatch(/submitted_at = \(now\(\) AT TIME ZONE 'UTC'\)/);
      expect(sql).toMatch(/updated_at = \(now\(\) AT TIME ZONE 'UTC'\)/);
      const [studentId, author, revision, date, areas, actions, other, requestId, schoolId, programId, year, draftId] =
        params as [number, number, number, string, string, string, string | null, number | null, number, number, string, number];
      const target = sessions.find(
        (s) =>
          s.id === draftId &&
          s.student_id === studentId &&
          s.author_user_id === author &&
          s.revision === revision &&
          s.state === "draft",
      );
      if (!target) return { rows: [] };
      Object.assign(target, {
        state: "submitted",
        session_date: date,
        areas_of_concern: areas,
        immediate_actions: actions,
        other_notes: other,
        insight_request_id: requestId,
        school_id: schoolId,
        program_id: programId,
        academic_year: year,
        submitted_at: NOW,
        updated_at: NOW,
        revision: target.revision + 1,
      });
      return { rows: [{ id: String(target.id), revision: target.revision }] };
    }
    if (/INSERT INTO ai_test_insight_session_note_audits/.test(sql)) {
      expect(sql).toMatch(/'submitted'/);
      expect(sql).toContain("now() AT TIME ZONE 'UTC'");
      const [sessionId, actor, revision] = params as [number, number, number];
      audits.push({ session_id: sessionId, actor_user_id: actor, action: "submitted", revision, occurred_at: NOW });
      return { rows: [] };
    }
    return { rows: [] };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function post(studentId: string, body: unknown, search = "") {
  return POST(
    new NextRequest(`http://localhost/api/ai-test-insights/students/${studentId}/sessions${search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ studentId }) },
  );
}

const SUBMIT = { ...NOTES, draftId: 50, expectedRevision: 3, openRequestKey: "req-completed-1001" };

describe("POST /api/ai-test-insights/students/[studentId]/sessions", () => {
  describe("a submit", () => {
    it("turns the Teacher's draft into a submitted Insight Session linked to the open AI Summary, and answers 201 { sessionId, revision }", async () => {
      sessions = [storedDraft()];

      const response = await post("1001", SUBMIT);

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ sessionId: 50, revision: 4 });
      expect(sessions).toEqual([
        {
          id: 50,
          student_id: 1001,
          school_id: 9,
          program_id: 1,
          academic_year: "2026-2027",
          author_user_id: 777,
          state: "submitted",
          session_date: "2026-11-26",
          areas_of_concern: `Weak in rotational motion ${MARKER}`,
          immediate_actions: `Two torque worksheets a week ${MARKER}`,
          other_notes: null,
          insight_request_id: 70,
          submitted_at: NOW,
          updated_at: NOW,
          revision: 4,
        },
      ]);
    });

    it("writes one submitted audit row with the acting User and the new revision, and no note text", async () => {
      sessions = [storedDraft()];

      await post("1001", SUBMIT);

      expect(audits).toEqual([{ session_id: 50, actor_user_id: 777, action: "submitted", revision: 4, occurred_at: NOW }]);
      const [[, auditParams]] = mockClientQuery.mock.calls.filter(([sql]) => /session_note_audits/.test(String(sql)));
      expect(JSON.stringify(auditParams)).not.toContain(MARKER);
    });

    it("links nothing when no AI Summary is open", async () => {
      sessions = [storedDraft()];

      const response = await post("1001", { ...SUBMIT, openRequestKey: null });

      expect(response.status).toBe(201);
      expect(sessions[0]).toMatchObject({ state: "submitted", insight_request_id: null });
    });

    it("keeps Other notes, trimmed, when it has text", async () => {
      sessions = [storedDraft()];

      await post("1001", { ...SUBMIT, otherNotes: "  Parents informed  " });

      expect(sessions[0].other_notes).toBe("Parents informed");
    });

    it("records the School and Program of the centre the page names", async () => {
      sessions = [storedDraft({ program_id: 1 })];

      await post("1001", SUBMIT, "?centre=302");

      expect(sessions[0]).toMatchObject({ school_id: 9, program_id: 2, state: "submitted" });
    });

    it("accepts the date today in India", async () => {
      sessions = [storedDraft()];

      expect((await post("1001", { ...SUBMIT, sessionDate: "2026-11-27" })).status).toBe(201);
    });
  });

  describe("stale", () => {
    it("answers 409 stale with currentRevision 0 when the Teacher has no saved draft, and writes nothing", async () => {
      const response = await post("1001", SUBMIT);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "These notes were changed in another tab.",
        code: "stale",
        currentRevision: 0,
      });
      expect(audits).toEqual([]);
    });

    it("answers 409 stale with the draft's revision when it is at another one, and changes no row", async () => {
      sessions = [storedDraft({ revision: 5 })];

      const response = await post("1001", SUBMIT);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "stale", currentRevision: 5 });
      expect(sessions).toEqual([storedDraft({ revision: 5 })]);
      expect(audits).toEqual([]);
    });

    it("never makes a second session from a second press of Submit", async () => {
      sessions = [storedDraft()];

      const first = await post("1001", SUBMIT);
      const second = await post("1001", SUBMIT);

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: "stale", currentRevision: 0 });
      expect(sessions).toHaveLength(1);
      expect(audits).toHaveLength(1);
    });

    it("answers 409 stale and makes no second session when a tab still holds a draft already submitted", async () => {
      // Tab 1 submitted draft 50 at revision 1 and began draft 51, also at
      // revision 1. Tab 2 still holds draft 50 at revision 1 and presses Submit.
      const submitted = storedDraft({ id: 50, state: "submitted", revision: 2 });
      const next = storedDraft({ id: 51, revision: 1, areas_of_concern: `Next conversation ${MARKER}` });
      sessions = [submitted, next];

      const response = await post("1001", { ...SUBMIT, expectedRevision: 1 });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "stale", currentRevision: 1 });
      expect(sessions).toEqual([
        storedDraft({ id: 50, state: "submitted", revision: 2 }),
        storedDraft({ id: 51, revision: 1, areas_of_concern: `Next conversation ${MARKER}` }),
      ]);
      expect(audits).toEqual([]);
    });

    it("never submits another Teacher's draft of the same Student", async () => {
      sessions = [storedDraft({ author_user_id: 888 })];

      expect((await post("1001", SUBMIT)).status).toBe(409);
      expect(sessions).toEqual([storedDraft({ author_user_id: 888 })]);
    });
  });

  describe("the open request key", () => {
    it.each([
      ["another Student's completed request", "req-completed-2001"],
      ["an unknown key", "req-unknown"],
      ["a failed request", "req-failed-1001"],
      ["a running request", "req-running-1001"],
      ["a queued request", "req-queued-1001"],
      ["a no_data request", "req-no-data-1001"],
    ])("answers 422 for %s, naming openRequestKey, and stores nothing", async (_label, openRequestKey) => {
      sessions = [storedDraft()];

      const response = await post("1001", { ...SUBMIT, openRequestKey });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ field: "openRequestKey" });
      expect(sessions).toEqual([storedDraft()]);
      expect(audits).toEqual([]);
    });
  });

  describe("body rules", () => {
    it.each([
      ["Areas of concern blank", { ...SUBMIT, areasOfConcern: "" }, "areasOfConcern"],
      ["Areas of concern only whitespace", { ...SUBMIT, areasOfConcern: " \n " }, "areasOfConcern"],
      ["Areas of concern null", { ...SUBMIT, areasOfConcern: null }, "areasOfConcern"],
      ["Immediate actions blank", { ...SUBMIT, immediateActions: "   " }, "immediateActions"],
      ["Immediate actions null", { ...SUBMIT, immediateActions: null }, "immediateActions"],
      ["no date", { ...SUBMIT, sessionDate: null }, "sessionDate"],
      ["a date after today", { ...SUBMIT, sessionDate: "2026-11-28" }, "sessionDate"],
      ["an impossible date", { ...SUBMIT, sessionDate: "2026-02-30" }, "sessionDate"],
      ["a field over 2,000 characters", { ...SUBMIT, otherNotes: "a".repeat(2001) }, "otherNotes"],
      ["a text field that is a number", { ...SUBMIT, immediateActions: 7 }, "immediateActions"],
      ["an expectedRevision of 0", { ...SUBMIT, expectedRevision: 0 }, "expectedRevision"],
      ["a negative expectedRevision", { ...SUBMIT, expectedRevision: -1 }, "expectedRevision"],
      ["a fractional expectedRevision", { ...SUBMIT, expectedRevision: 1.5 }, "expectedRevision"],
      ["a string expectedRevision", { ...SUBMIT, expectedRevision: "3" }, "expectedRevision"],
      ["no expectedRevision", { ...NOTES, openRequestKey: null }, "expectedRevision"],
      ["no draftId", { ...NOTES, expectedRevision: 3, openRequestKey: null }, "draftId"],
      ["a null draftId", { ...SUBMIT, draftId: null }, "draftId"],
      ["a string draftId", { ...SUBMIT, draftId: "50" }, "draftId"],
      ["a fractional draftId", { ...SUBMIT, draftId: 50.5 }, "draftId"],
      ["no openRequestKey", { ...NOTES, draftId: 50, expectedRevision: 3 }, "openRequestKey"],
      ["an openRequestKey that is a number", { ...SUBMIT, openRequestKey: 70 }, "openRequestKey"],
      ["an empty openRequestKey", { ...SUBMIT, openRequestKey: "" }, "openRequestKey"],
      ["an openRequestKey of 201 characters", { ...SUBMIT, openRequestKey: "k".repeat(201) }, "openRequestKey"],
    ])("answers 422 to %s, naming the field, and writes nothing", async (_label, body, field) => {
      sessions = [storedDraft()];

      const response = await post("1001", body);

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ field });
      expect(writes()).toHaveLength(0);
      expect(sessions).toEqual([storedDraft()]);
    });

    it("accepts a text field of exactly 2,000 characters", async () => {
      sessions = [storedDraft()];

      expect((await post("1001", { ...SUBMIT, otherNotes: "a".repeat(2000) })).status).toBe(201);
    });

    it.each([
      ["a body that is not an object", ["a"]],
      ["a body that is not JSON", "{not json"],
    ])("answers 422 to %s and writes nothing", async (_label, body) => {
      expect((await post("1001", body)).status).toBe(422);
      expect(writes()).toHaveLength(0);
    });
  });

  describe("today in India, from the server's clock", () => {
    it("refuses 28 Nov 2026 at 2026-11-27T18:29:59Z, still the 27th in India", async () => {
      vi.setSystemTime(new Date("2026-11-27T18:29:59Z"));
      sessions = [storedDraft()];

      const response = await post("1001", { ...SUBMIT, sessionDate: "2026-11-28" });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ field: "sessionDate" });
      expect(writes()).toHaveLength(0);
    });

    it("accepts 28 Nov 2026 at 2026-11-27T18:30:00Z, midnight in India", async () => {
      vi.setSystemTime(new Date("2026-11-27T18:30:00Z"));
      sessions = [storedDraft()];

      const response = await post("1001", { ...SUBMIT, sessionDate: "2026-11-28" });

      expect(response.status).toBe(201);
      expect(sessions[0]).toMatchObject({ state: "submitted", session_date: "2026-11-28" });
    });
  });

  describe("the actor's User", () => {
    it("submits as the User with the same email when the permission has no linked User", async () => {
      permissionRow = row("teacher", { user_id: null });
      usersByEmail = [{ id: "888" }];
      sessions = [storedDraft({ author_user_id: 888 })];

      expect((await post("1001", SUBMIT)).status).toBe(201);
      expect(audits).toEqual([{ session_id: 50, actor_user_id: 888, action: "submitted", revision: 4, occurred_at: NOW }]);
    });

    it("answers 409 no_linked_user and writes nothing when there is no User", async () => {
      permissionRow = row("teacher", { user_id: null });

      const response = await post("1001", SUBMIT);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "no_linked_user" });
      expect(writes()).toHaveLength(0);
    });

    it("checks the body before the User", async () => {
      permissionRow = row("teacher", { user_id: null });

      expect((await post("1001", { ...SUBMIT, areasOfConcern: "" })).status).toBe(422);
    });
  });

  describe("refusal order", () => {
    it("answers 401 without a session, before checking the id", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect((await post("1001", SUBMIT)).status).toBe(401);
      expect((await post("abc", SUBMIT)).status).toBe(401);
      expect(writes()).toHaveLength(0);
    });

    it.each(["abc", "0", "-1", "1.5"])("answers 422 for the id %j, before the feature check", async (id) => {
      permissionRow = row("pmu_manager");

      expect((await post(id, SUBMIT)).status).toBe(422);
    });

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, whose role has no AI Test Insights view", async (role) => {
      permissionRow = row(role);

      expect((await post("1001", SUBMIT)).status).toBe(403);
      expect((await post("9999", SUBMIT)).status).toBe(403);
      expect(writes()).toHaveLength(0);
    });

    it.each(VIEWER_ROLES)("answers 403 to %s, a viewer, before the Student lookup", async (role) => {
      permissionRow = row(role);
      sessions = [storedDraft()];

      expect((await post("1001", SUBMIT)).status).toBe(403);
      expect((await post("9999", SUBMIT)).status).toBe(403);
      expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("centre_students"))).toBe(false);
      expect(writes()).toHaveLength(0);
    });

    it("answers 403 to a read_only Teacher, before the Student lookup", async () => {
      permissionRow = row("teacher", { read_only: true });
      sessions = [storedDraft()];

      expect((await post("1001", SUBMIT)).status).toBe(403);
      expect((await post("9999", SUBMIT)).status).toBe(403);
      expect(writes()).toHaveLength(0);
    });

    it("answers 403 to a Teacher with only JNV NVS", async () => {
      permissionRow = row("teacher", { program_ids: [64] });

      expect((await post("1001", SUBMIT)).status).toBe(403);
    });

    it("answers 404 for a Student who does not exist, before the body rules", async () => {
      expect((await post("9999", SUBMIT)).status).toBe(404);
      expect((await post("9999", { ...SUBMIT, areasOfConcern: "" })).status).toBe(404);
      expect(writes()).toHaveLength(0);
    });

    it("answers 404 for a listed Student of another School", async () => {
      expect((await post("2001", { ...SUBMIT, openRequestKey: "req-completed-2001" })).status).toBe(404);
      expect(writes()).toHaveLength(0);
    });
  });

  describe("logs", () => {
    const logged = () =>
      (["error", "info", "warn", "log"] as const)
        .flatMap((level) => vi.mocked(console[level]).mock.calls.flat())
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg)))
        .join(" ");

    it("answers 500 for a database error, logging only the Student's id and the error name, never the notes", async () => {
      sessions = [storedDraft()];
      mockClientQuery.mockImplementation(async () => {
        throw Object.assign(new Error(`value too long: "${MARKER}"`), { name: "DatabaseError", code: "22001" });
      });

      const response = await post("1001", SUBMIT);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Session Notes could not be submitted" });
      expect(logged()).toContain("1001");
      expect(logged()).toContain("DatabaseError");
      expect(logged()).not.toContain(MARKER);
      expect(logged()).not.toContain(email);
    });

    it("logs no note text on a submit, a stale submit, a refused body or a refused key", async () => {
      sessions = [storedDraft()];

      await post("1001", SUBMIT);
      await post("1001", SUBMIT);
      await post("1001", { ...SUBMIT, sessionDate: "2026-12-01" });
      sessions = [storedDraft()];
      await post("1001", { ...SUBMIT, openRequestKey: "req-failed-1001" });

      expect(logged()).not.toContain(MARKER);
    });
  });
});
