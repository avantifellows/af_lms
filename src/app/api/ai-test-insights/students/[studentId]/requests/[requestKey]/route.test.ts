import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The status route of the AI Summary card (#563) through the real Student
// access helper, the real permission matrix and the real Insight Request
// module. The session and the Postgres boundary are stubbed: Postgres answers
// the permission row, centre seats, the listed-Student rows of one Student and
// the stored requests declared here, and applies the module's guarded updates
// the way their WHERE clauses say. `fetch` stands in for AI Mentorship Guide's
// wake and enqueue endpoints, and `vi.stubEnv` for the delivery settings.
const { mockQuery, mockGetServerSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: mockQuery,
  withTransaction: () => {
    throw new Error("the status route opens no transaction");
  },
}));

import { GET } from "./route";

const email = "staff@avantifellows.org";

// Student 1001 is listed by centre 301 (School 9, JNV001, Program 1). 2001 is
// listed by centre 401 of another School, JNV002.
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

const KEY = "4b0f5c1e-1111-4222-8333-944455556666";
const OTHER_STUDENT_KEY = "9c0f5c1e-2222-4222-8333-944455557777";

/**
 * A stored request: its view columns, as Postgres returns them (`read_at` is
 * the database's UTC clock at the read, one minute after the request was
 * made), plus the Student it belongs to and how many seconds ago its
 * `updated_at` was.
 */
type Stored = Record<string, unknown> & { student_id: number; updatedSecondsAgo: number };

/** The columns the mock stores that the view read does not return. */
const STORE_ONLY = new Set(["student_id", "updatedSecondsAgo", "stalled"]);

const stored = (overrides: Partial<Stored> = {}): Stored => ({
  request_key: KEY,
  state: "queued",
  outcome_code: null,
  selected_test_ids: ["T9", "T4"],
  requested_at: "2026-11-27T05:30:00Z",
  requested_by_name: "Asha Teacher",
  finished_at: null,
  read_at: "2026-11-27T05:31:00Z",
  student_id: 1001,
  updatedSecondsAgo: 45,
  ...overrides,
});

/** The view shape the route answers for `stored()`, written by hand. */
const VIEW = {
  requestKey: KEY,
  state: "queued",
  outcomeCode: null,
  selectedTestIds: ["T9", "T4"],
  requestedAt: "2026-11-27T05:30:00Z",
  requestedByName: "Asha Teacher",
  finishedAt: null,
};

let permissionRow: Record<string, unknown> | null;
let requests: Map<string, Stored>;

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

const fetchCalls = () => mockFetch.mock.calls as Array<[string, RequestInit]>;
const enqueueCalls = () => fetchCalls().filter(([url]) => url.endsWith("/enqueue"));
const wakeCalls = () => fetchCalls().filter(([url]) => url.endsWith("/start"));

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

const updates = () => mockQuery.mock.calls.filter(([sql]) => /UPDATE ai_test_insight_requests/.test(sql));

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
  requests = new Map([
    [KEY, stored()],
    [OTHER_STUDENT_KEY, stored({ request_key: OTHER_STUDENT_KEY, student_id: 2001 })],
  ]);
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    if (/UPDATE ai_test_insight_requests/.test(sql) && sql.includes("'enqueue_rejected'")) {
      // Applied only where its guard holds.
      const target = requests.get(String(params[0]));
      if (!target || !/state = 'queued'/.test(sql) || target.state !== "queued") return [];
      Object.assign(target, {
        state: "failed",
        outcome_code: "enqueue_rejected",
        finished_at: "2026-11-27T05:31:02Z",
        updatedSecondsAgo: 0,
      });
      return [{ request_key: target.request_key }];
    }
    if (/UPDATE ai_test_insight_requests/.test(sql)) {
      // The re-delivery claim: `updated_at` to now, only for a queued request
      // last updated at least 30 seconds ago and made under 20 minutes ago
      // (the stored `stalled` flag says whether it was made 20 minutes ago or more).
      const target = requests.get(String(params[0]));
      const guarded =
        /state = 'queued'/.test(sql) && /interval '30 seconds'/.test(sql) && /interval '20 minutes'/.test(sql);
      if (!target || !guarded || target.state !== "queued" || target.updatedSecondsAgo < 30 || target.stalled) return [];
      target.updatedSecondsAgo = 0;
      return [{ request_key: target.request_key }];
    }
    if (sql.includes("ai_test_insight_requests") && sql.includes("r.request_key = $2")) {
      const found = requests.get(String(params[1]));
      if (!found || found.student_id !== Number(params[0])) return [];
      return [Object.fromEntries(Object.entries(found).filter(([column]) => !STORE_ONLY.has(column)))];
    }
    return [];
  });
});

