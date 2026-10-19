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

import { GET, PUT } from "./route";
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
  details: ["lms_curriculum_plan_assignments.centre_id"],
};

const URL_PATH = "/api/curriculum/plans/7/assignments";

function list() {
  return GET(new NextRequest(new URL(URL_PATH, "http://localhost")), routeParams({ id: "7" }));
}

function save(body: unknown) {
  return PUT(
    new NextRequest(new URL(URL_PATH, "http://localhost"), {
      method: "PUT",
      body: JSON.stringify(body),
    }),
    routeParams({ id: "7" })
  );
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

describe("GET /api/curriculum/plans/7/assignments guard", () => {
  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await list();
    expect(res.status).toBe(401);
    expectNoDataAccess();
  });

  it.each([
    ["program manager", PROGRAM_MANAGER],
    ["program admin", PROGRAM_ADMIN],
  ])("returns 403 for a %s before touching data", async (_role, permission) => {
    mockGetUserPermission.mockResolvedValue(permission);
    const res = await list();
    expect(res.status).toBe(403);
    expectNoDataAccess();
  });

  it("lets a read-only Admin read (503 while the plan schema is unavailable)", async () => {
    mockGetUserPermission.mockResolvedValue(READ_ONLY_ADMIN);
    const res = await list();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });
});

describe("PUT /api/curriculum/plans/7/assignments guard", () => {
  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await save({ centre_ids: [1] });
    expect(res.status).toBe(401);
    expectNoDataAccess();
  });

  it.each([
    ["program manager", PROGRAM_MANAGER],
    ["program admin", PROGRAM_ADMIN],
    ["read-only Admin", READ_ONLY_ADMIN],
  ])("returns 403 for a %s before touching data", async (_role, permission) => {
    mockGetUserPermission.mockResolvedValue(permission);
    const res = await save({ centre_ids: [1] });
    expect(res.status).toBe(403);
    expectNoDataAccess();
  });

  it("returns 503 for an Admin while the plan schema is unavailable", async () => {
    const res = await save({ centre_ids: [1] });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });

  it("returns 400 when centre_ids is not a list of Centre ids, without writing", async () => {
    mockCheckSchema.mockResolvedValue({ ok: true });
    for (const body of [{}, { centre_ids: "1,2" }, { centre_ids: [1, "x"] }]) {
      const res = await save(body);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        errors: [{ field: "centre_ids", message: "centre_ids must be a list of Centre ids" }],
      });
    }
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
