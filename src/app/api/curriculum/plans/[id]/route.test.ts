import { vi } from "vitest";

const mocks = await vi.hoisted(async () =>
  (await import("../__test-utils__/plan-route-guards")).createPlanRouteMocks()
);

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getUserPermission: mocks.getUserPermission }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/curriculum-schema", () => ({ checkCurriculumPlansSchema: mocks.checkSchema }));

import { DELETE, GET, PATCH } from "./route";
import { routeParams } from "../../../__test-utils__/api-test-helpers";
import {
  describePlanRouteGuard,
  req,
  defaultPlanRouteMocksBeforeEach,
} from "../__test-utils__/plan-route-guards";

const PLAN_BODY = {
  title: "G11 2026-27",
  exam_tracks: ["jee_main"],
  academic_year: "2026-2027",
  grade: 11,
  closure_date: "2027-02-28",
};

defaultPlanRouteMocksBeforeEach(mocks);

describePlanRouteGuard(mocks, "GET /api/curriculum/plans/7", "read", () =>
  GET(req("/api/curriculum/plans/7"), routeParams({ id: "7" }))
);
describePlanRouteGuard(mocks, "PATCH /api/curriculum/plans/7", "write", () =>
  PATCH(req("/api/curriculum/plans/7", { method: "PATCH", body: PLAN_BODY }), routeParams({ id: "7" }))
);
describePlanRouteGuard(mocks, "DELETE /api/curriculum/plans/7", "write", () =>
  DELETE(req("/api/curriculum/plans/7", { method: "DELETE" }), routeParams({ id: "7" }))
);
