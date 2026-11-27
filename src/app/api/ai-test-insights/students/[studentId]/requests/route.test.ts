import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The create route of the AI Summary card (#560) through the real Student
// access helper, the real permission matrix and the real Insight Request
// module. The session and the Postgres boundary (`query()` and
// `withTransaction`) are stubbed: Postgres answers the permission row, centre
// seats, the listed-Student rows of one Student, the actor's User by email,
// the Student's open request and the inserted row, as declared here. The
// requests the route inserts are kept, so the read after delivery (#562) and
// the guarded `enqueue_rejected` update see them. `fetch` stands in for AI
// Mentorship Guide's wake and enqueue endpoints, and `vi.stubEnv` for the
// delivery settings.
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

// Student 1001 is listed by centre 301 (School 9, JNV001, Program 1) and by
// centre 302 (same School, Program 2). 2001 is listed by centre 401 of
// another School, JNV002.
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

const ROLES = [
  "teacher",
  "program_manager",
  "program_admin",
  "holistic_mentorship_admin",
  "admin",
  "pmu_manager",
  "pmu_govt_school_user",
  "blended_mentor",
  "blended_admin",
  "alumni_manager",
] as const;
const VIEW_ONLY_ROLES = ["program_manager", "program_admin", "admin"] as const;
const NO_FEATURE_ROLES = ROLES.filter(
  (role) => role !== "teacher" && !(VIEW_ONLY_ROLES as readonly string[]).includes(role),
);

// A request row as Postgres returns the view read: `read_at` is the
// database's UTC clock at the read, one minute after the request was made.
const viewRow = (overrides: Record<string, unknown> = {}) => ({
  request_key: "4b0f5c1e-1111-4222-8333-944455556666",
  state: "queued",
  outcome_code: null,
  selected_test_ids: ["T9", "T4"],
  requested_at: "2026-11-27T05:30:00Z",
  requested_by_name: "Asha Teacher",
  finished_at: null,
  read_at: "2026-11-27T05:31:00Z",
  ...overrides,
});

let permissionRow: Record<string, unknown> | null;
let usersByEmail: Array<Record<string, unknown>>;
let openRequest: Record<string, unknown> | null;
/** Student 1001's ended requests, newest first, as Postgres holds them. */
let endedRequests: Array<Record<string, unknown>>;
/** The requests the route inserted, by request key, as Postgres holds them. */
let stored: Map<string, Record<string, unknown>>;

// The delivery settings of a configured environment, written by hand.
const ENQUEUE_URL = "https://guide.example.test/api/internal/insight-requests";
const ENQUEUE_SECRET = "enqueue-secret-e2e-1";
const WAKE_URL = "https://wake.example.test";
const mockFetch = vi.fn();

function configureDelivery(overrides: Record<string, string> = {}) {
  const settings: Record<string, string> = {
    AI_TEST_INSIGHTS_ENQUEUE_URL: ENQUEUE_URL,
    AI_TEST_INSIGHTS_ENQUEUE_SECRET: ENQUEUE_SECRET,
    AI_TEST_INSIGHTS_WAKE_URL: WAKE_URL,
    APP_ENV: "staging",
    ...overrides,
  };
  for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
}

/** The calls `fetch` received, as [url, init]. */
const fetchCalls = () => mockFetch.mock.calls as Array<[string, RequestInit]>;
const enqueueCalls = () => fetchCalls().filter(([url]) => url.endsWith("/enqueue"));
const wakeCalls = () => fetchCalls().filter(([url]) => url.endsWith("/start"));

/** Answers the enqueue call with this status and the wake call with 200. */
function guideAnswers(enqueueStatus: number) {
  mockFetch.mockImplementation(async (url: string) =>
    url.endsWith("/enqueue") ? new Response(null, { status: enqueueStatus }) : new Response(null, { status: 200 }),
  );
}

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

/** The INSERT statements the module ran, as [sql, params]. */
const inserts = () => mockClientQuery.mock.calls.filter(([sql]) => /INSERT INTO ai_test_insight_requests/.test(sql));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", mockFetch);
  configureDelivery();
  guideAnswers(202);
  permissionRow = row("teacher");
  usersByEmail = [];
  openRequest = null;
  endedRequests = [];
  stored = new Map();
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    if (sql.includes('FROM "user"') && sql.includes("LOWER(email)")) return usersByEmail;
    if (/UPDATE ai_test_insight_requests/.test(sql) && sql.includes("'enqueue_rejected'")) {
      // Postgres applies the update only where its guard holds.
      const target = stored.get(String(params[0]));
      const guarded = /state = 'queued'/.test(sql);
      if (!target || (guarded && target.state !== "queued")) return [];
      Object.assign(target, { state: "failed", outcome_code: "enqueue_rejected", finished_at: "2026-11-27T05:30:02Z" });
      return [target];
    }
    if (sql.includes("ai_test_insight_requests") && sql.includes("$2::jsonb")) {
      // Postgres applies the state filter and compares the two jsonb arrays
      // as the SQL says: `=` is the same ids in the same order; `@>` and `<@`
      // both (each array holds the other) is the same ids in any order. The
      // newest match first.
      const onlyCompleted = sql.includes("r.state = 'completed'");
      const sent = JSON.parse(String(params[1])) as string[];
      const sameTests = (stored: string[]) =>
        sql.includes("r.selected_test_ids = $2::jsonb")
          ? JSON.stringify(stored) === params[1]
          : sql.includes("r.selected_test_ids @> $2::jsonb") &&
            sql.includes("r.selected_test_ids <@ $2::jsonb") &&
            sent.every((id) => stored.includes(id)) &&
            stored.every((id) => sent.includes(id));
      const matches = endedRequests.filter(
        (request) =>
          (!onlyCompleted || request.state === "completed") && sameTests(request.selected_test_ids as string[]),
      );
      return params[0] === 1001 ? matches.slice(0, 1) : [];
    }
    if (sql.includes("ai_test_insight_requests") && sql.includes("r.request_key = $2")) {
      const found = stored.get(String(params[1]));
      return found ? [found] : [];
    }
    if (sql.includes("ai_test_insight_requests")) return openRequest ? [openRequest] : [];
    return [];
  });
  mockClientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO ai_test_insight_requests/.test(sql)) {
      const inserted = viewRow({ request_key: params[0], selected_test_ids: JSON.parse(String(params[6])) });
      stored.set(String(params[0]), { ...inserted });
      return { rows: [inserted] };
    }
    return { rows: [] };
  });
});

