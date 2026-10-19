import { expect, it, vi } from "vitest";

const mocks = await vi.hoisted(async () =>
  (await import("../../__test-utils__/plan-route-guards")).createPlanRouteMocks()
);

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getUserPermission: mocks.getUserPermission }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/curriculum-schema", () => ({ checkCurriculumPlansSchema: mocks.checkSchema }));

import { GET, PUT } from "./route";
import { routeParams } from "../../../../__test-utils__/api-test-helpers";
import {
  describePlanRouteGuard,
  req,
  defaultPlanRouteMocksBeforeEach,
} from "../../__test-utils__/plan-route-guards";

const URL_PATH = "/api/curriculum/plans/7/assignments";

function save(body: unknown) {
  return PUT(req(URL_PATH, { method: "PUT", body }), routeParams({ id: "7" }));
}

defaultPlanRouteMocksBeforeEach(mocks);

describePlanRouteGuard(mocks, "GET /api/curriculum/plans/7/assignments", "read", () =>
  GET(req(URL_PATH), routeParams({ id: "7" }))
);
describePlanRouteGuard(mocks, "PUT /api/curriculum/plans/7/assignments", "write", () =>
  save({ centre_ids: [1] })
);

it("returns 400 when centre_ids is not a list of Centre ids, without writing", async () => {
  mocks.checkSchema.mockResolvedValue({ ok: true });
  for (const body of [{}, { centre_ids: "1,2" }, { centre_ids: [1, "x"] }]) {
    const res = await save(body);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      errors: [{ field: "centre_ids", message: "centre_ids must be a list of Centre ids" }],
    });
  }
  expect(mocks.withTransaction).not.toHaveBeenCalled();
});
