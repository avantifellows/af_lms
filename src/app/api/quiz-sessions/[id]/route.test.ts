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
  mockPublishMessage: vi.fn(),
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
vi.mock("@/lib/sns", () => ({
  publishMessage: mocks.mockPublishMessage,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadRouteModule(env?: {
  dbServiceUrl?: string;
  dbServiceToken?: string;
}) {
  vi.resetModules();
  process.env.DB_SERVICE_URL = env?.dbServiceUrl ?? "http://db-service.local";
  process.env.DB_SERVICE_TOKEN = env?.dbServiceToken ?? "test-token";
  return import("./route");
}

beforeEach(() => {
  mocks.mockGetServerSession.mockReset();
  mocks.mockRequireQuizSessionAccess.mockReset();
  mocks.mockCanAccessQuizSessionBatches.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockPublishMessage.mockReset();
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
  vi.useRealTimers();
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
});

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
      {
        id: 42,
        name: "Existing session",
        start_time: "2026-04-15T05:00:00.000Z",
        end_time: "2026-04-15T09:00:00.000Z",
        is_active: true,
        meta_data: { batch_id: "EnableStudents_11_Engg_A" },
      },
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
      {
        id: 42,
        name: "Future session",
        start_time: "2026-04-15T09:00:00.000Z",
        end_time: "2026-04-15T11:00:00.000Z",
        is_active: true,
        meta_data: { show_scores: true },
      },
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
    expect(mocks.mockPublishMessage).not.toHaveBeenCalled();
  });

  it("patches editable fields and publishes a patch event", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      {
        id: 42,
        name: "Existing session",
        start_time: "2026-04-15T05:00:00.000Z",
        end_time: "2026-04-15T09:00:00.000Z",
        is_active: true,
        meta_data: JSON.stringify({
          show_scores: true,
          show_answers: false,
          shuffle: false,
          gurukul_format_type: "both",
          untouched: "keep-me",
        }),
      },
    ]);
    mocks.mockFetch.mockResolvedValueOnce(jsonResponse({ id: 42 }));

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

    const patchBody = JSON.parse(
      String((mocks.mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    );
    expect(mocks.mockFetch.mock.calls[0]?.[0]).toBe("http://db-service.local/session/42");
    expect(patchBody).toMatchObject({
      name: "Updated session",
      is_active: false,
      start_time: "2026-04-15T10:00:00.000Z",
      end_time: "2026-04-15T14:00:00.000Z",
      meta_data: {
        show_answers: true,
        show_scores: false,
        shuffle: true,
        gurukul_format_type: "omr",
        untouched: "keep-me",
      },
    });
    expect(mocks.mockPublishMessage).toHaveBeenCalledWith({
      action: "patch",
      id: 42,
      patch_session: expect.objectContaining({
        name: "Updated session",
        is_active: false,
      }),
    });
  });

  it("ends a live session immediately", async () => {
    const { PATCH } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      {
        id: 42,
        name: "Live session",
        start_time: "2026-04-15T05:00:00.000Z",
        end_time: "2026-04-15T07:00:00.000Z",
        is_active: true,
        meta_data: {},
      },
    ]);
    mocks.mockFetch.mockResolvedValueOnce(jsonResponse({ id: 42 }));
    vi.setSystemTime(new Date("2026-04-15T06:00:00.000Z"));

    const res = await PATCH(
      jsonRequest("http://localhost/api/quiz-sessions/42", {
        method: "PATCH",
        body: { action: "end_now" },
      }) as never,
      routeParams({ id: "42" })
    );

    expect(res.status).toBe(200);
    const patchBody = JSON.parse(
      String((mocks.mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    );
    expect(patchBody.end_time).toBe("2026-04-15T11:30:00.000Z");
  });
});
