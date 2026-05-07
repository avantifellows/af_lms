import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import {
  ADMIN_SESSION,
  NO_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockRequireQuizSessionAccess: vi.fn(),
  mockCanAccessQuizSessionSchool: vi.fn(),
  mockQuery: vi.fn(),
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
}));
vi.mock("@/lib/db", () => ({
  query: mocks.mockQuery,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.mockGetServerSession.mockReset();
  mocks.mockGetUserPermission.mockReset();
  mocks.mockRequireQuizSessionAccess.mockReset();
  mocks.mockCanAccessQuizSessionSchool.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockRequireQuizSessionAccess.mockResolvedValue({
    ok: true,
    permission: { program_ids: [1] },
  });
  mocks.mockCanAccessQuizSessionSchool.mockResolvedValue(true);
});

describe("GET /api/quiz-sessions/batches", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?schoolId=42")
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 for an invalid school id", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?schoolId=abc")
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid schoolId" });
  });

  it("returns 403 when the user cannot view quiz sessions", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockRequireQuizSessionAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?schoolId=42")
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 when the user cannot access the requested school", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockCanAccessQuizSessionSchool.mockResolvedValue(false);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?schoolId=42")
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockQuery).not.toHaveBeenCalled();
  });

  it("returns school batches and appends missing parent rows", async () => {
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
          id: 5,
          name: "Parent Batch",
          batch_id: "EnableStudents_11_Engg",
          parent_id: null,
          program_id: 1,
        },
      ]);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?schoolId=42")
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      batches: [
        {
          id: 11,
          name: "Class 11 Engg A",
          batch_id: "EnableStudents_11_Engg_A",
          parent_id: 5,
          program_id: 1,
        },
        {
          id: 5,
          name: "Parent Batch",
          batch_id: "EnableStudents_11_Engg",
          parent_id: null,
          program_id: 1,
        },
      ],
    });
  });

  it("falls back to global batches when the school has no mapped batch rows", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockQuery
      .mockResolvedValueOnce([])
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
          id: 5,
          name: "Parent Batch",
          batch_id: "EnableStudents_11_Engg",
          parent_id: null,
          program_id: 1,
        },
      ]);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?schoolId=42")
    );

    expect(res.status).toBe(200);
    expect(mocks.mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("FROM batch b"),
      [[1]]
    );
    await expect(res.json()).resolves.toMatchObject({
      batches: expect.arrayContaining([
        expect.objectContaining({ batch_id: "EnableStudents_11_Engg_A" }),
      ]),
    });
  });
});
