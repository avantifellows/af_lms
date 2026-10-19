// Shared scaffolding for the Curriculum Plan API route tests: the mocked session, permission,
// db and schema modules, the role fixtures, and the guard cases every plan route must pass
// (401 without a session, 403 for PMs and program admins, 403 for read-only Admins on writes,
// 503 while the plan schema is missing). Each test file wires the mocks with:
//
//   const mocks = await vi.hoisted(async () =>
//     (await import("<path>/__test-utils__/plan-route-guards")).createPlanRouteMocks()
//   );
//   vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
//   ... (see any plan route test)

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_SESSION } from "../../../__test-utils__/api-test-helpers";

export function createPlanRouteMocks() {
  return {
    getServerSession: vi.fn(),
    getUserPermission: vi.fn(),
    query: vi.fn(),
    withTransaction: vi.fn(),
    checkSchema: vi.fn(),
  };
}

type PlanRouteMocks = ReturnType<typeof createPlanRouteMocks>;

const ADMIN = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
};
export const READ_ONLY_ADMIN = { ...ADMIN, read_only: true };
const PROGRAM_MANAGER = { ...ADMIN, role: "program_manager", level: 2, regions: ["AHMEDABAD"] };
const PROGRAM_ADMIN = { ...ADMIN, role: "program_admin", level: 2, regions: ["AHMEDABAD"] };

const SCHEMA_UNAVAILABLE = {
  ok: false,
  status: 503,
  error: "LMS curriculum schema unavailable",
  details: ["lms_curriculum_plans.id"],
};

export function req(url: string, init?: { method: string; body?: unknown }) {
  return new NextRequest(new URL(url, "http://localhost"), {
    method: init?.method ?? "GET",
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

// Signed-in Admin with the plan schema unavailable, before every test.
export function defaultPlanRouteMocksBeforeEach(mocks: PlanRouteMocks) {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.getUserPermission.mockResolvedValue(ADMIN);
    mocks.checkSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
  });
}

function expectNoDataAccess(mocks: PlanRouteMocks) {
  expect(mocks.checkSchema).not.toHaveBeenCalled();
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.withTransaction).not.toHaveBeenCalled();
}

// The guard cases for one handler. Reads let a read-only Admin through (503 while the schema
// is missing); writes refuse them before touching data.
export function describePlanRouteGuard(
  mocks: PlanRouteMocks,
  name: string,
  access: "read" | "write",
  call: () => Promise<Response>
) {
  describe(`${name} guard`, () => {
    it("returns 401 without a session", async () => {
      mocks.getServerSession.mockResolvedValue(null);
      const res = await call();
      expect(res.status).toBe(401);
      expectNoDataAccess(mocks);
    });

    const refused: Array<[string, unknown]> = [
      ["program manager", PROGRAM_MANAGER],
      ["program admin", PROGRAM_ADMIN],
      ...(access === "write" ? [["read-only Admin", READ_ONLY_ADMIN] as [string, unknown]] : []),
    ];
    it.each(refused)("returns 403 for a %s before touching data", async (_role, permission) => {
      mocks.getUserPermission.mockResolvedValue(permission);
      const res = await call();
      expect(res.status).toBe(403);
      expectNoDataAccess(mocks);
    });

    it("returns 503 for an Admin while the plan schema is unavailable", async () => {
      const res = await call();
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toEqual(SCHEMA_UNAVAILABLE);
    });

    if (access === "read") {
      it("lets a read-only Admin read (503 while the plan schema is unavailable)", async () => {
        mocks.getUserPermission.mockResolvedValue(READ_ONLY_ADMIN);
        const res = await call();
        expect(res.status).toBe(503);
        await expect(res.json()).resolves.toEqual(SCHEMA_UNAVAILABLE);
        expect(mocks.withTransaction).not.toHaveBeenCalled();
      });
    }
  });
}
