import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import {
  ADMIN_SESSION,
  NO_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireQuizSessionAccess: vi.fn(),
  mockBatchesForCentre: vi.fn(),
  mockUserCanAccessCentre: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.mockGetServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/quiz-session-access", () => ({
  requireQuizSessionAccess: mocks.mockRequireQuizSessionAccess,
}));
vi.mock("@/lib/centre-batch", () => ({
  batchesForCentre: mocks.mockBatchesForCentre,
  userCanAccessCentre: mocks.mockUserCanAccessCentre,
}));
vi.mock("@/lib/db", () => ({
  query: mocks.mockQuery,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.mockGetServerSession.mockReset();
  mocks.mockRequireQuizSessionAccess.mockReset();
  mocks.mockBatchesForCentre.mockReset();
  mocks.mockUserCanAccessCentre.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockRequireQuizSessionAccess.mockResolvedValue({
    ok: true,
    permission: { scope: { centres: "all" } },
  });
  mocks.mockUserCanAccessCentre.mockReturnValue(true);
  mocks.mockBatchesForCentre.mockResolvedValue([]);
});

describe("GET /api/quiz-sessions/batches", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?centreId=42")
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when centreId is missing", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches")
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "centreId is required" });
  });

  it("returns 400 for an invalid centre id", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?centreId=abc")
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid centreId" });
  });

  it("returns 403 when the user cannot view quiz sessions", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockRequireQuizSessionAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?centreId=42")
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockBatchesForCentre).not.toHaveBeenCalled();
  });

  it("returns 403 when the user holds no seat at the centre", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockUserCanAccessCentre.mockReturnValue(false);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?centreId=42")
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.mockBatchesForCentre).not.toHaveBeenCalled();
  });

  it("returns the centre's batches and appends missing parent rows", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockBatchesForCentre.mockResolvedValue([
      {
        id: 11,
        name: "Class 11 Engg A",
        batch_id: "EnableStudents_11_Engg_A",
        parent_id: 5,
        program_id: 1,
      },
    ]);
    // parent-batch backfill query
    mocks.mockQuery.mockResolvedValueOnce([
      {
        id: 5,
        name: "Parent Batch",
        batch_id: "EnableStudents_11_Engg",
        parent_id: null,
        program_id: 1,
      },
    ]);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?centreId=42")
    );

    expect(res.status).toBe(200);
    expect(mocks.mockBatchesForCentre).toHaveBeenCalledWith(42);
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

  it("does no parent backfill when all parents are present", async () => {
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockBatchesForCentre.mockResolvedValue([
      {
        id: 5,
        name: "Parent Batch",
        batch_id: "EnableStudents_11_Engg",
        parent_id: null,
        program_id: 1,
      },
    ]);

    const res = await GET(
      new NextRequest("http://localhost/api/quiz-sessions/batches?centreId=42")
    );

    expect(res.status).toBe(200);
    expect(mocks.mockQuery).not.toHaveBeenCalled();
  });
});
