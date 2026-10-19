import { expect, it, vi } from "vitest";

const mocks = await vi.hoisted(async () =>
  (await import("../../../__test-utils__/plan-route-guards")).createPlanRouteMocks()
);

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getUserPermission: mocks.getUserPermission }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/curriculum-schema", () => ({ checkCurriculumPlansSchema: mocks.checkSchema }));

import { PUT } from "./route";
import { routeParams } from "../../../../../__test-utils__/api-test-helpers";
import {
  describePlanRouteGuard,
  req,
  defaultPlanRouteMocksBeforeEach,
} from "../../../__test-utils__/plan-route-guards";

const VALID_BODY = { academic_year: "2026-2027", assignments: [{ grade: 11, plan_id: 7 }] };

function save(body: unknown) {
  return PUT(
    req("/api/curriculum/plans/centres/41/assignments", { method: "PUT", body }),
    routeParams({ centreId: "41" })
  );
}

defaultPlanRouteMocksBeforeEach(mocks);

describePlanRouteGuard(mocks, "PUT /api/curriculum/plans/centres/41/assignments", "write", () =>
  save(VALID_BODY)
);

it("returns 400 for a malformed academic year or Grade list, without writing", async () => {
  mocks.checkSchema.mockResolvedValue({ ok: true });
  const cases: Array<[unknown, string]> = [
    [{ ...VALID_BODY, academic_year: "2026" }, "academic_year"],
    [{ academic_year: "2026-2027" }, "assignments"],
    [{ academic_year: "2026-2027", assignments: [] }, "assignments"],
    [{ academic_year: "2026-2027", assignments: [{ grade: 10, plan_id: 7 }] }, "assignments"],
    [{ academic_year: "2026-2027", assignments: [{ grade: 11, plan_id: "x" }] }, "assignments"],
    [
      {
        academic_year: "2026-2027",
        assignments: [
          { grade: 11, plan_id: 7 },
          { grade: 11, plan_id: null },
        ],
      },
      "assignments",
    ],
  ];
  for (const [body, field] of cases) {
    const res = await save(body);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors.map((error: { field: string }) => error.field)).toContain(field);
  }
  expect(mocks.withTransaction).not.toHaveBeenCalled();
});
