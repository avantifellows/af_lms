import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/quiz-session-access", () => ({
  canAccessQuizSessionSchool: vi.fn(),
}));
vi.mock("@/lib/teacher-feedback-access", () => ({
  requireTeacherFeedbackAccess: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { requireTeacherFeedbackAccess } from "@/lib/teacher-feedback-access";
import { query } from "@/lib/db";
import { GET } from "./route";
import { PM_SESSION, NO_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockRequire = vi.mocked(requireTeacherFeedbackAccess);
const mockSchool = vi.mocked(canAccessQuizSessionSchool);
const mockQuery = vi.mocked(query);

const PERMISSION = { email: "pm@avantifellows.org", level: 3 } as never;

function req(code?: string) {
  const url = code
    ? `http://localhost/api/teacher-feedback/teachers?school_code=${code}`
    : "http://localhost/api/teacher-feedback/teachers";
  return new NextRequest(new URL(url));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSession.mockResolvedValue(PM_SESSION);
  mockRequire.mockResolvedValue({ ok: true, permission: PERMISSION });
  mockSchool.mockResolvedValue(true);
});

describe("GET /api/teacher-feedback/teachers", () => {
  it("401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    expect((await GET(req("34054"))).status).toBe(401);
  });

  it("403 when lacking edit access", async () => {
    mockRequire.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }) as never,
    });
    expect((await GET(req("34054"))).status).toBe(403);
  });

  it("400 when school_code missing", async () => {
    expect((await GET(req())).status).toBe(400);
  });

  it("404 when school not found", async () => {
    mockQuery.mockResolvedValueOnce([] as never); // school lookup
    expect((await GET(req("99999"))).status).toBe(404);
  });

  it("403 when the PM can't access the school", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 408, region: "MH" }] as never);
    mockSchool.mockResolvedValue(false);
    expect((await GET(req("34054"))).status).toBe(403);
  });

  it("returns centre-seat teachers when present", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 408, region: "MH" }] as never) // school
      .mockResolvedValueOnce([
        { hr_code: "AF836", teacher_id: "AF836", first_name: "Manjit", last_name: "Kumar", role: "maths", subject: null },
        { hr_code: "AF400", teacher_id: "AF400", first_name: "Sanjeet", last_name: "Pal", role: "chemistry", subject: "Chemistry" },
      ] as never); // centre seats

    const res = await GET(req("34054"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.source).toBe("centre_seat");
    expect(json.teachers).toHaveLength(2);
    expect(json.teachers[0]).toMatchObject({ id: "AF836", name: "Manjit Kumar", role: "maths" });
  });

  it("falls back to user_permission when no centre seats", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 408, region: "MH" }] as never) // school
      .mockResolvedValueOnce([] as never) // centre seats empty
      .mockResolvedValueOnce([
        { email: "t1@avantifellows.org", full_name: "Teacher One" },
      ] as never); // user_permission

    const res = await GET(req("34054"));
    const json = await res.json();
    expect(json.source).toBe("user_permission");
    expect(json.teachers[0]).toMatchObject({ id: "t1@avantifellows.org", name: "Teacher One" });
  });

  it("falls back when centre tables are absent (relation does not exist)", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 408, region: "MH" }] as never) // school
      .mockRejectedValueOnce(new Error('relation "centre_positions" does not exist')) // centre query throws
      .mockResolvedValueOnce([{ email: "t1@avantifellows.org", full_name: "T1" }] as never); // fallback

    const res = await GET(req("34054"));
    const json = await res.json();
    expect(json.source).toBe("user_permission");
    expect(json.teachers).toHaveLength(1);
  });
});
