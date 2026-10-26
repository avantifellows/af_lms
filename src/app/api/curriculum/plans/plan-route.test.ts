import { NextRequest, NextResponse } from "next/server";
import { expect, it, vi } from "vitest";

const mocks = await vi.hoisted(async () =>
  (await import("./__test-utils__/plan-route-guards")).createPlanRouteMocks()
);

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getUserPermission: mocks.getUserPermission }));

import { handlePlanRoute } from "./plan-route";
import { READ_ONLY_ADMIN, req, defaultPlanRouteMocksBeforeEach } from "./__test-utils__/plan-route-guards";

defaultPlanRouteMocksBeforeEach(mocks);

it("passes the Admin's email and JSON body to the action and answers through respond", async () => {
  const action = vi.fn(async () => ({ ok: true as const, value: 7 }));

  const res = await handlePlanRoute(
    { forWrite: true, request: req("/api/x", { method: "POST", body: { mode: "same_year" } }) },
    action,
    (result) => NextResponse.json({ value: result.value }, { status: 201 })
  );

  expect(action).toHaveBeenCalledWith({ email: "admin@avantifellows.org", body: { mode: "same_year" } });
  expect(res.status).toBe(201);
  await expect(res.json()).resolves.toEqual({ value: 7 });
});

it("reads invalid JSON as a null body", async () => {
  const action = vi.fn().mockResolvedValue({ ok: true });
  const request = new NextRequest(new URL("/api/x", "http://localhost"), { method: "POST", body: "{" });

  await handlePlanRoute({ request }, action, () => NextResponse.json({}));

  expect(action).toHaveBeenCalledWith({ email: "admin@avantifellows.org", body: null });
});

it("answers a failed result with its own status and body", async () => {
  const failure = { ok: false as const, status: 409, error: "Only Draft plans can be deleted" };

  const res = await handlePlanRoute({ forWrite: true }, async () => failure, () => NextResponse.json({}));

  expect(res.status).toBe(409);
  await expect(res.json()).resolves.toEqual(failure);
});

it("lets a read-only Admin through a read but not a write", async () => {
  mocks.getUserPermission.mockResolvedValue(READ_ONLY_ADMIN);
  const action = vi.fn().mockResolvedValue({ ok: true });

  const read = await handlePlanRoute({}, action, () => NextResponse.json({ read: true }));
  const write = await handlePlanRoute({ forWrite: true }, action, () => NextResponse.json({}));

  expect(read.status).toBe(200);
  expect(write.status).toBe(403);
  expect(action).toHaveBeenCalledTimes(1);
});
