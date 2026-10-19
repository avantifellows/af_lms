import { expect, it, vi } from "vitest";

const mocks = await vi.hoisted(async () =>
  (await import("../../__test-utils__/plan-route-guards")).createPlanRouteMocks()
);

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getUserPermission: mocks.getUserPermission }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/curriculum-schema", () => ({ checkCurriculumPlansSchema: mocks.checkSchema }));

import { POST } from "./route";
import { routeParams } from "../../../../__test-utils__/api-test-helpers";
import {
  describePlanRouteGuard,
  req,
  defaultPlanRouteMocksBeforeEach,
} from "../../__test-utils__/plan-route-guards";

function copy(body: unknown) {
  return POST(req("/api/curriculum/plans/7/copy", { method: "POST", body }), routeParams({ id: "7" }));
}

defaultPlanRouteMocksBeforeEach(mocks);

describePlanRouteGuard(mocks, "POST /api/curriculum/plans/7/copy", "write", () =>
  copy({ mode: "next_year" })
);

it("returns 400 for an unknown copy mode without writing", async () => {
  mocks.checkSchema.mockResolvedValue({ ok: true });
  const res = await copy({ mode: "last_year" });
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.errors).toEqual([{ field: "mode", message: "Copy mode must be same_year or next_year" }]);
  expect(mocks.withTransaction).not.toHaveBeenCalled();
});
