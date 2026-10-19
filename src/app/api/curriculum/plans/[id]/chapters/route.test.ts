import { vi } from "vitest";

const mocks = await vi.hoisted(async () =>
  (await import("../../__test-utils__/plan-route-guards")).createPlanRouteMocks()
);

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getUserPermission: mocks.getUserPermission }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/curriculum-schema", () => ({ checkCurriculumPlansSchema: mocks.checkSchema }));

import { PUT } from "./route";
import { routeParams } from "../../../../__test-utils__/api-test-helpers";
import {
  describePlanRouteGuard,
  req,
  defaultPlanRouteMocksBeforeEach,
} from "../../__test-utils__/plan-route-guards";

defaultPlanRouteMocksBeforeEach(mocks);

describePlanRouteGuard(mocks, "PUT /api/curriculum/plans/7/chapters", "write", () =>
  PUT(
    req("/api/curriculum/plans/7/chapters", {
      method: "PUT",
      body: { chapters: [{ chapter_id: 90007501, due_date: "2026-06-30", test_date: null }] },
    }),
    routeParams({ id: "7" })
  )
);
