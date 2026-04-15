import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ADMIN_SESSION,
  NO_SESSION,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
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
  mocks.mockQuery.mockReset();
  mocks.mockPublishMessage.mockReset();
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DB_SERVICE_URL;
  delete process.env.DB_SERVICE_TOKEN;
});

describe("POST /api/quiz-sessions/[id]/regenerate", () => {
  it("returns 401 when not authenticated", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when the session does not exist", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([]);

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Session not found" });
  });

  it("marks the session pending and publishes regeneration", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      {
        id: 42,
        meta_data: JSON.stringify({ status: "synced", extra: "keep" }),
      },
    ]);
    mocks.mockFetch.mockResolvedValueOnce(jsonResponse({ id: 42 }));

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      message: "Regeneration requested.",
    });

    const patchBody = JSON.parse(
      String((mocks.mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    );
    expect(patchBody).toEqual({
      meta_data: {
        status: "pending",
        extra: "keep",
      },
    });
    expect(mocks.mockPublishMessage).toHaveBeenCalledWith({
      action: "regenerate_quiz",
      id: 42,
    });
  });

  it("forwards downstream failure status when regeneration cannot be queued", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([{ id: 42, meta_data: {} }]);
    mocks.mockFetch.mockResolvedValueOnce(new Response("downstream error", { status: 502 }));

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Failed to queue regeneration",
    });
    expect(mocks.mockPublishMessage).not.toHaveBeenCalled();
  });
});
