import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/quiz-session-access", () => ({ canAccessQuizSessionSchool: vi.fn() }));
vi.mock("@/lib/teacher-feedback-access", () => ({ authenticateTeacherFeedback: vi.fn() }));
vi.mock("@/lib/teacher-feedback-batches", () => ({
  getCentreScope: vi.fn(),
  getBatchesForCentre: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { NextRequest } from "next/server";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { getBatchesForCentre, getCentreScope } from "@/lib/teacher-feedback-batches";
import { query } from "@/lib/db";
import { GET } from "./route";

const mockAuth = vi.mocked(authenticateTeacherFeedback);
const mockSchool = vi.mocked(canAccessQuizSessionSchool);
const mockScope = vi.mocked(getCentreScope);
const mockBatches = vi.mocked(getBatchesForCentre);
const mockQuery = vi.mocked(query);

const PERMISSION = { email: "pm@avantifellows.org", level: 3 } as never;
const denied = (status: number) => ({
  ok: false as const,
  response: Response.json({ error: "x" }, { status }) as never,
});

function req(centreId?: string) {
  const url = centreId
    ? `http://localhost/api/teacher-feedback/batches?centre_id=${centreId}`
    : "http://localhost/api/teacher-feedback/batches";
  return new NextRequest(new URL(url));
}

const BATCH = {
  id: 1008,
  name: "CoE JNV Chandrapur 2028 Engineering",
  batch_id: "EnableStudents_TP_2028_engg_C008",
  parent_id: 958,
  program_id: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ ok: true, permission: PERMISSION });
  mockSchool.mockResolvedValue(true);
  mockScope.mockResolvedValue({ centreId: 38, schoolId: 393, programId: 1 });
  mockBatches.mockResolvedValue([BATCH]);
});

describe("GET /api/teacher-feedback/batches", () => {
  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(denied(401));
    expect((await GET(req("38"))).status).toBe(401);
  });

  it("403 when lacking teacher-feedback edit access", async () => {
    mockAuth.mockResolvedValue(denied(403));
    expect((await GET(req("38"))).status).toBe(403);
  });

  it("400 when centre_id is missing or not a positive integer", async () => {
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("abc"))).status).toBe(400);
    expect((await GET(req("0"))).status).toBe(400);
    expect((await GET(req("-3"))).status).toBe(400);
  });

  it("404 for an unknown, inactive, or school-less centre", async () => {
    mockScope.mockResolvedValue(null);
    expect((await GET(req("999"))).status).toBe(404);
  });

  it("403 when the PM cannot access the centre's school", async () => {
    mockSchool.mockResolvedValue(false);
    expect((await GET(req("38"))).status).toBe(403);
    expect(mockBatches).not.toHaveBeenCalled();
  });

  it("returns the centre's batches", async () => {
    const res = await GET(req("38"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.batches).toEqual([BATCH]);
    // Scope is resolved server-side from the centre, never taken from the client.
    expect(mockBatches).toHaveBeenCalledWith({
      centreId: 38,
      schoolId: 393,
      programId: 1,
    });
  });

  it("explains an empty list when the centre has no programme", async () => {
    // Otherwise the picker's empty state is indistinguishable from still loading.
    mockScope.mockResolvedValue({ centreId: 16, schoolId: 336, programId: null });
    mockBatches.mockResolvedValue([]);
    mockQuery.mockResolvedValue([{ name: "Nagaland Foundation" }] as never);

    const res = await GET(req("16"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.batches).toEqual([]);
    expect(json.reason).toMatch(/Nagaland Foundation/);
    expect(json.reason).toMatch(/no programme set/i);
  });

  it("returns a plain empty list when the centre has a programme but no cohorts", async () => {
    mockBatches.mockResolvedValue([]);
    const res = await GET(req("38"));
    const json = await res.json();
    expect(json.batches).toEqual([]);
    expect(json.reason).toBeUndefined();
  });
});