async function get(studentId: string, requestKey: string, search = "") {
  return GET(
    new NextRequest(`http://localhost/api/ai-test-insights/students/${studentId}/requests/${requestKey}${search}`),
    { params: Promise.resolve({ studentId, requestKey }) },
  );
}

describe("GET /api/ai-test-insights/students/[studentId]/requests/[requestKey]", () => {
  it("answers the request in the view shape", async () => {
    permissionRow = row("program_manager");

    const response = await get("1001", KEY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ request: VIEW });
  });

  it("answers 404 for a request key of another Student, and for an unknown key", async () => {
    expect((await get("1001", OTHER_STUDENT_KEY)).status).toBe(404);
    expect((await get("1001", "no-such-key")).status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  describe("refusal order", () => {
    it("answers 401 without a session, before checking the id", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect((await get("1001", KEY)).status).toBe(401);
      expect((await get("abc", KEY)).status).toBe(401);
    });

    it.each(["abc", "0", "-1", "1.5"])("answers 422 for the id %j, before the feature check", async (id) => {
      permissionRow = row("pmu_manager");

      expect((await get(id, KEY)).status).toBe(422);
    });

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, whose role has no AI Test Insights view", async (role) => {
      permissionRow = row(role);

      expect((await get("1001", KEY)).status).toBe(403);
      expect((await get("9999", KEY)).status).toBe(403);
    });

    it("answers 403 to a Teacher with only JNV NVS", async () => {
      permissionRow = row("teacher", { program_ids: [64] });

      expect((await get("1001", KEY)).status).toBe(403);
    });

    it.each([...VIEW_ONLY_ROLES, "teacher"])("answers %s the request of a Student in scope", async (role) => {
      permissionRow = row(role);

      const response = await get("1001", KEY);

      expect(response.status).toBe(200);
      expect((await response.json()).request.requestKey).toBe(KEY);
    });

    it("answers a read_only Teacher the request", async () => {
      permissionRow = row("teacher", { read_only: true });

      expect((await get("1001", KEY)).status).toBe(200);
    });

    it.each([...VIEW_ONLY_ROLES, "teacher"])(
      "answers 404 to %s for a Student who does not exist, or who no centre they may list lists",
      async (role) => {
        permissionRow = row(role);

        expect((await get("9999", KEY)).status).toBe(404);
        if (role !== "admin") expect((await get("2001", OTHER_STUDENT_KEY)).status).toBe(404);
      },
    );
  });

  describe("re-delivery", () => {
    it("wakes the generator and enqueues again when a Teacher polls a queued request last touched 30 seconds ago or more", async () => {
      requests.get(KEY)!.updatedSecondsAgo = 30;

      const response = await get("1001", KEY);

      expect(response.status).toBe(200);
      expect(wakeCalls().map(([url]) => url)).toEqual(["https://wake.example.test/start"]);
      expect(enqueueCalls()).toHaveLength(1);
      const [[url, init]] = enqueueCalls();
      expect(url).toBe(`https://guide.example.test/api/internal/insight-requests/${KEY}/enqueue`);
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer enqueue-secret-e2e-1");
      expect(init.body).toBe('{"environment":"staging"}');
    });

    it("claims the request with one conditional update that stamps updated_at in UTC", async () => {
      await get("1001", KEY);

      expect(updates()).toHaveLength(1);
      const [sql, params] = updates()[0];
      expect(params).toEqual([KEY]);
      expect(sql).toContain("updated_at = (now() AT TIME ZONE 'UTC')");
      expect(sql).toContain("state = 'queued'");
      expect(sql).not.toMatch(/now\(\)(?! AT TIME ZONE 'UTC')/);
    });

    it("makes one enqueue call for two polls inside 30 seconds", async () => {
      await get("1001", KEY);
      await get("1001", KEY);

      expect(enqueueCalls()).toHaveLength(1);
      expect(wakeCalls()).toHaveLength(1);
    });

    it("does not re-deliver a queued request touched under 30 seconds ago", async () => {
      requests.get(KEY)!.updatedSecondsAgo = 29;

      expect((await get("1001", KEY)).status).toBe(200);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(["running", "completed", "no_data", "failed"])("does not re-deliver a %s request", async (state) => {
      Object.assign(requests.get(KEY)!, { state, updatedSecondsAgo: 600 });

      expect((await get("1001", KEY)).status).toBe(200);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(updates()).toHaveLength(0);
    });

    it.each(["queued", "running"])(
      "answers a %s request made 20 minutes ago as failed with timed_out, with no wake or enqueue call and no row changed",
      async (state) => {
        Object.assign(requests.get(KEY)!, { state, read_at: "2026-11-27T05:50:00Z", updatedSecondsAgo: 600, stalled: true });

        const response = await get("1001", KEY);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ request: { ...VIEW, state: "failed", outcomeCode: "timed_out" } });
        expect(mockFetch).not.toHaveBeenCalled();
        expect(updates()).toHaveLength(0);
      },
    );

    it("makes no delivery call when the request stalls between the read and the claim", async () => {
      // Read one second under 20 minutes, so it still reads queued; by the
      // claim, the database's clock has passed the limit.
      Object.assign(requests.get(KEY)!, { read_at: "2026-11-27T05:49:59Z", updatedSecondsAgo: 600, stalled: true });

      expect((await get("1001", KEY)).status).toBe(200);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each([...VIEW_ONLY_ROLES])("never re-delivers on a poll by %s, a viewer", async (role) => {
      permissionRow = row(role);

      expect((await get("1001", KEY)).status).toBe(200);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(updates()).toHaveLength(0);
    });

    it("never re-delivers on a poll by a read_only Teacher", async () => {
      permissionRow = row("teacher", { read_only: true });

      expect((await get("1001", KEY)).status).toBe(200);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(updates()).toHaveLength(0);
    });

    it("gives each call a 5-second limit", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");

      await get("1001", KEY);

      expect(timeout.mock.calls).toEqual([[5_000], [5_000]]);
      for (const [, init] of fetchCalls()) expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it.each([401, 404, 422])("marks the request failed with enqueue_rejected when the generator answers %i", async (status) => {
      guideAnswers(status);

      const response = await get("1001", KEY);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        request: { ...VIEW, state: "failed", outcomeCode: "enqueue_rejected", finishedAt: "2026-11-27T05:31:02Z" },
      });
      const rejected = updates().filter(([sql]) => sql.includes("'enqueue_rejected'"));
      expect(rejected).toHaveLength(1);
      expect(rejected[0][0]).toContain("state = 'queued'");
    });

    it("leaves a request the generator claimed meanwhile alone when the enqueue call is rejected", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith("/enqueue")) {
          requests.get(KEY)!.state = "running";
          return new Response(null, { status: 422 });
        }
        return new Response(null, { status: 200 });
      });

      const response = await get("1001", KEY);

      expect((await response.json()).request).toMatchObject({ state: "running", outcomeCode: null });
    });

    it.each([
      ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
      ["a timeout", () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))],
      ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ])("leaves the request queued after %s", async (_label, enqueue) => {
      mockFetch.mockImplementation(async (url: string) =>
        url.endsWith("/enqueue") ? enqueue() : new Response(null, { status: 200 }),
      );

      const response = await get("1001", KEY);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ request: VIEW });
      expect(updates().filter(([sql]) => sql.includes("'enqueue_rejected'"))).toHaveLength(0);
    });

    it("answers the same shape with and without a re-delivery", async () => {
      const delivered = await (await get("1001", KEY)).json();
      const throttled = await (await get("1001", KEY)).json();
      permissionRow = row("program_manager");
      requests.get(KEY)!.updatedSecondsAgo = 600;
      const viewer = await (await get("1001", KEY)).json();

      expect(enqueueCalls()).toHaveLength(1);
      for (const body of [delivered, throttled, viewer]) expect(body).toEqual({ request: VIEW });
    });

    it("re-delivers nothing when generation is not configured, and still answers the request", async () => {
      configureDelivery({ AI_TEST_INSIGHTS_ENQUEUE_URL: "" });

      const response = await get("1001", KEY);

      expect(await response.json()).toEqual({ request: VIEW });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(updates()).toHaveLength(0);
    });

    it("never re-delivers another Student's request", async () => {
      requests.get(OTHER_STUDENT_KEY)!.updatedSecondsAgo = 600;

      expect((await get("1001", OTHER_STUDENT_KEY)).status).toBe(404);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(updates()).toHaveLength(0);
    });

    it("still answers the request when the claim fails, logging only the key, the Student and the error name", async () => {
      const base = mockQuery.getMockImplementation()!;
      mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
        if (/UPDATE ai_test_insight_requests/.test(sql)) {
          throw Object.assign(new Error('could not update "T9"'), { name: "DatabaseError" });
        }
        return base(sql, params);
      });

      const response = await get("1001", KEY);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ request: VIEW });
      const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
      expect(logged).toContain("DatabaseError");
      expect(logged).toContain(KEY);
      expect(logged).not.toContain("T9");
    });
  });
});