async function post(studentId: string, body: unknown, search = "") {
  return POST(
    new NextRequest(`http://localhost/api/ai-test-insights/students/${studentId}/requests${search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ studentId }) },
  );
}

describe("POST /api/ai-test-insights/students/[studentId]/requests", () => {
  it("records a queued Insight Request for the Teacher and answers 201 created", async () => {
    const response = await post("1001", { selectedTestIds: ["T9", "T4"] });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.outcome).toBe("created");
    expect(body.request).toEqual({
      requestKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      state: "queued",
      outcomeCode: null,
      selectedTestIds: ["T9", "T4"],
      requestedAt: "2026-11-27T05:30:00Z",
      requestedByName: "Asha Teacher",
      finishedAt: null,
    });
  });

  it("writes the server's UUID, the tests in the order sent, the centre's School and Program, this year and the Teacher's User", async () => {
    const response = await post("1001", { selectedTestIds: ["T9", "T7", "T4"] });

    expect(response.status).toBe(201);
    expect(inserts()).toHaveLength(1);
    const [sql, params] = inserts()[0];
    const { request } = await response.json();
    // request_key, student, School, Program (centre 301, the lowest), year, User, tests.
    expect(params).toEqual([request.requestKey, 1001, 9, 1, "2026-2027", 777, '["T9","T7","T4"]']);
    // The notes copy (#579) is read from the Student's sessions by the insert
    // itself, so the copy and the row are one write. The fixture database
    // proves its contents (e2e).
    expect(sql).toMatch(/FROM ai_test_insight_sessions/);
    expect(sql).not.toContain("'[]'::jsonb, 'queued'");
    expect(sql).toContain("now() AT TIME ZONE 'UTC'");
    expect(sql).not.toMatch(/now\(\)(?! AT TIME ZONE 'UTC')/);
  });

  it("uses the centre the page names for the School and Program", async () => {
    await post("1001", { selectedTestIds: ["T9"] }, "?centre=302");

    expect(inserts()[0][1].slice(1, 4)).toEqual([1001, 9, 2]);
  });

  it("makes a new request key each time", async () => {
    await post("1001", { selectedTestIds: ["T9"] });
    await post("1001", { selectedTestIds: ["T9"] });

    const [first, second] = inserts().map(([, params]) => params[0]);
    expect(first).not.toBe(second);
  });

  describe("the same tests again", () => {
    // Student 1001 already has a finished AI Summary of T9 and T4.
    const done = (overrides: Record<string, unknown> = {}) =>
      viewRow({
        request_key: "done-key",
        state: "completed",
        selected_test_ids: ["T9", "T4"],
        finished_at: "2026-11-27T05:34:10Z",
        ...overrides,
      });

    it("answers 200 existing with the completed request of the same tests, writing nothing and calling nothing", async () => {
      endedRequests = [done()];

      const response = await post("1001", { selectedTestIds: ["T9", "T4"] });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        outcome: "existing",
        request: {
          requestKey: "done-key",
          state: "completed",
          outcomeCode: null,
          selectedTestIds: ["T9", "T4"],
          requestedAt: "2026-11-27T05:30:00Z",
          requestedByName: "Asha Teacher",
          finishedAt: "2026-11-27T05:34:10Z",
        },
      });
      expect(inserts()).toHaveLength(0);
      expect(mockClientQuery).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("looks for the Student's newest completed request with exactly these ids, in any order", async () => {
      endedRequests = [done()];

      await post("1001", { selectedTestIds: ["T9", "T4"] });

      const [[sql, params]] = mockQuery.mock.calls.filter(([text]) => String(text).includes("$2::jsonb"));
      expect(params).toEqual([1001, '["T9","T4"]']);
      expect(sql).toContain("r.state = 'completed'");
      expect(sql).toContain("r.selected_test_ids @> $2::jsonb AND r.selected_test_ids <@ $2::jsonb");
      expect(sql).not.toContain("r.selected_test_ids = $2::jsonb");
      expect(sql).toMatch(/ORDER BY r\.requested_at DESC, r\.id DESC\s+LIMIT 1/);
    });

    // The picker lists tests by their newest sitting, so a re-sat test moves
    // up and the same tests can come in another order than they were stored.
    it("answers 200 existing for the same tests sent in another order, writing nothing", async () => {
      endedRequests = [done()];

      const response = await post("1001", { selectedTestIds: ["T4", "T9"] });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.outcome).toBe("existing");
      expect(body.request).toMatchObject({ requestKey: "done-key", selectedTestIds: ["T9", "T4"] });
      expect(inserts()).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("records a new request with generateAgain, leaving the earlier one as it was", async () => {
      endedRequests = [done()];

      const response = await post("1001", { selectedTestIds: ["T9", "T4"], generateAgain: true });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.outcome).toBe("created");
      expect(body.request.requestKey).not.toBe("done-key");
      expect(inserts()).toHaveLength(1);
      expect(enqueueCalls()).toHaveLength(1);
      // Nothing touched the earlier request.
      const updates = [...mockQuery.mock.calls, ...mockClientQuery.mock.calls].filter(([sql]) =>
        /UPDATE ai_test_insight_requests/.test(String(sql)),
      );
      for (const [sql] of updates) expect(sql).toContain("state IN ('queued', 'running')");
      expect(endedRequests[0]).toMatchObject({ request_key: "done-key", state: "completed" });
    });

    it("does not look for an existing request with generateAgain", async () => {
      endedRequests = [done()];

      await post("1001", { selectedTestIds: ["T9", "T4"], generateAgain: true });

      expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("$2::jsonb"))).toBe(false);
    });

    it.each([
      ["a different set", ["T9"]],
      ["one more test", ["T9", "T7", "T4"]],
    ])("records a new request for %s of tests", async (_label, selectedTestIds) => {
      endedRequests = [done()];

      const response = await post("1001", { selectedTestIds });

      expect(response.status).toBe(201);
      expect((await response.json()).outcome).toBe("created");
      expect(inserts()).toHaveLength(1);
    });

    it.each([
      ["no_data", "missing_category_for_cutoff"],
      ["failed", "interrupted"],
    ])("does not count a %s request of the same tests as existing", async (state, outcomeCode) => {
      endedRequests = [done({ request_key: "ended-key", state, outcome_code: outcomeCode })];

      const response = await post("1001", { selectedTestIds: ["T9", "T4"] });

      expect(response.status).toBe(201);
      expect((await response.json()).outcome).toBe("created");
      expect(inserts()).toHaveLength(1);
    });

    it("answers already_running before existing", async () => {
      endedRequests = [done()];
      openRequest = viewRow({ request_key: "running-key", state: "running", selected_test_ids: ["T9", "T4"] });

      const response = await post("1001", { selectedTestIds: ["T9", "T4"] });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ outcome: "already_running", request: { requestKey: "running-key" } });
    });

    it("answers existing even when generation is not configured", async () => {
      configureDelivery({ AI_TEST_INSIGHTS_ENQUEUE_URL: "" });
      endedRequests = [done()];

      const response = await post("1001", { selectedTestIds: ["T9", "T4"] });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ outcome: "existing", request: { requestKey: "done-key" } });
    });

    it("still answers not_configured for the same tests with generateAgain", async () => {
      configureDelivery({ AI_TEST_INSIGHTS_ENQUEUE_URL: "" });
      endedRequests = [done()];

      const response = await post("1001", { selectedTestIds: ["T9", "T4"], generateAgain: true });

      expect(response.status).toBe(503);
      expect(inserts()).toHaveLength(0);
    });
  });

  describe("the actor's User", () => {
    it("uses the User with the same email when the permission has no linked User", async () => {
      permissionRow = row("teacher", { user_id: null });
      usersByEmail = [{ id: "888" }];

      await post("1001", { selectedTestIds: ["T9"] });

      expect(inserts()[0][1][5]).toBe(888);
    });

    it("answers 409 no_linked_user and writes nothing when there is no User", async () => {
      permissionRow = row("teacher", { user_id: null });

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "no_linked_user" });
      expect(inserts()).toHaveLength(0);
    });
  });

  describe("one running request per Student", () => {
    it("answers 200 already_running with the queued or running request and writes nothing", async () => {
      openRequest = viewRow({ request_key: "running-key", state: "running", selected_test_ids: ["T1"] });

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        outcome: "already_running",
        request: {
          requestKey: "running-key",
          state: "running",
          outcomeCode: null,
          selectedTestIds: ["T1"],
          requestedAt: "2026-11-27T05:30:00Z",
          requestedByName: "Asha Teacher",
          finishedAt: null,
        },
      });
      expect(inserts()).toHaveLength(0);
    });

    it.each(["queued", "running"])(
      "answers already_running for a %s request made one second under 20 minutes ago, and writes nothing",
      async (state) => {
        openRequest = viewRow({ request_key: "fresh-key", state, read_at: "2026-11-27T05:49:59Z" });

        const response = await post("1001", { selectedTestIds: ["T9"] });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ outcome: "already_running", request: { requestKey: "fresh-key", state } });
        expect(mockClientQuery).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
      },
    );

    it.each(["queued", "running"])(
      "closes a %s request made 20 minutes ago as timed_out and records the new one, in one transaction",
      async (state) => {
        openRequest = viewRow({ request_key: "stalled-key", state, read_at: "2026-11-27T05:50:00Z" });
        const closed: string[] = [];
        const base = mockClientQuery.getMockImplementation()!;
        mockClientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
          if (/UPDATE ai_test_insight_requests/.test(sql)) {
            // Postgres closes the Student's stalled request only where the guard holds.
            const guarded =
              sql.includes("state IN ('queued', 'running')") && sql.includes("interval '20 minutes'");
            if (params[0] === 1001 && guarded && openRequest) closed.push(String(openRequest.request_key));
            return { rows: [] };
          }
          return base(sql, params);
        });

        const response = await post("1001", { selectedTestIds: ["T9", "T4"] });

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.outcome).toBe("created");
        expect(body.request).toMatchObject({ state: "queued", selectedTestIds: ["T9", "T4"] });
        expect(body.request.requestKey).not.toBe("stalled-key");
        expect(closed).toEqual(["stalled-key"]);
        // Both statements ran on the transaction's client, the close first.
        const statements = mockClientQuery.mock.calls.map(([sql]) => sql as string);
        expect(statements).toHaveLength(2);
        expect(statements[0]).toMatch(/UPDATE ai_test_insight_requests/);
        expect(statements[1]).toMatch(/INSERT INTO ai_test_insight_requests/);
        expect(enqueueCalls()).toHaveLength(1);
      },
    );

    it("closes the stalled request as failed with timed_out, finished_at and updated_at in UTC", async () => {
      openRequest = viewRow({ request_key: "stalled-key", state: "running", read_at: "2026-11-27T06:30:00Z" });

      await post("1001", { selectedTestIds: ["T9"] });

      const [[sql, params]] = mockClientQuery.mock.calls.filter(([text]) => /UPDATE ai_test_insight_requests/.test(text));
      expect(params).toEqual([1001]);
      expect(sql).toContain("state = 'failed'");
      expect(sql).toContain("outcome_code = 'timed_out'");
      expect(sql).toContain("finished_at = (now() AT TIME ZONE 'UTC')");
      expect(sql).toContain("updated_at = (now() AT TIME ZONE 'UTC')");
      expect(sql).toContain("state IN ('queued', 'running')");
      expect(sql).not.toMatch(/now\(\)(?! AT TIME ZONE 'UTC')/);
    });

    it("answers already_running with the row that won when the insert hits the one-running-request index", async () => {
      let winner: Record<string, unknown> | null = null;
      mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("FROM user_permission")) return [permissionRow];
        if (sql.includes("FROM centre_positions")) return [];
        if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
        if (sql.includes("ai_test_insight_requests")) return winner ? [winner] : [];
        return [];
      });
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (/INSERT INTO ai_test_insight_requests/.test(sql)) {
          // Another Teacher's insert committed between the check and this one.
          winner = viewRow({ request_key: "winner-key" });
          throw Object.assign(new Error("duplicate key value violates unique constraint"), {
            code: "23505",
            constraint: "ati_requests_active_student_unique",
          });
        }
        return { rows: [] };
      });

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.outcome).toBe("already_running");
      expect(body.request.requestKey).toBe("winner-key");
    });

    it("answers 500 for any other database error, logging only the error name and student id", async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (/INSERT INTO ai_test_insight_requests/.test(sql)) {
          throw Object.assign(new Error('violates check constraint on "T9"'), { name: "DatabaseError", code: "23514" });
        }
        return { rows: [] };
      });

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(500);
      const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
      expect(logged).toContain("DatabaseError");
      expect(logged).toContain("1001");
      expect(logged).not.toContain("T9");
      expect(logged).not.toContain(email);
    });
  });

  describe("generation not configured", () => {
    const NOT_CONFIGURED = { code: "not_configured" };

    it.each([
      ["no enqueue URL", { AI_TEST_INSIGHTS_ENQUEUE_URL: "" }],
      ["a whitespace-only enqueue URL", { AI_TEST_INSIGHTS_ENQUEUE_URL: "   " }],
      ["no enqueue secret", { AI_TEST_INSIGHTS_ENQUEUE_SECRET: "" }],
      ["a whitespace-only enqueue secret", { AI_TEST_INSIGHTS_ENQUEUE_SECRET: " \t " }],
      ["no APP_ENV", { APP_ENV: "" }],
      ["a whitespace-only APP_ENV", { APP_ENV: "  " }],
      ["APP_ENV development", { APP_ENV: "development" }],
      ["APP_ENV testing", { APP_ENV: "testing" }],
    ])("answers 503 not_configured with %s, writing no row and calling nothing", async (_label, overrides) => {
      configureDelivery(overrides);

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject(NOT_CONFIGURED);
      expect(inserts()).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("answers already_running before saying generation is not configured", async () => {
      configureDelivery({ AI_TEST_INSIGHTS_ENQUEUE_URL: "" });
      openRequest = viewRow({ request_key: "running-key", state: "running" });

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(200);
      expect((await response.json()).outcome).toBe("already_running");
    });

    it("checks the Teacher's access before saying generation is not configured", async () => {
      configureDelivery({ AI_TEST_INSIGHTS_ENQUEUE_URL: "" });
      permissionRow = row("program_manager");

      expect((await post("1001", { selectedTestIds: ["T9"] })).status).toBe(403);
    });

    it.each(["staging", "production"])("is configured with APP_ENV %s", async (environment) => {
      configureDelivery({ APP_ENV: environment });

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(201);
      expect(enqueueCalls()[0][1].body).toBe(JSON.stringify({ environment }));
    });

    it("is configured without a wake URL", async () => {
      configureDelivery({ AI_TEST_INSIGHTS_WAKE_URL: "" });

      expect((await post("1001", { selectedTestIds: ["T9"] })).status).toBe(201);
    });
  });

  describe("delivery to AI Mentorship Guide", () => {
    it("wakes the generator and enqueues the new request with the bearer secret and APP_ENV", async () => {
      const response = await post("1001", { selectedTestIds: ["T9", "T4"] });

      expect(response.status).toBe(201);
      const { request } = await response.json();
      expect(fetchCalls()).toHaveLength(2);
      const [[wakeUrl, wakeInit]] = wakeCalls();
      expect(wakeUrl).toBe("https://wake.example.test/start");
      expect(wakeInit.method).toBe("POST");
      expect(new Headers(wakeInit.headers).has("Authorization")).toBe(false);
      const [[enqueueUrl, enqueueInit]] = enqueueCalls();
      expect(enqueueUrl).toBe(
        `https://guide.example.test/api/internal/insight-requests/${request.requestKey}/enqueue`,
      );
      expect(enqueueInit.method).toBe("POST");
      expect(new Headers(enqueueInit.headers).get("Authorization")).toBe("Bearer enqueue-secret-e2e-1");
      expect(new Headers(enqueueInit.headers).get("Content-Type")).toBe("application/json");
      expect(enqueueInit.body).toBe('{"environment":"staging"}');
    });

    it("trims the settings and a trailing slash on either URL", async () => {
      configureDelivery({
        AI_TEST_INSIGHTS_ENQUEUE_URL: ` ${ENQUEUE_URL}/ `,
        AI_TEST_INSIGHTS_ENQUEUE_SECRET: ` ${ENQUEUE_SECRET} `,
        AI_TEST_INSIGHTS_WAKE_URL: ` ${WAKE_URL}/ `,
        APP_ENV: " production ",
      });

      const { request } = await (await post("1001", { selectedTestIds: ["T9"] })).json();

      expect(wakeCalls()[0][0]).toBe("https://wake.example.test/start");
      expect(enqueueCalls()[0][0]).toBe(
        `https://guide.example.test/api/internal/insight-requests/${request.requestKey}/enqueue`,
      );
      expect(new Headers(enqueueCalls()[0][1].headers).get("Authorization")).toBe("Bearer enqueue-secret-e2e-1");
      expect(enqueueCalls()[0][1].body).toBe('{"environment":"production"}');
    });

    it("gives each call a 10-second limit", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");

      await post("1001", { selectedTestIds: ["T9"] });

      expect(timeout.mock.calls).toEqual([[10_000], [10_000]]);
      for (const [, init] of fetchCalls()) expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("makes the wake and enqueue calls together", async () => {
      // The wake answers only once the enqueue call has been made: in turn,
      // the two would wait on each other for ever.
      let enqueued: () => void = () => {};
      const enqueueMade = new Promise<void>((resolve) => (enqueued = resolve));
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith("/enqueue")) {
          enqueued();
          return new Response(null, { status: 202 });
        }
        await enqueueMade;
        return new Response(null, { status: 200 });
      });

      expect((await post("1001", { selectedTestIds: ["T9"] })).status).toBe(201);
    });

    it("skips only the wake call when the wake URL is blank", async () => {
      configureDelivery({ AI_TEST_INSIGHTS_WAKE_URL: "  " });

      await post("1001", { selectedTestIds: ["T9"] });

      expect(wakeCalls()).toHaveLength(0);
      expect(enqueueCalls()).toHaveLength(1);
    });

    it.each([
      ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
      ["a 500", () => Promise.resolve(new Response(null, { status: 500 }))],
    ])("ignores %s from the wake call", async (_label, wake) => {
      mockFetch.mockImplementation(async (url: string) =>
        url.endsWith("/enqueue") ? new Response(null, { status: 202 }) : wake(),
      );

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(201);
      expect((await response.json()).request.state).toBe("queued");
    });

    it("leaves the request queued when the generator accepts it with 202", async () => {
      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toMatchObject({ outcome: "created", request: { state: "queued", outcomeCode: null, finishedAt: null } });
      expect(mockQuery.mock.calls.some(([sql]) => /UPDATE ai_test_insight_requests/.test(sql))).toBe(false);
    });

    it("returns the request as it reads after delivery", async () => {
      // The generator claimed the request while answering the enqueue call.
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith("/enqueue")) {
          const key = url.split("/").at(-2) as string;
          Object.assign(stored.get(key) as Record<string, unknown>, { state: "running" });
          return new Response(null, { status: 202 });
        }
        return new Response(null, { status: 200 });
      });

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(201);
      expect((await response.json()).request.state).toBe("running");
    });

    it.each([401, 404, 422])(
      "marks the request failed with enqueue_rejected when the generator answers %i",
      async (status) => {
        guideAnswers(status);

        const response = await post("1001", { selectedTestIds: ["T9", "T4"] });

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.outcome).toBe("created");
        expect(body.request).toMatchObject({
          state: "failed",
          outcomeCode: "enqueue_rejected",
          selectedTestIds: ["T9", "T4"],
          finishedAt: "2026-11-27T05:30:02Z",
        });
        const updates = mockQuery.mock.calls.filter(([sql]) => /UPDATE ai_test_insight_requests/.test(sql));
        expect(updates).toHaveLength(1);
        const [sql, params] = updates[0];
        expect(params).toEqual([body.request.requestKey]);
        expect(sql).toContain("finished_at = (now() AT TIME ZONE 'UTC')");
        expect(sql).toContain("updated_at = (now() AT TIME ZONE 'UTC')");
      },
    );

    it("leaves a request the generator already claimed alone when the enqueue call is rejected", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith("/enqueue")) {
          const key = url.split("/").at(-2) as string;
          Object.assign(stored.get(key) as Record<string, unknown>, { state: "running" });
          return new Response(null, { status: 422 });
        }
        return new Response(null, { status: 200 });
      });

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(201);
      expect((await response.json()).request).toMatchObject({ state: "running", outcomeCode: null });
    });

    it.each([
      ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
      ["a 500", () => Promise.resolve(new Response(null, { status: 500 }))],
      ["a timeout", () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))],
      ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ])("leaves the request queued after %s from the enqueue call", async (_label, enqueue) => {
      mockFetch.mockImplementation(async (url: string) =>
        url.endsWith("/enqueue") ? enqueue() : new Response(null, { status: 200 }),
      );

      const response = await post("1001", { selectedTestIds: ["T9"] });

      expect(response.status).toBe(201);
      expect((await response.json()).request).toMatchObject({ state: "queued", outcomeCode: null });
      expect(mockQuery.mock.calls.some(([sql]) => /UPDATE ai_test_insight_requests/.test(sql))).toBe(false);
    });

    it("does not deliver a request that was already running", async () => {
      openRequest = viewRow({ request_key: "running-key", state: "running" });

      await post("1001", { selectedTestIds: ["T9"] });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("never logs the enqueue secret", async () => {
      for (const answer of [
        () => Promise.resolve(new Response(null, { status: 401 })),
        () => Promise.resolve(new Response(null, { status: 503 })),
        () => Promise.reject(new TypeError(`fetch failed for Bearer ${ENQUEUE_SECRET}`)),
      ]) {
        mockFetch.mockImplementation(async (url: string) =>
          url.endsWith("/enqueue") ? answer() : Promise.reject(new TypeError(`wake failed ${ENQUEUE_SECRET}`)),
        );
        await post("1001", { selectedTestIds: ["T9"] });
      }

      const logged = [console.error, console.warn, console.info, console.log]
        .flatMap((log) => vi.mocked(log).mock.calls.flat())
        .map((value) => (value instanceof Error ? `${value.name} ${value.message}` : JSON.stringify(value)))
        .join(" ");
      expect(logged).not.toContain(ENQUEUE_SECRET);
    });
  });

  describe("body rules", () => {
    const fiftyIds = Array.from({ length: 50 }, (_, i) => `T${i}`);

    it("accepts 50 distinct ids of letters, digits, _ and -, up to 64 characters", async () => {
      expect((await post("1001", { selectedTestIds: fiftyIds })).status).toBe(201);
      expect((await post("1001", { selectedTestIds: ["a".repeat(64), "Ab_9-z"] })).status).toBe(201);
    });

    it.each([
      ["no ids", { selectedTestIds: [] }],
      ["51 ids", { selectedTestIds: [...fiftyIds, "T50"] }],
      ["a repeated id", { selectedTestIds: ["T9", "T4", "T9"] }],
      ["a 65-character id", { selectedTestIds: ["a".repeat(65)] }],
      ["an empty id", { selectedTestIds: [""] }],
      ["a bad character", { selectedTestIds: ["T 9"] }],
      ["a non-string", { selectedTestIds: [9] }],
      ["no selectedTestIds", {}],
      ["selectedTestIds not an array", { selectedTestIds: "T9" }],
      ["generateAgain not a boolean", { selectedTestIds: ["T9"], generateAgain: "yes" }],
      ["a body that is not an object", ["T9"]],
      ["a body that is not JSON", "{not json"],
    ])("answers 422 to %s and writes nothing", async (_label, body) => {
      const response = await post("1001", body);

      expect(response.status).toBe(422);
      expect(inserts()).toHaveLength(0);
    });
  });

  describe("refusal order", () => {
    it("answers 401 without a session, before checking the id", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect((await post("1001", { selectedTestIds: ["T9"] })).status).toBe(401);
      expect((await post("abc", { selectedTestIds: ["T9"] })).status).toBe(401);
      expect(inserts()).toHaveLength(0);
    });

    it.each(["abc", "0", "-1", "1.5"])("answers 422 for the id %j, before the feature check", async (id) => {
      permissionRow = row("pmu_manager");

      expect((await post(id, { selectedTestIds: ["T9"] })).status).toBe(422);
      expect(inserts()).toHaveLength(0);
    });

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, whose role has no AI Test Insights view", async (role) => {
      permissionRow = row(role);

      expect((await post("1001", { selectedTestIds: ["T9"] })).status).toBe(403);
      expect((await post("9999", { selectedTestIds: ["T9"] })).status).toBe(403);
      expect(inserts()).toHaveLength(0);
    });

    it("answers 403 to a Teacher with only JNV NVS", async () => {
      permissionRow = row("teacher", { program_ids: [64] });

      expect((await post("1001", { selectedTestIds: ["T9"] })).status).toBe(403);
      expect(inserts()).toHaveLength(0);
    });

    it.each(VIEW_ONLY_ROLES)("answers 403 to %s, a viewer, before the Student lookup", async (role) => {
      permissionRow = row(role);

      expect((await post("1001", { selectedTestIds: ["T9"] })).status).toBe(403);
      expect((await post("9999", { selectedTestIds: ["T9"] })).status).toBe(403);
      expect(inserts()).toHaveLength(0);
    });

    it("answers 403 to a read_only Teacher, before the Student lookup", async () => {
      permissionRow = row("teacher", { read_only: true });

      expect((await post("1001", { selectedTestIds: ["T9"] })).status).toBe(403);
      expect((await post("9999", { selectedTestIds: ["T9"] })).status).toBe(403);
      expect(inserts()).toHaveLength(0);
    });

    it("answers 404 to a Teacher for a Student who does not exist, before the body rules", async () => {
      expect((await post("9999", { selectedTestIds: ["T9"] })).status).toBe(404);
      expect((await post("9999", { selectedTestIds: [] })).status).toBe(404);
      expect(inserts()).toHaveLength(0);
    });

    it("answers 404 to a Teacher for a listed Student of another School", async () => {
      expect((await post("2001", { selectedTestIds: ["T9"] })).status).toBe(404);
      expect(inserts()).toHaveLength(0);
    });
  });
});
