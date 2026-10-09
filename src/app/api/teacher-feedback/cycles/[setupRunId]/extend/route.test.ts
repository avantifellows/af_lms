import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/teacher-feedback-access", () => ({ authenticateTeacherFeedback: vi.fn() }));
vi.mock("@/lib/teacher-feedback-rounds", () => ({ loadAuthorizedRound: vi.fn() }));
vi.mock("@/lib/teacher-feedback-session", () => ({ extendFeedbackSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { NextRequest } from "next/server";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { loadAuthorizedRound } from "@/lib/teacher-feedback-rounds";
import { extendFeedbackSession } from "@/lib/teacher-feedback-session";
import { query } from "@/lib/db";
import { POST } from "./route";

const ROWS = [
  { teacher_name: "Asha", status: "created", session_pk: "11", session_id: "s-11", end_time: "2026-09-17 04:30:00" },
  { teacher_name: "Ravi", status: "created", session_pk: "12", session_id: "s-12", end_time: "2026-09-17 04:30:00" },
];

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/teacher-feedback/cycles/run-1/extend", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ setupRunId: "run-1" }) }
  );
}

const future = () => new Date(Date.now() + 3 * 86400_000).toISOString();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateTeacherFeedback).mockResolvedValue({ ok: true, permission: {} } as never);
  vi.mocked(loadAuthorizedRound).mockResolvedValue({ ok: true, rows: ROWS } as never);
});

describe("POST /api/teacher-feedback/cycles/:setupRunId/extend", () => {
  it("needs edit access and passes the caller's denial through", async () => {
    vi.mocked(authenticateTeacherFeedback).mockResolvedValue({
      ok: false,
      response: Response.json({}, { status: 403 }),
    } as never);
    expect((await post({ endTime: future() })).status).toBe(403);
    expect(authenticateTeacherFeedback).toHaveBeenCalledWith("edit");
    expect(extendFeedbackSession).not.toHaveBeenCalled();
  });

  it("extends every teacher's session and the round rows", async () => {
    const endTime = future();
    const res = await post({ endTime });

    expect(res.status).toBe(200);
    expect(extendFeedbackSession).toHaveBeenCalledWith(11, "s-11", endTime);
    expect(extendFeedbackSession).toHaveBeenCalledWith(12, "s-12", endTime);
    expect(query).toHaveBeenCalledTimes(2);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([endTime, "run-1", 11]);
  });

  it("rejects an end time in the past or missing", async () => {
    expect((await post({ endTime: "2020-01-01T00:00:00Z" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(extendFeedbackSession).not.toHaveBeenCalled();
  });

  it("names the teachers it could not extend and keeps the rest", async () => {
    vi.mocked(extendFeedbackSession).mockImplementation(async (pk) => {
      if (pk === 12) throw new Error("PATCH failed");
    });
    const res = await post({ endTime: future() });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Ravi");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("refuses to shorten a round that ends later than the new time", async () => {
    const later = new Date(Date.now() + 10 * 86400_000).toISOString().replace("T", " ").slice(0, 19);
    vi.mocked(loadAuthorizedRound).mockResolvedValue({
      ok: true,
      rows: ROWS.map((r) => ({ ...r, end_time: later })),
    } as never);
    const res = await post({ endTime: future() });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/after the current end/);
    expect(extendFeedbackSession).not.toHaveBeenCalled();
  });

  it("skips teachers whose setup or build failed instead of failing the round", async () => {
    vi.mocked(loadAuthorizedRound).mockResolvedValue({
      ok: true,
      rows: [
        ...ROWS,
        { ...ROWS[0], teacher_name: "Failed", status: "failed", session_pk: null, session_id: null },
        { ...ROWS[0], teacher_name: "NoBuild", session_pk: "13", session_id: "" },
      ],
    } as never);
    const res = await post({ endTime: future() });

    expect(res.status).toBe(200);
    expect(extendFeedbackSession).toHaveBeenCalledTimes(2);
  });
});
