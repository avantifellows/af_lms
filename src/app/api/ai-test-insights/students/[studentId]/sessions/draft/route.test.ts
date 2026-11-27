import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The Session Notes draft save (#574) through the real Student access helper,
// the real permission matrix, the real route opening and the real Session
// Notes module. The session and the Postgres boundary (`query()` and
// `withTransaction`) are stubbed: Postgres answers the permission row, centre
// seats, the listed-Student rows of one Student and the actor's User by
// email, as declared here, and holds `ai_test_insight_sessions` rows in
// `sessions`, applying each statement's guards as the SQL says.
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

import { PUT } from "./route";

const email = "staff@avantifellows.org";
const MARKER = "[marker-574-route]";

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

const VIEW_ONLY_ROLES = ["program_manager", "program_admin", "admin"] as const;
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
  revision: number;
};

let permissionRow: Record<string, unknown> | null;
let usersByEmail: Array<Record<string, unknown>>;
let sessions: SessionRow[];

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

/** A draft as Postgres holds it, of Student 1001 by User 777 unless overridden. */
function storedDraft(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 50,
    student_id: 1001,
    school_id: 9,
    program_id: 1,
    academic_year: "2026-2027",
    author_user_id: 777,
    state: "draft",
    session_date: "2026-11-20",
    areas_of_concern: "Older concern",
    immediate_actions: null,
    other_notes: null,
    revision: 3,
    ...overrides,
  };
}

const writes = () =>
  [...mockQuery.mock.calls, ...mockClientQuery.mock.calls].filter(([sql]) => /INSERT|UPDATE|DELETE/.test(String(sql)));

beforeEach(() => {
  vi.resetAllMocks();
  for (const level of ["error", "info", "warn", "log"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  permissionRow = row("teacher");
  usersByEmail = [];
  sessions = [];
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    if (sql.includes('FROM "user"') && sql.includes("LOWER(email)")) return usersByEmail;
    if (/SELECT[\s\S]*FROM ai_test_insight_sessions/.test(sql)) {
      // The caller's own draft of this Student: student_id $1, author $2.
      return sessions
        .filter((s) => s.student_id === params[0] && s.author_user_id === params[1] && s.state === "draft")
        .map((s) => ({ ...s }));
    }
    return [];
  });
  mockClientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO ai_test_insight_sessions/.test(sql)) {
      const [studentId, schoolId, programId, year, author, date, areas, actions, other] = params as [
        number, number, number, string, number, string | null, string | null, string | null, string | null,
      ];
      if (sessions.some((s) => s.author_user_id === author && s.student_id === studentId && s.state === "draft")) {
        throw Object.assign(new Error("duplicate key value violates unique constraint"), {
          name: "DatabaseError",
          code: "23505",
          constraint: "ati_sessions_author_student_draft_unique",
        });
      }
      const inserted: SessionRow = {
        id: 60 + sessions.length,
        student_id: studentId,
        school_id: schoolId,
        program_id: programId,
        academic_year: year,
        author_user_id: author,
        state: "draft",
        session_date: date,
        areas_of_concern: areas,
        immediate_actions: actions,
        other_notes: other,
        revision: 1,
      };
      sessions.push(inserted);
      expect(sql).toMatch(/RETURNING id, revision/);
      return { rows: [{ id: String(inserted.id), revision: 1 }] };
    }
    if (/UPDATE ai_test_insight_sessions/.test(sql)) {
      // The author's draft of the Student by its id, at the expected revision, as the WHERE says.
      const [studentId, author, revision, date, areas, actions, other, draftId] = params as [
        number, number, number, string | null, string | null, string | null, string | null, number,
      ];
      expect(sql).toMatch(/WHERE id = \$8 AND student_id = \$1 AND author_user_id = \$2 AND revision = \$3 AND state = 'draft'/);
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
        session_date: date,
        areas_of_concern: areas,
        immediate_actions: actions,
        other_notes: other,
        revision: target.revision + 1,
      });
      return { rows: [{ revision: target.revision }] };
    }
    return { rows: [] };
  });
});

const NOTES = {
  sessionDate: "2026-11-27",
  areasOfConcern: `Weak in rotational motion ${MARKER}`,
  immediateActions: `Two torque worksheets a week ${MARKER}`,
  otherNotes: "",
};

