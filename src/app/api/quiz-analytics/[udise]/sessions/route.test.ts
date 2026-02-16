import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ canAccessSchool: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/bigquery", () => ({ getSchoolQuizSessions: vi.fn() }));

import { getServerSession } from "next-auth";
import { canAccessSchool } from "@/lib/permissions";
import { query } from "@/lib/db";
import { getSchoolQuizSessions } from "@/lib/bigquery";
import { GET } from "./route";
import {
  routeParams,
  NO_SESSION,
  ADMIN_SESSION,
  PASSCODE_SESSION,
} from "../../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockCanAccess = vi.mocked(canAccessSchool);
const mockQuery = vi.mocked(query);
const mockGetSessions = vi.mocked(getSchoolQuizSessions);

const params = routeParams({ udise: "1234567890" });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/quiz-analytics/[udise]/sessions", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = new Request("http://localhost/api/quiz-analytics/1234567890/sessions");
    const res = await GET(req, params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when school not found", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([]);
    const req = new Request("http://localhost/api/quiz-analytics/1234567890/sessions");
    const res = await GET(req, params);
    expect(res.status).toBe(404);
  });

  it("returns 403 for passcode user with wrong school", async () => {
    mockSession.mockResolvedValue({ ...PASSCODE_SESSION, schoolCode: "99999" });
    mockQuery.mockResolvedValue([{ code: "70705", region: "North" }]);

    const req = new Request("http://localhost/api/quiz-analytics/1234567890/sessions");
    const res = await GET(req, params);
    expect(res.status).toBe(403);
  });

  it("returns 403 when email user lacks access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([{ code: "70705", region: "North" }]);
    mockCanAccess.mockResolvedValue(false);

    const req = new Request("http://localhost/api/quiz-analytics/1234567890/sessions");
    const res = await GET(req, params);
    expect(res.status).toBe(403);
  });

  it("returns sessions for authorized email user", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([{ code: "70705", region: "North" }]);
    mockCanAccess.mockResolvedValue(true);
    const sessions = [{ id: 1, name: "Quiz 1", quiz_id: "Q1" }];
    mockGetSessions.mockResolvedValue(sessions as never);

    const req = new Request("http://localhost/api/quiz-analytics/1234567890/sessions");
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sessions).toEqual(sessions);
  });

  it("returns sessions for passcode user with matching school", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);
    mockQuery.mockResolvedValue([{ code: "70705", region: "North" }]);
    const sessions = [{ id: 2, name: "Quiz 2", quiz_id: "Q2" }];
    mockGetSessions.mockResolvedValue(sessions as never);

    const req = new Request("http://localhost/api/quiz-analytics/1234567890/sessions");
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sessions).toEqual(sessions);
  });
});
