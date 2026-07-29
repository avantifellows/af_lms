import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ADMIN_SESSION,
  NO_SESSION,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";

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
  quizBackendUrl?: string;
}) {
  vi.resetModules();
  process.env.DB_SERVICE_URL = env?.dbServiceUrl ?? "http://db-service.local";
  process.env.DB_SERVICE_TOKEN = env?.dbServiceToken ?? "test-token";
  process.env.QUIZ_BACKEND_URL = env?.quizBackendUrl ?? "http://quiz-backend.local";
  return import("./route");
}

// A CMS-sourced session row: cms_source is the discriminator that routes regenerate to
// quiz-backend instead of the legacy SNS path.
function cmsSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    platform_id: "quiz-abc123",
    end_time: "2026-04-15 14:00:00",
    meta_data: {
      cms_source: "nex-gen-cms",
      cms_test_id: "504",
      cms_curriculum_id: "1",
      cms_grade_id: "7",
      status: "success",
    },
    ...overrides,
  };
}

function fetchCall(urlSubstr: string) {
  return mocks.mockFetch.mock.calls.find((call) =>
    String(call[0]).includes(urlSubstr)
  );
}

beforeEach(() => {
  mocks.mockGetServerSession.mockReset();
  mocks.mockRequireQuizSessionAccess.mockReset();
  mocks.mockCanAccessQuizSessionBatches.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockPublishMessage.mockReset();
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
  mocks.mockRequireQuizSessionAccess.mockResolvedValue({
    ok: true,
    permission: { program_ids: [1, 64] },
  });
  mocks.mockCanAccessQuizSessionBatches.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DB_SERVICE_URL;
  delete process.env.DB_SERVICE_TOKEN;
  delete process.env.QUIZ_BACKEND_URL;
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

  it("returns 403 when the user cannot edit quiz sessions", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockRequireQuizSessionAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockQuery).not.toHaveBeenCalled();
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("returns 403 when the session belongs to inaccessible class batches", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValue([
      {
        id: 42,
        meta_data: { batch_id: "EnableStudents_11_Engg_A" },
      },
    ]);
    mocks.mockCanAccessQuizSessionBatches.mockResolvedValue(false);

    const res = await POST(new Request("http://localhost") as never, routeParams({ id: "42" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockFetch).not.toHaveBeenCalled();
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

  describe("CMS-sourced sessions", () => {
    it("regenerates in place via quiz-backend instead of the legacy SNS path", async () => {
      const { POST } = await loadRouteModule();
      mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      mocks.mockQuery.mockResolvedValue([cmsSessionRow()]);
      mocks.mockFetch.mockImplementation((input: unknown) => {
        if (String(input).includes("/quiz/")) {
          return Promise.resolve(jsonResponse({ id: "quiz-abc123", warnings: [] }));
        }
        return Promise.resolve(jsonResponse({ id: 42 }));
      });

      const res = await POST(
        new Request("http://localhost") as never,
        routeParams({ id: "42" })
      );

      expect(res.status).toBe(200);
      // The legacy Lambda rebuilds from a Google Sheet row and cannot reconstruct a CMS
      // quiz, so the SNS message must NOT be published for these.
      expect(mocks.mockPublishMessage).not.toHaveBeenCalled();

      const call = fetchCall("http://quiz-backend.local/quiz/quiz-abc123/from-cms");
      expect(call).toBeDefined();
      expect((call?.[1] as RequestInit)?.method).toBe("PUT");
      expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toEqual({
        test_id: 504,
        curriculum_id: 1,
        grade_id: 7,
        quiz_type: "assessment",
        // Stored end_time is IST wall-clock; sent as a bare wall-clock so quiz-backend can
        // re-derive answer-visibility against the refreshed quiz duration.
        session_end_time: "2026-04-15T14:00:00",
      });
    });

    it("stamps the regenerate audit fields on success", async () => {
      const { POST } = await loadRouteModule();
      mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      mocks.mockQuery.mockResolvedValue([cmsSessionRow()]);
      mocks.mockFetch.mockImplementation((input: unknown) => {
        if (String(input).includes("/quiz/")) {
          return Promise.resolve(jsonResponse({ id: "quiz-abc123", warnings: [] }));
        }
        return Promise.resolve(jsonResponse({ id: 42 }));
      });

      const res = await POST(
        new Request("http://localhost") as never,
        routeParams({ id: "42" })
      );

      expect(res.status).toBe(200);
      const auditCall = fetchCall("http://db-service.local/session/42");
      const body = JSON.parse(String((auditCall?.[1] as RequestInit)?.body));
      expect(body.meta_data.last_regenerated_by).toBe(ADMIN_SESSION.user.email);
      expect(body.meta_data.last_regenerated_at).toBeTruthy();
      // status stays "success" — a CMS regenerate is synchronous, so it must never park the
      // session in the legacy "pending" state that hides its row actions.
      expect(body.meta_data.status).toBe("success");
    });

    it("surfaces a 409 structure mismatch verbatim so the operator can act", async () => {
      const { POST } = await loadRouteModule();
      mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      mocks.mockQuery.mockResolvedValue([cmsSessionRow()]);
      mocks.mockFetch.mockImplementation((input: unknown) => {
        if (String(input).includes("/quiz/")) {
          return Promise.resolve(
            new Response("structure changed", { status: 409 })
          );
        }
        return Promise.resolve(jsonResponse({ id: 42 }));
      });

      const res = await POST(
        new Request("http://localhost") as never,
        routeParams({ id: "42" })
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/reordered, added or removed/);
      // no audit stamp on a refused regenerate
      expect(fetchCall("http://db-service.local/session/42")).toBeUndefined();
    });

    it("returns 422 when the CMS identifiers are missing", async () => {
      const { POST } = await loadRouteModule();
      mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      mocks.mockQuery.mockResolvedValue([
        cmsSessionRow({
          meta_data: { cms_source: "nex-gen-cms", cms_test_id: "504" },
        }),
      ]);

      const res = await POST(
        new Request("http://localhost") as never,
        routeParams({ id: "42" })
      );

      expect(res.status).toBe(422);
      expect(mocks.mockFetch).not.toHaveBeenCalled();
      expect(mocks.mockPublishMessage).not.toHaveBeenCalled();
    });
  });
});
