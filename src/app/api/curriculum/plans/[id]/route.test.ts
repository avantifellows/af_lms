import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetServerSession, mockGetUserPermission, mockQuery, mockWithTransaction, mockCheckSchema } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockGetUserPermission: vi.fn(),
    mockQuery: vi.fn(),
    mockWithTransaction: vi.fn(),
    mockCheckSchema: vi.fn(),
  }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getUserPermission: mockGetUserPermission }));
vi.mock("@/lib/db", () => ({ query: mockQuery, withTransaction: mockWithTransaction }));
vi.mock("@/lib/curriculum-schema", () => ({ checkCurriculumPlansSchema: mockCheckSchema }));

import { GET, PATCH } from "./route";
import { ADMIN_SESSION, routeParams } from "../../../__test-utils__/api-test-helpers";

const ADMIN = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
};
const READ_ONLY_ADMIN = { ...ADMIN, read_only: true };
const PROGRAM_MANAGER = { ...ADMIN, role: "program_manager", level: 2, regions: ["AHMEDABAD"] };
const PROGRAM_ADMIN = { ...ADMIN, role: "program_admin", level: 2, regions: ["AHMEDABAD"] };
const SCHEMA_UNAVAILABLE = {
  ok: false,
  status: 503,
  error: "LMS curriculum schema unavailable",
  details: ["lms_curriculum_plans.id"],
};

function req(url: string, init?: { method: string; body?: unknown }) {
  return new NextRequest(new URL(url, "http://localhost"), {
    method: init?.method ?? "GET",
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
  mockGetUserPermission.mockResolvedValue(ADMIN);
  mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
});

function expectNoDataAccess() {
  expect(mockCheckSchema).not.toHaveBeenCalled();
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockWithTransaction).not.toHaveBeenCalled();
}

const PLAN_BODY = {
  title: "G11 2026-27",
  exam_tracks: ["jee_main"],
  academic_year: "2026-2027",
  grade: 11,
  closure_date: "2027-02-28",
};

const handlers = {
  "GET /api/curriculum/plans/7": () => GET(req("/api/curriculum/plans/7"), routeParams({ id: "7" })),
  "PATCH /api/curriculum/plans/7": () =>
    PATCH(
      req("/api/curriculum/plans/7", { method: "PATCH", body: PLAN_BODY }),
      routeParams({ id: "7" })
    ),
};
const writes = { "PATCH /api/curriculum/plans/7": handlers["PATCH /api/curriculum/plans/7"] };
const reads = { "GET /api/curriculum/plans/7": handlers["GET /api/curriculum/plans/7"] };

describe.each(Object.entries(handlers))("%s guard", (_name, call) => {
  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expectNoDataAccess();
  });

  it.each([
    ["program manager", PROGRAM_MANAGER],
    ["program admin", PROGRAM_ADMIN],
  ])("returns 403 for a %s", async (_role, permission) => {
    mockGetUserPermission.mockResolvedValue(permission);
    const res = await call();
    expect(res.status).toBe(403);
    expectNoDataAccess();
  });

  it("returns 503 for an Admin while the plan schema is unavailable", async () => {
    const res = await call();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });
});

describe.each(Object.entries(writes))("%s for a read-only Admin", (_name, call) => {
  it("returns 403 before touching data", async () => {
    mockGetUserPermission.mockResolvedValue(READ_ONLY_ADMIN);
    const res = await call();
    expect(res.status).toBe(403);
    expectNoDataAccess();
  });
});

if (Object.keys(reads).length > 0) {
  describe.each(Object.entries(reads))("%s for a read-only Admin", (_name, call) => {
    it("passes the guard (read-only Admins can view)", async () => {
      mockGetUserPermission.mockResolvedValue(READ_ONLY_ADMIN);
      const res = await call();
      expect(res.status).toBe(503);
    });
  });
}
