import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import {
  ADMIN_SESSION,
  NO_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.mockGetServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

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
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DB_SERVICE_URL;
  delete process.env.DB_SERVICE_TOKEN;
});

describe("GET /api/quiz-sessions/templates", () => {
  it("returns 401 when not authenticated", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/templates?grade=11")
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("filters parsed quiz templates by grade, stream, format, search, and active state", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 501,
          type: "quiz_template",
          code: "PT-11",
          name: [{ resource: "Engineering Part Test", lang_code: "en" }],
          type_params: {
            grade: 11,
            stream: "engineering",
            test_format: "part_test",
            test_purpose: "weekly_test",
            test_type: "assessment",
            cms_link: "https://cms.example/tests/pt-11",
            is_active: true,
          },
        },
        {
          id: 502,
          type: "quiz_template",
          code: "PT-11-MED",
          name: [{ resource: "Medical Part Test", lang_code: "en" }],
          type_params: {
            grade: 11,
            stream: "medical",
            test_format: "part_test",
            test_purpose: "weekly_test",
            test_type: "assessment",
            cms_link: "https://cms.example/tests/pt-11-med",
            is_active: true,
          },
        },
        {
          id: 503,
          type: "quiz_template",
          code: "PT-11-INACTIVE",
          name: [{ resource: "Inactive Test", lang_code: "en" }],
          type_params: {
            grade: 11,
            stream: "engineering",
            test_format: "part_test",
            test_purpose: "weekly_test",
            test_type: "assessment",
            cms_link: "https://cms.example/tests/pt-11-inactive",
            is_active: false,
          },
        },
      ])
    );

    const res = await GET(
      new NextRequest(
        "http://localhost/api/quiz-sessions/templates?grade=11&stream=engineering&testFormat=part_test&search=engineering"
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      templates: [
        expect.objectContaining({
          id: 501,
          code: "PT-11",
          name: "Engineering Part Test",
          stream: "engineering",
          testFormat: "part_test",
        }),
      ],
    });
    expect(mocks.mockFetch.mock.calls[0]?.[0]).toBe(
      "http://db-service.local/resource?type=quiz_template&limit=1000&sort_by=code&sort_order=asc"
    );
  });

  it("forwards downstream failure status when template fetch fails", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockFetch.mockResolvedValueOnce(new Response("service unavailable", { status: 503 }));

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/templates?grade=11")
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Failed to fetch quiz templates",
    });
  });
});
