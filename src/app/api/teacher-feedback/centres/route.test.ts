import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/quiz-session-access", () => ({ canAccessQuizSessionSchool: vi.fn() }));
vi.mock("@/lib/teacher-feedback-access", () => ({ authenticateTeacherFeedback: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { NextRequest } from "next/server";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { query } from "@/lib/db";
import { GET } from "./route";

const mockAuth = vi.mocked(authenticateTeacherFeedback);
const mockSchool = vi.mocked(canAccessQuizSessionSchool);
const mockQuery = vi.mocked(query);

const PERMISSION = { email: "pm@avantifellows.org", level: 3 } as never;
const denied = (status: number) => ({
  ok: false as const,
  response: Response.json({ error: "x" }, { status }) as never,
});

function req(code?: string) {
  const url = code
    ? `http://localhost/api/teacher-feedback/centres?school_code=${code}`
    : "http://localhost/api/teacher-feedback/centres";
  return new NextRequest(new URL(url));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ ok: true, permission: PERMISSION });
  mockSchool.mockResolvedValue(true);
});

describe("GET /api/teacher-feedback/centres", () => {
  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(denied(401));
    expect((await GET(req("34054"))).status).toBe(401);
  });

  it("400 when school_code missing", async () => {
    expect((await GET(req())).status).toBe(400);
  });

  it("404 when school not found", async () => {
    mockQuery.mockResolvedValueOnce([] as never);
    expect((await GET(req("99999"))).status).toBe(404);
  });

  it("403 when the PM can't access the school", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 408 }] as never);
    mockSchool.mockResolvedValue(false);
    expect((await GET(req("34054"))).status).toBe(403);
  });

  it("returns the school's active centres", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 408 }] as never) // school
      .mockResolvedValueOnce([
        { id: 40, name: "JNV Palghar - CoE", type_code: "coe" },
        { id: 41, name: "JNV Palghar - Nodal", type_code: "nodal" },
      ] as never);

    const res = await GET(req("34054"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.centres).toHaveLength(2);
    expect(json.centres[0]).toMatchObject({ id: 40, name: "JNV Palghar - CoE", typeCode: "coe" });
  });
});