async function put(studentId: string, body: unknown, search = "") {
  return PUT(
    new NextRequest(`http://localhost/api/ai-test-insights/students/${studentId}/sessions/draft${search}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ studentId }) },
  );
}

describe("PUT /api/ai-test-insights/students/[studentId]/sessions/draft", () => {
  describe("the first save", () => {
    it("inserts the Teacher's draft at revision 1 with the centre's School and Program and this year, and answers 200 { revision: 1 }", async () => {
      const response = await put("1001", { ...NOTES, draftId: null, expectedRevision: 0 });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ draftId: 60, revision: 1 });
      expect(sessions).toEqual([
        {
          id: 60,
          student_id: 1001,
          school_id: 9,
          program_id: 1,
          academic_year: "2026-2027",
          author_user_id: 777,
          state: "draft",
          session_date: "2026-11-27",
          areas_of_concern: `Weak in rotational motion ${MARKER}`,
          immediate_actions: `Two torque worksheets a week ${MARKER}`,
          other_notes: null,
          revision: 1,
        },
      ]);
    });

    it("writes its times as UTC", async () => {
      await put("1001", { ...NOTES, expectedRevision: 0 });

      const [[sql]] = mockClientQuery.mock.calls.filter(([text]) => /INSERT INTO ai_test_insight_sessions/.test(text));
      expect(sql).toContain("now() AT TIME ZONE 'UTC'");
      expect(sql).not.toMatch(/now\(\)(?! AT TIME ZONE 'UTC')/);
    });

    it("uses the centre the page names for the School and Program", async () => {
      await put("1001", { ...NOTES, expectedRevision: 0 }, "?centre=302");

      expect(sessions[0]).toMatchObject({ school_id: 9, program_id: 2 });
    });

    it("stores the text exactly as typed, a blank field as null, and no date as null", async () => {
      await put("1001", {
        sessionDate: null,
        areasOfConcern: "  two spaces either side  ",
        immediateActions: "   ",
        otherNotes: "line one\nline two",
        expectedRevision: 0,
      });

      expect(sessions[0]).toMatchObject({
        session_date: null,
        areas_of_concern: "  two spaces either side  ",
        immediate_actions: null,
        other_notes: "line one\nline two",
      });
    });

    it("writes nothing and answers revision 0 while all three text fields are blank", async () => {
      const response = await put("1001", {
        sessionDate: "2026-11-27",
        areasOfConcern: "",
        immediateActions: " \n ",
        otherNotes: null,
        expectedRevision: 0,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ draftId: null, revision: 0 });
      expect(writes()).toHaveLength(0);
    });

    it("answers 409 stale with the existing draft's revision when the Teacher already has a draft", async () => {
      sessions = [storedDraft({ revision: 4 })];

      const response = await put("1001", { ...NOTES, expectedRevision: 0 });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "These notes were changed in another tab.",
        code: "stale",
        currentRevision: 4,
      });
      expect(sessions).toEqual([storedDraft({ revision: 4 })]);
    });

    it("writes no audit row", async () => {
      await put("1001", { ...NOTES, expectedRevision: 0 });

      expect(writes().filter(([sql]) => String(sql).includes("audits"))).toHaveLength(0);
    });
  });

  describe("a later save", () => {
    it("updates the Teacher's draft at the expected revision, moves it to the next revision and sets updated_at", async () => {
      sessions = [storedDraft({ revision: 3 })];

      const response = await put("1001", { ...NOTES, otherNotes: "Parents informed", draftId: 50, expectedRevision: 3 });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ draftId: 50, revision: 4 });
      expect(sessions).toEqual([
        storedDraft({
          session_date: "2026-11-27",
          areas_of_concern: `Weak in rotational motion ${MARKER}`,
          immediate_actions: `Two torque worksheets a week ${MARKER}`,
          other_notes: "Parents informed",
          revision: 4,
        }),
      ]);
      const [[sql]] = mockClientQuery.mock.calls.filter(([text]) => /UPDATE ai_test_insight_sessions/.test(text));
      expect(sql).toMatch(/revision = revision \+ 1/);
      expect(sql).toMatch(/updated_at = \(now\(\) AT TIME ZONE 'UTC'\)/);
    });

    it("keeps the fields blank as null when the Teacher clears them all", async () => {
      sessions = [storedDraft({ revision: 2 })];

      const response = await put("1001", {
        sessionDate: null,
        areasOfConcern: "",
        immediateActions: "",
        otherNotes: "",
        draftId: 50,
        expectedRevision: 2,
      });

      expect(await response.json()).toEqual({ draftId: 50, revision: 3 });
      expect(sessions[0]).toMatchObject({
        session_date: null,
        areas_of_concern: null,
        immediate_actions: null,
        other_notes: null,
        revision: 3,
      });
    });

    it("answers 409 stale with the current revision and changes no row when the revision is older", async () => {
      sessions = [storedDraft({ revision: 5 })];

      const response = await put("1001", { ...NOTES, draftId: 50, expectedRevision: 4 });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "These notes were changed in another tab.",
        code: "stale",
        currentRevision: 5,
      });
      expect(sessions).toEqual([storedDraft({ revision: 5 })]);
    });

    it("answers 409 stale with revision 0 when the Teacher has no draft any more", async () => {
      sessions = [storedDraft({ state: "submitted", revision: 2 })];

      const response = await put("1001", { ...NOTES, draftId: 50, expectedRevision: 2 });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "stale", currentRevision: 0 });
      expect(sessions[0]).toMatchObject({ state: "submitted", revision: 2, areas_of_concern: "Older concern" });
    });

    it("never touches another Teacher's draft of the same Student", async () => {
      sessions = [storedDraft({ author_user_id: 888, revision: 1 })];

      const response = await put("1001", { ...NOTES, draftId: 50, expectedRevision: 1 });

      expect(response.status).toBe(409);
      expect(sessions).toEqual([storedDraft({ author_user_id: 888, revision: 1 })]);
    });

    it("answers 409 stale and never touches the next draft when a tab still holds a draft already submitted", async () => {
      // Tab 1 submitted draft 50 at revision 1 and began draft 51, also at
      // revision 1. Tab 2 still holds draft 50 at revision 1.
      const submitted = storedDraft({ id: 50, state: "submitted", revision: 2 });
      const next = storedDraft({ id: 51, revision: 1, areas_of_concern: `Next conversation ${MARKER}` });
      sessions = [submitted, next];

      const response = await put("1001", { ...NOTES, draftId: 50, expectedRevision: 1 });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "stale", currentRevision: 1 });
      expect(sessions).toEqual([
        storedDraft({ id: 50, state: "submitted", revision: 2 }),
        storedDraft({ id: 51, revision: 1, areas_of_concern: `Next conversation ${MARKER}` }),
      ]);
    });
  });

  describe("the actor's User", () => {
    it("uses the User with the same email when the permission has no linked User", async () => {
      permissionRow = row("teacher", { user_id: null });
      usersByEmail = [{ id: "888" }];

      await put("1001", { ...NOTES, expectedRevision: 0 });

      expect(sessions[0].author_user_id).toBe(888);
    });

    it("answers 409 no_linked_user and writes nothing when there is no User", async () => {
      permissionRow = row("teacher", { user_id: null });

      const response = await put("1001", { ...NOTES, expectedRevision: 0 });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "no_linked_user" });
      expect(writes()).toHaveLength(0);
    });

    it("checks the body before the User", async () => {
      permissionRow = row("teacher", { user_id: null });

      expect((await put("1001", { ...NOTES, expectedRevision: -1 })).status).toBe(422);
    });
  });

  describe("body rules", () => {
    it("accepts a text field of exactly 2,000 characters", async () => {
      const response = await put("1001", { ...NOTES, otherNotes: "a".repeat(2000), expectedRevision: 0 });

      expect(response.status).toBe(200);
      expect(sessions[0].other_notes).toHaveLength(2000);
    });

    it.each([
      ["a field over 2,000 characters", { ...NOTES, areasOfConcern: "a".repeat(2001), expectedRevision: 0 }, "areasOfConcern"],
      ["an impossible date", { ...NOTES, sessionDate: "2026-02-30", expectedRevision: 0 }, "sessionDate"],
      ["a date in another format", { ...NOTES, sessionDate: "27-11-2026", expectedRevision: 0 }, "sessionDate"],
      ["a text field that is a number", { ...NOTES, immediateActions: 7, expectedRevision: 0 }, "immediateActions"],
      ["a missing text field", { sessionDate: null, areasOfConcern: "a", immediateActions: null, expectedRevision: 0 }, "otherNotes"],
      ["a negative expectedRevision", { ...NOTES, expectedRevision: -1 }, "expectedRevision"],
      ["a fractional expectedRevision", { ...NOTES, expectedRevision: 1.5 }, "expectedRevision"],
      ["a string expectedRevision", { ...NOTES, expectedRevision: "1" }, "expectedRevision"],
      ["no expectedRevision", { ...NOTES }, "expectedRevision"],
      ["no draftId for a saved draft", { ...NOTES, expectedRevision: 2 }, "draftId"],
      ["a null draftId for a saved draft", { ...NOTES, draftId: null, expectedRevision: 2 }, "draftId"],
      ["a draftId with expectedRevision 0", { ...NOTES, draftId: 50, expectedRevision: 0 }, "draftId"],
      ["a string draftId", { ...NOTES, draftId: "50", expectedRevision: 2 }, "draftId"],
      ["a draftId of 0", { ...NOTES, draftId: 0, expectedRevision: 2 }, "draftId"],
    ])("answers 422 to %s, naming the field, and writes nothing", async (_label, body, field) => {
      const response = await put("1001", body);

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ field });
      expect(writes()).toHaveLength(0);
    });

    it.each([
      ["a body that is not an object", ["a"]],
      ["a body that is not JSON", "{not json"],
    ])("answers 422 to %s and writes nothing", async (_label, body) => {
      expect((await put("1001", body)).status).toBe(422);
      expect(writes()).toHaveLength(0);
    });
  });

  describe("refusal order", () => {
    it("answers 401 without a session, before checking the id", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect((await put("1001", { ...NOTES, expectedRevision: 0 })).status).toBe(401);
      expect((await put("abc", { ...NOTES, expectedRevision: 0 })).status).toBe(401);
      expect(writes()).toHaveLength(0);
    });

    it.each(["abc", "0", "-1", "1.5"])("answers 422 for the id %j, before the feature check", async (id) => {
      permissionRow = row("pmu_manager");

      expect((await put(id, { ...NOTES, expectedRevision: 0 })).status).toBe(422);
    });

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, whose role has no AI Test Insights view", async (role) => {
      permissionRow = row(role);

      expect((await put("1001", { ...NOTES, expectedRevision: 0 })).status).toBe(403);
      expect((await put("9999", { ...NOTES, expectedRevision: 0 })).status).toBe(403);
      expect(writes()).toHaveLength(0);
    });

    it.each([...VIEW_ONLY_ROLES])("answers 403 to %s, a viewer, before the Student lookup", async (role) => {
      permissionRow = row(role);

      expect((await put("1001", { ...NOTES, expectedRevision: 0 })).status).toBe(403);
      expect((await put("9999", { ...NOTES, expectedRevision: 0 })).status).toBe(403);
      expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("centre_students"))).toBe(false);
      expect(writes()).toHaveLength(0);
    });

    it("answers 403 to a read_only Teacher, before the Student lookup", async () => {
      permissionRow = row("teacher", { read_only: true });

      expect((await put("1001", { ...NOTES, expectedRevision: 0 })).status).toBe(403);
      expect((await put("9999", { ...NOTES, expectedRevision: 0 })).status).toBe(403);
      expect(writes()).toHaveLength(0);
    });

    it("answers 403 to a Teacher with only JNV NVS", async () => {
      permissionRow = row("teacher", { program_ids: [64] });

      expect((await put("1001", { ...NOTES, expectedRevision: 0 })).status).toBe(403);
    });

    it("answers 404 for a Student who does not exist, before the body rules", async () => {
      expect((await put("9999", { ...NOTES, expectedRevision: 0 })).status).toBe(404);
      expect((await put("9999", { ...NOTES, expectedRevision: -1 })).status).toBe(404);
      expect(writes()).toHaveLength(0);
    });

    it("answers 404 for a listed Student of another School", async () => {
      expect((await put("2001", { ...NOTES, expectedRevision: 0 })).status).toBe(404);
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
      mockClientQuery.mockImplementation(async () => {
        throw Object.assign(new Error(`value too long: "${MARKER}"`), { name: "DatabaseError", code: "22001" });
      });

      const response = await put("1001", { ...NOTES, expectedRevision: 0 });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Session Notes could not be saved" });
      expect(logged()).toContain("1001");
      expect(logged()).toContain("DatabaseError");
      expect(logged()).not.toContain(MARKER);
      expect(logged()).not.toContain(email);
    });

    it("answers the usual JSON 500 when the access check fails on the database, logging the Student as unresolved", async () => {
      mockQuery.mockImplementation(async () => {
        throw Object.assign(new Error(`connection reset near "${MARKER}"`), { name: "DatabaseError", code: "08006" });
      });

      const response = await put("1001", { ...NOTES, expectedRevision: 0 });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Session Notes could not be saved" });
      expect(vi.mocked(console.error).mock.calls).toEqual([
        ["AI Test Insights session draft save failed: student=unresolved status=500 error=DatabaseError"],
      ]);
      expect(logged()).not.toContain(MARKER);
      expect(writes()).toHaveLength(0);
    });

    it("logs no note text on a save, a stale save or a refused body", async () => {
      await put("1001", { ...NOTES, expectedRevision: 0 });
      await put("1001", { ...NOTES, expectedRevision: 0 });
      await put("1001", { ...NOTES, areasOfConcern: `${MARKER}${"a".repeat(2001)}`, expectedRevision: 1 });

      expect(logged()).not.toContain(MARKER);
    });
  });
});
