import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./quiz-session-access", () => ({ canAccessQuizSessionSchool: vi.fn() }));

import { query } from "./db";
import { canAccessQuizSessionSchool } from "./quiz-session-access";
import { getRoundRoster, loadAuthorizedRound } from "./teacher-feedback-rounds";

const mockQuery = vi.mocked(query);
const PM = { email: "pm@avantifellows.org", level: 3 } as never;
// requireCentreScope stays real: a seated user is confined to their centres.
const seatedAt = (centreIds: number[]) =>
  ({ email: "pm@avantifellows.org", level: 1, scope: { centres: new Set(centreIds) } }) as never;

const row = { teacher_name: "Indrani Khan", teacher_order: 1, school_id: 5, centre_id: "7" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(canAccessQuizSessionSchool).mockResolvedValue(true);
});

describe("loadAuthorizedRound", () => {
  it("returns the round's rows when the caller may see it", async () => {
    mockQuery.mockResolvedValueOnce([row]);
    const result = await loadAuthorizedRound("run-1", PM);

    expect(result).toEqual({ ok: true, rows: [row] });
    expect(mockQuery.mock.calls[0][1]).toEqual(["run-1"]);
  });

  it("404s an unknown round", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await loadAuthorizedRound("nope", PM);
    expect(result.ok || result.response.status).toBe(404);
  });

  it("403s when the caller can't access the school, or it has none", async () => {
    vi.mocked(canAccessQuizSessionSchool).mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce([row]);
    const denied = await loadAuthorizedRound("run-1", PM);
    expect(denied.ok || denied.response.status).toBe(403);

    mockQuery.mockResolvedValueOnce([{ ...row, school_id: null }]);
    const noSchool = await loadAuthorizedRound("run-1", PM);
    expect(noSchool.ok || noSchool.response.status).toBe(403);
  });

  it("confines a seated caller to their own centres", async () => {
    mockQuery.mockResolvedValueOnce([row]);
    const elsewhere = await loadAuthorizedRound("run-1", seatedAt([99]));
    expect(elsewhere.ok || elsewhere.response.status).toBe(403);

    mockQuery.mockResolvedValueOnce([row]);
    expect((await loadAuthorizedRound("run-1", seatedAt([7]))).ok).toBe(true);
  });
});

describe("getRoundRoster", () => {
  it("skips the query with no batches", async () => {
    expect(await getRoundRoster([])).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("reads current, non-dropout students of the batches", async () => {
    mockQuery.mockResolvedValueOnce([{ user_id: "1", student_id: "S1", name: "Anil", batch_id: "B27" }]);
    expect(await getRoundRoster(["B27"])).toHaveLength(1);
    expect(mockQuery.mock.calls[0][0]).toContain("is_current = true");
    expect(mockQuery.mock.calls[0][1]).toEqual([["B27"]]);
  });
});
