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

import { POST } from "./route";
import { ADMIN_SESSION, routeParams } from "../../../../__test-utils__/api-test-helpers";

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

const handlers = {
  "POST /api/curriculum/plans/7/activate": () =>
    POST(req("/api/curriculum/plans/7/activate", { method: "POST" }), routeParams({ id: "7" })),
};
const writes = handlers;

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
