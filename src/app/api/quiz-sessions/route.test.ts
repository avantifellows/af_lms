import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import {
  ADMIN_SESSION,
  NO_SESSION,
  jsonRequest,
} from "../__test-utils__/api-test-helpers";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockQuery: vi.fn(),
  mockPublishMessage: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.mockGetServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mocks.mockGetUserPermission,
}));
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
  mocks.mockGetUserPermission.mockReset();
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

describe("GET /api/quiz-sessions", () => {
  it("returns 401 when not authenticated", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions?schoolId=42")
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns paginated quiz sessions scoped to the school's class batches", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue({ program_ids: [1, 64] });
    mocks.mockQuery
      .mockResolvedValueOnce([
        {
          id: 11,
          name: "Class 11 Engg A",
          batch_id: "EnableStudents_11_Engg_A",
          parent_id: 5,
          program_id: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 99,
          name: "[LMS] Part Test 1",
          start_time: "2026-04-15 15:00:00",
          end_time: "2026-04-15 19:00:00",
          is_active: true,
          portal_link: "https://quiz.example/session/99",
          platform: "quiz",
          meta_data: {
            batch_id: "EnableStudents_11_Engg_A",
            date_created: "2026-04-15T13:30:00.000Z",
          },
        },
      ]);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions?schoolId=42&page=0&per_page=10")
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      hasMore: false,
      sessions: [
        expect.objectContaining({
          id: 99,
          name: "[LMS] Part Test 1",
          start_time: "2026-04-15T09:30:00.000Z",
          end_time: "2026-04-15T13:30:00.000Z",
          meta_data: expect.objectContaining({
            batch_id: "EnableStudents_11_Engg_A",
            date_created: "2026-04-15T08:00:00.000Z",
          }),
        }),
      ],
    });

    expect(mocks.mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("FROM session s"),
      [["EnableStudents_11_Engg_A"], 11, 0]
    );
  });
});

describe("POST /api/quiz-sessions", () => {
  it("returns 400 when selected template grade does not match the selected batches", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 501,
        type: "quiz_template",
        code: "PT-12",
        name: [{ resource: "Part Test 12", lang_code: "en" }],
        type_params: {
          grade: 12,
          stream: "engineering",
          test_format: "part_test",
          test_purpose: "weekly_test",
          test_type: "assessment",
          cms_link: "https://cms.example/tests/pt-12",
          question_pdf: "https://cdn.example/question.pdf",
          solution_pdf: "https://cdn.example/solution.pdf",
        },
      })
    );

    const res = await POST(
      jsonRequest("http://localhost/api/quiz-sessions", {
        method: "POST",
        body: {
          resourceId: 501,
          grade: 11,
          parentBatchId: "EnableStudents_11_Engg",
          classBatchIds: ["EnableStudents_11_Engg_A"],
          stream: "engineering",
          startTime: "2026-04-15T04:30:00.000Z",
          endTime: "2026-04-15T08:30:00.000Z",
        },
      }) as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Selected template grade does not match selected batches",
    });
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    expect(mocks.mockPublishMessage).not.toHaveBeenCalled();
  });

  it("creates a quiz session, prefixes the default LMS name, and queues session creation", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          id: 501,
          type: "quiz_template",
          code: "PT-11",
          name: [{ resource: "Part Test 11", lang_code: "en" }],
          type_params: {
            grade: 11,
            course: "JEE",
            stream: "engineering",
            test_format: "part_test",
            test_purpose: "weekly_test",
            test_type: "assessment",
            optional_limits: "JEE",
            cms_link: "https://cms.example/tests/pt-11",
            question_pdf: "https://cdn.example/question.pdf",
            solution_pdf: "https://cdn.example/solution.pdf",
            ranking_cutoff_date: "2026-04-20",
            sheet_name: "Part Tests",
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 321 }));

    const res = await POST(
      jsonRequest("http://localhost/api/quiz-sessions", {
        method: "POST",
        body: {
          resourceId: 501,
          grade: 11,
          parentBatchId: "EnableStudents_11_Engg",
          classBatchIds: ["EnableStudents_11_Engg_A", "EnableStudents_11_Engg_B"],
          stream: "engineering",
          showAnswers: false,
          showScores: true,
          shuffle: true,
          gurukulFormatType: "omr",
          startTime: "2026-04-15T04:30:00.000Z",
          endTime: "2026-04-15T08:30:00.000Z",
        },
      }) as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: 321 });

    expect(mocks.mockFetch).toHaveBeenCalledTimes(2);
    expect(mocks.mockFetch.mock.calls[1]?.[0]).toBe("http://db-service.local/session");
    const createPayload = JSON.parse(
      String((mocks.mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    );
    expect(createPayload).toMatchObject({
      name: "[LMS] Part Test 11",
      platform: "quiz",
      start_time: "2026-04-15T10:00:00.000Z",
      end_time: "2026-04-15T14:00:00.000Z",
      meta_data: {
        parent_id: "EnableStudents_11_Engg",
        batch_id: "EnableStudents_11_Engg_A,EnableStudents_11_Engg_B",
        grade: 11,
        stream: "engineering",
        resource_id: 501,
        resource_name: "Part Test 11",
        test_code: "PT-11",
        show_answers: false,
        show_scores: true,
        shuffle: true,
        gurukul_format_type: "omr",
        status: "pending",
        has_synced_to_bq: false,
      },
    });
    expect(mocks.mockPublishMessage).toHaveBeenCalledWith({
      action: "db_id",
      id: 321,
    });
  });
});
