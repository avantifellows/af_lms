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

function copy(body: unknown) {
  return POST(
    new NextRequest(new URL("/api/curriculum/plans/7/copy", "http://localhost"), {
      method: "POST",
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

describe("POST /api/curriculum/plans/7/copy guard", () => {
  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await copy({ mode: "same_year" });
    expect(res.status).toBe(401);
    expectNoDataAccess();
  });

  it.each([
    ["program manager", PROGRAM_MANAGER],
    ["program admin", PROGRAM_ADMIN],
    ["read-only Admin", READ_ONLY_ADMIN],
  ])("returns 403 for a %s before touching data", async (_role, permission) => {
    mockGetUserPermission.mockResolvedValue(permission);
    const res = await copy({ mode: "next_year" });
    expect(res.status).toBe(403);
    expectNoDataAccess();
  });

  it("returns 503 for an Admin while the plan schema is unavailable", async () => {
    const res = await copy({ mode: "same_year" });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });

  it("returns 400 for an unknown copy mode without writing", async () => {
    mockCheckSchema.mockResolvedValue({ ok: true });
    const res = await copy({ mode: "last_year" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors).toEqual([
      { field: "mode", message: "Copy mode must be same_year or next_year" },
    ]);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
