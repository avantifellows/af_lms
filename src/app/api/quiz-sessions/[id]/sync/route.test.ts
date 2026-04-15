import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ADMIN_SESSION,
  NO_SESSION,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadRouteModule(env?: {
  dbServiceUrl?: string;
  dbServiceToken?: string;
  helperUrl?: string;
}) {
  vi.resetModules();
  process.env.DB_SERVICE_URL = env?.dbServiceUrl ?? "http://db-service.local";
  process.env.DB_SERVICE_TOKEN = env?.dbServiceToken ?? "test-token";
  process.env.QUIZ_ETL_HELPER_URL = env?.helperUrl ?? "http://etl-helper.local/trigger";
  return import("./route");
}

beforeEach(() => {
  mocks.mockGetServerSession.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DB_SERVICE_URL;
  delete process.env.DB_SERVICE_TOKEN;
  delete process.env.QUIZ_ETL_HELPER_URL;
});

describe("POST /api/quiz-sessions/[id]/sync", () => {
  it("returns 401 when not authenticated", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when the session is missing auth-layer session_id", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([{ id: 42, session_id: null, meta_data: {} }]);

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Session is missing auth-layer session_id",
    });
  });

  it("queues sync, merge, and worker start, and persists pending sync status", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      {
        id: 42,
        session_id: "session-auth-42",
        meta_data: { has_synced_to_bq: false },
      },
    ]);
    mocks.mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("http://etl-helper.local/trigger")) {
        return jsonResponse({ message: "queued" });
      }
      if (url === "http://db-service.local/session/42") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      message: "Sync requested. Updated results should appear shortly.",
    });

    const helperCalls = mocks.mockFetch.mock.calls.filter(([url]) =>
      String(url).startsWith("http://etl-helper.local/trigger")
    );
    expect(helperCalls).toHaveLength(3);
    expect(helperCalls[0]?.[0]).toContain("message=session-auth-42");
    expect(helperCalls[1]?.[0]).toContain("message=merge");
    expect(helperCalls[2]?.[0]).toContain("message=start_worker");

    const patchCall = mocks.mockFetch.mock.calls.find(
      ([url]) => String(url) === "http://db-service.local/session/42"
    );
    const patchBody = JSON.parse(String((patchCall?.[1] as RequestInit).body));
    expect(patchBody).toEqual({
      meta_data: {
        has_synced_to_bq: false,
        etl_sync_status: "pending",
      },
    });
  });

  it("persists failed sync status when enqueueing the sync request fails", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      {
        id: 42,
        session_id: "session-auth-42",
        meta_data: { has_synced_to_bq: false },
      },
    ]);
    mocks.mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("http://etl-helper.local/trigger")) {
        return jsonResponse({ error: "queue down" }, 500);
      }
      if (url === "http://db-service.local/session/42") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "queue down" });

    const patchCall = mocks.mockFetch.mock.calls.find(
      ([url]) => String(url) === "http://db-service.local/session/42"
    );
    const patchBody = JSON.parse(String((patchCall?.[1] as RequestInit).body));
    expect(patchBody).toEqual({
      meta_data: {
        has_synced_to_bq: false,
        etl_sync_status: "failed",
      },
    });
  });

  it("returns a warning when the worker start call fails after sync is queued", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      {
        id: 42,
        session_id: "session-auth-42",
        meta_data: { has_synced_to_bq: false },
      },
    ]);

    let helperCallCount = 0;
    mocks.mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("http://etl-helper.local/trigger")) {
        helperCallCount += 1;
        if (helperCallCount === 3) {
          return jsonResponse({ error: "worker start failed" }, 500);
        }
        return jsonResponse({ message: "queued" });
      }
      if (url === "http://db-service.local/session/42") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      warning: "Sync requested. It may take a little longer than usual.",
    });
  });
});
