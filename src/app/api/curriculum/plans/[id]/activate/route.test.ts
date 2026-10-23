import { vi } from "vitest";

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

defaultPlanRouteMocksBeforeEach(mocks);

describePlanRouteGuard(mocks, "POST /api/curriculum/plans/7/activate", "write", () =>
  POST(req("/api/curriculum/plans/7/activate", { method: "POST" }), routeParams({ id: "7" }))
);
