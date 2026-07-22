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
  mockRequireQuizSessionAccess: vi.fn(),
  mockCanAccessQuizSessionSchool: vi.fn(),
  mockCanAccessQuizSessionBatches: vi.fn(),
  mockResolveBatchGroups: vi.fn(),
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
vi.mock("@/lib/quiz-session-access", () => ({
  requireQuizSessionAccess: mocks.mockRequireQuizSessionAccess,
  canAccessQuizSessionSchool: mocks.mockCanAccessQuizSessionSchool,
  canAccessQuizSessionBatches: mocks.mockCanAccessQuizSessionBatches,
  resolveBatchGroups: mocks.mockResolveBatchGroups,
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
  mocks.mockRequireQuizSessionAccess.mockReset();
  mocks.mockCanAccessQuizSessionSchool.mockReset();
  mocks.mockCanAccessQuizSessionBatches.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockPublishMessage.mockReset();
  mocks.mockFetch.mockReset();
  vi.stubGlobal("fetch", mocks.mockFetch);
  mocks.mockRequireQuizSessionAccess.mockResolvedValue({
    ok: true,
    permission: { program_ids: [1, 64] },
  });
  mocks.mockCanAccessQuizSessionSchool.mockResolvedValue(true);
  mocks.mockCanAccessQuizSessionBatches.mockResolvedValue(true);
  // Default: the test class batch resolves to EnableStudents / ID,DOB.
  mocks.mockResolveBatchGroups.mockResolvedValue(
    new Map([["EnableStudents_11_Engg_A", { group: "EnableStudents", authType: "ID,DOB" }]])
  );
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
      // groups (derived from the class batch prefix), then class batch ids, limit, offset
      [["EnableStudents"], ["EnableStudents_11_Engg_A"], 11, 0]
    );
    expect(mocks.mockRequireQuizSessionAccess).toHaveBeenCalledWith(
      ADMIN_SESSION.user.email,
      "view"
    );
  });

  it("narrows the batch scope to ?programId= when the viewer holds that program", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await GET(
      new NextRequest("http://localhost/api/quiz-sessions?schoolId=42&programId=1")
    );

    // Viewer holds [1, 64]; the centre page's programId=1 narrows to [1].
    expect(mocks.mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("FROM school_batch sb"),
      [42, [1]]
    );
  });

  it("returns no sessions for a ?programId= the viewer does not hold", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions?schoolId=42&programId=2")
    );

    // Intersection of [1, 64] with 2 is empty — the param can only restrict,
    // never widen, so no batch query runs and the list is empty.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sessions: [], hasMore: false });
    expect(mocks.mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 when the user cannot view quiz sessions", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockRequireQuizSessionAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions?schoolId=42")
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 when the user cannot access the requested school", async () => {
    const { GET } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockCanAccessQuizSessionSchool.mockResolvedValue(false);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions?schoolId=42")
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockQuery).not.toHaveBeenCalled();
  });
});

describe("POST /api/quiz-sessions", () => {
  it("returns 400 when selected template is missing grade metadata", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 501,
        type: "quiz_template",
        code: "PT-12",
        name: [{ resource: "Part Test 12", lang_code: "en" }],
        type_params: {
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
      error: "Selected template is missing grade metadata",
    });
    expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
    expect(mocks.mockPublishMessage).not.toHaveBeenCalled();
  });

  it("returns 403 when the user cannot edit quiz sessions", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockRequireQuizSessionAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

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

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockFetch).not.toHaveBeenCalled();
    expect(mocks.mockPublishMessage).not.toHaveBeenCalled();
  });

  it("returns 403 when the selected class batches are outside the user's schools", async () => {
    const { POST } = await loadRouteModule();
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockCanAccessQuizSessionBatches.mockResolvedValue(false);

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

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockFetch).not.toHaveBeenCalled();
    expect(mocks.mockPublishMessage).not.toHaveBeenCalled();
  });

  it("creates a quiz session and queues session creation", async () => {
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
          name: "Custom admin session",
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
      name: "Custom admin session",
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
        gurukul_format_type: "qa",
        status: "pending",
        has_synced_to_bq: false,
        created_by: ADMIN_SESSION.user.email,
        created_from: "lms",
      },
    });
    expect(mocks.mockPublishMessage).toHaveBeenCalledWith({
      action: "db_id",
      id: 321,
    });
  });
});
