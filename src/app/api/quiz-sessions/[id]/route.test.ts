import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ADMIN_SESSION,
  NO_SESSION,
  jsonRequest,
  routeParams,
} from "../../__test-utils__/api-test-helpers";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireQuizSessionAccess: vi.fn(),
  mockCanAccessQuizSessionBatches: vi.fn(),
  mockQuery: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.mockGetServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: mocks.mockQuery,
}));
vi.mock("@/lib/quiz-session-access", () => ({
  requireQuizSessionAccess: mocks.mockRequireQuizSessionAccess,
  canAccessQuizSessionBatches: mocks.mockCanAccessQuizSessionBatches,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Route the downstream HTTP calls (db-service session PATCH, occurrence GET/PATCH,
// quiz-backend PATCH) to sane success defaults. Order the checks so the more
// specific occurrence paths win over the plain /session/ path.
function defaultFetchRouting() {
  mocks.mockFetch.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.includes("/session-occurrence?")) {
      return Promise.resolve(jsonResponse([{ id: 555 }]));
    }
    if (url.includes("/session-occurrence/")) {
      return Promise.resolve(jsonResponse({ id: 555 }));
    }
    if (url.includes("/quiz/")) {
      return Promise.resolve(jsonResponse({ id: "quiz-abc123", updated: [] }));
    }
    if (url.includes("/session/")) {
      return Promise.resolve(jsonResponse({ id: 42 }));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

function fetchCall(urlSubstr: string) {
  return mocks.mockFetch.mock.calls.find((call) =>
    String(call[0]).includes(urlSubstr)
  );
}

function fetchBody(urlSubstr: string) {
  const call = fetchCall(urlSubstr);
  return JSON.parse(String((call?.[1] as RequestInit)?.body));
}

async function loadRouteModule(env?: {
  dbServiceUrl?: string;
  dbServiceToken?: string;
  quizBackendUrl?: string;
}) {
  vi.resetModules();
  process.env.DB_SERVICE_URL = env?.dbServiceUrl ?? "http://db-service.local";
  process.env.DB_SERVICE_TOKEN = env?.dbServiceToken ?? "test-token";
  process.env.QUIZ_BACKEND_URL = env?.quizBackendUrl ?? "http://quiz-backend.local";
  return import("./route");
}

beforeEach(() => {
  mocks.mockGetServerSession.mockReset();
  mocks.mockRequireQuizSessionAccess.mockReset();
  mocks.mockCanAccessQuizSessionBatches.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
  vi.useRealTimers();
  defaultFetchRouting();
  mocks.mockRequireQuizSessionAccess.mockResolvedValue({
    ok: true,
    permission: { program_ids: [1, 64] },
  });
  mocks.mockCanAccessQuizSessionBatches.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.DB_SERVICE_URL;
  delete process.env.DB_SERVICE_TOKEN;
  delete process.env.QUIZ_BACKEND_URL;
});

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "Existing session",
    platform_id: "quiz-abc123",
    session_id: "EnableStudents_quiz-abc123",
    start_time: "2026-04-15T05:00:00.000Z",
    end_time: "2026-04-15T09:00:00.000Z",
    is_active: true,
    meta_data: { show_scores: true },
    ...overrides,
  };
}

describe("PATCH /api/quiz-sessions/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { name: "Updated" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when the session does not exist", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { name: "Updated" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Session not found" });
  });

  it("returns 403 when the user cannot edit quiz sessions", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockRequireQuizSessionAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { name: "Updated" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockQuery).not.toHaveBeenCalled();
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("returns 403 when the session belongs to inaccessible class batches", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      sessionRow({ meta_data: { batch_id: "EnableStudents_11_Engg_A" } }),
    ]);
    mocks.mockCanAccessQuizSessionBatches.mockResolvedValue(false);

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { name: "Updated" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("blocks end_now when the session is not currently live", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      sessionRow({
        name: "Future session",
        start_time: "2026-04-15T09:00:00.000Z",
        end_time: "2026-04-15T11:00:00.000Z",
      }),
    ]);
    vi.setSystemTime(new Date("2026-04-15T06:00:00.000Z"));

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { action: "end_now" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Only live sessions can be ended now",
    });
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("patches the session row, syncs the occurrence and the quiz doc", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      sessionRow({
        meta_data: JSON.stringify({
          show_scores: true,
          show_answers: false,
          shuffle: false,
          gurukul_format_type: "both",
          untouched: "keep-me",
        }),
      }),
    ]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: {
          name: "Updated session",
          startTime: "2026-04-15T04:30:00.000Z",
          endTime: "2026-04-15T08:30:00.000Z",
          showAnswers: true,
          showScores: false,
          shuffle: true,
          gurukulFormatType: "omr",
          isActive: false,
        },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: 42 });

    // 1. Session row → db-service PATCH /session/{id}
    expect(fetchCall("http://db-service.local/session/42")).toBeDefined();
    expect(fetchBody("/session/42")).toMatchObject({
      name: "Updated session",
      is_active: false,
      start_time: "2026-04-15T10:00:00.000Z",
      end_time: "2026-04-15T14:00:00.000Z",
      meta_data: {
        show_answers: true,
        show_scores: false,
        shuffle: true,
        gurukul_format_type: "qa",
        untouched: "keep-me",
      },
    });

    // 2. Occurrence lookup + PATCH with the new IST window (portal gates on this)
    expect(
      fetchCall(
        "/session-occurrence?session_id=EnableStudents_quiz-abc123"
      )
    ).toBeDefined();
    expect(fetchBody("/session-occurrence/555")).toEqual({
      start_time: "2026-04-15T10:00:00.000Z",
      end_time: "2026-04-15T14:00:00.000Z",
    });

    // 3. Quiz doc → quiz-backend PATCH /quiz/{quizId} (quiz-frontend reads these)
    //
    // On session_end_time: the RAW IST window end as a bare wall-clock, with NO duration
    // offset applied here — quiz-backend adds time_limit.max itself to derive the
    // answer-visibility moment, so pre-offsetting would double it and open answers late.
    // Time convention: the request's endTime "2026-04-15T08:30:00.000Z" is a true UTC
    // instant; utcToISTDate shifts it +5:30 to the IST wall-clock 14:00 and re-stamps a
    // (meaningless) Z. The session row and occurrence keep that Z — IST wearing a UTC
    // suffix, as everything downstream expects — and only the quiz-doc value strips it,
    // since quiz-backend parses a naive datetime.
    expect(fetchCall("http://quiz-backend.local/quiz/quiz-abc123")).toBeDefined();
    expect(fetchBody("/quiz/quiz-abc123")).toEqual({
      title: "Updated session",
      shuffle: true,
      show_scores: false,
      review_immediate: true,
      session_end_time: "2026-04-15T14:00:00",
    });
  });

  it("ends a live session immediately and mirrors the new end time", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      sessionRow({
        name: "Live session",
        end_time: "2026-04-15T07:00:00.000Z",
        meta_data: {},
      }),
    ]);
    vi.setSystemTime(new Date("2026-04-15T06:00:00.000Z"));

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { action: "end_now" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(200);
    expect(fetchBody("/session/42").end_time).toBe("2026-04-15T11:30:00.000Z");
    // occurrence + quiz doc end time follow the shortened window
    expect(fetchBody("/session-occurrence/555").end_time).toBe(
      "2026-04-15T11:30:00.000Z"
    );
    // Raw IST wall-clock of the new end (06:00 UTC + 5:30), no duration offset — see the
    // convention note above.
    expect(fetchBody("/quiz/quiz-abc123").session_end_time).toBe(
      "2026-04-15T11:30:00"
    );
  });

  it("fails loudly when the session has no occurrence to re-gate", async () => {
    // Portal gates quiz entry on the occurrence, not the session row. If there's no
    // occurrence the new window is not in force for students, so returning 200 here would
    // show the operator a window that silently isn't real.
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([sessionRow()]);
    mocks.mockFetch.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("/session-occurrence?")) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.resolve(jsonResponse({ id: 42 }));
    });

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { startTime: "2026-04-15T04:30:00.000Z", endTime: "2026-04-15T08:30:00.000Z" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Session updated but its schedule could not be found to update",
    });
    // never proceeds to the quiz doc once the schedule is known to be stale
    expect(fetchCall("/quiz/quiz-abc123")).toBeUndefined();
  });

  it("stamps the edit audit fields (the LMS is the only writer now)", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([sessionRow()]);
    vi.setSystemTime(new Date("2026-04-15T06:00:00.000Z"));

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { name: "Renamed" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(200);
    const meta = fetchBody("/session/42").meta_data;
    expect(meta.last_edited_by).toBe(ADMIN_SESSION.user.email);
    // IST wall-clock, Z-stamped per this codebase's convention (06:00 UTC + 5:30)
    expect(meta.last_edited_at).toBe("2026-04-15T11:30:00.000Z");
  });

  it("does not touch the quiz doc when no quiz-doc field changed", async () => {
    // gurukul_format_type lives only on the session meta_data — it has no quiz-doc home, so
    // editing it alone must not fire a no-op PATCH at quiz-backend.
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([sessionRow()]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { gurukulFormatType: "both" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(200);
    expect(fetchCall("/quiz/quiz-abc123")).toBeUndefined();
  });
});
