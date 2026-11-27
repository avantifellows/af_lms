import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The create route of the AI Summary card (#560) through the real Student
// access helper, the real permission matrix and the real Insight Request
// module. The session and the Postgres boundary (`query()` and
// `withTransaction`) are stubbed: Postgres answers the permission row, centre
// seats, the listed-Student rows of one Student, the actor's User by email,
// the Student's open request and the inserted row, as declared here.
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

// A request row as Postgres returns the view read.
const viewRow = (overrides: Record<string, unknown> = {}) => ({
  request_key: "4b0f5c1e-1111-4222-8333-944455556666",
  state: "queued",
  outcome_code: null,
  selected_test_ids: ["T9", "T4"],
  requested_at: "2026-11-27T05:30:00Z",
  requested_by_name: "Asha Teacher",
  finished_at: null,
  ...overrides,
});

let permissionRow: Record<string, unknown> | null;
let usersByEmail: Array<Record<string, unknown>>;
let openRequest: Record<string, unknown> | null;

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
  permissionRow = row("teacher");
  usersByEmail = [];
  openRequest = null;
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    if (sql.includes('FROM "user"') && sql.includes("LOWER(email)")) return usersByEmail;
    if (sql.includes("ai_test_insight_requests")) return openRequest ? [openRequest] : [];
    return [];
  });
  mockClientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO ai_test_insight_requests/.test(sql)) {
      return {
        rows: [viewRow({ request_key: params[0], selected_test_ids: JSON.parse(String(params[6])) })],
      };
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
    expect(sql).toContain("'[]'::jsonb");
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

  it("generateAgain is accepted and changes nothing yet", async () => {
    const response = await post("1001", { selectedTestIds: ["T9"], generateAgain: true });

    expect(response.status).toBe(201);
    expect(inserts()).toHaveLength(1);
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
