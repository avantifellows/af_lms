import { vi } from "vitest";

const mocks = await vi.hoisted(async () =>
  (await import("./__test-utils__/plan-route-guards")).createPlanRouteMocks()
);

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getUserPermission: mocks.getUserPermission }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/curriculum-schema", () => ({ checkCurriculumPlansSchema: mocks.checkSchema }));

import { GET, POST } from "./route";
import {
  describePlanRouteGuard,
  req,
  defaultPlanRouteMocksBeforeEach,
} from "./__test-utils__/plan-route-guards";

const PLAN_BODY = {
  title: "G11 2026-27",
  exam_tracks: ["jee_main"],
  academic_year: "2026-2027",
  grade: 11,
  closure_date: "2027-02-28",
};

defaultPlanRouteMocksBeforeEach(mocks);

describePlanRouteGuard(mocks, "GET /api/curriculum/plans", "read", () =>
  GET(req("/api/curriculum/plans"))
);
describePlanRouteGuard(mocks, "POST /api/curriculum/plans", "write", () =>
  POST(req("/api/curriculum/plans", { method: "POST", body: PLAN_BODY }))
);
