import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockRequireCentreAdmin,
  mockListCentreBatches,
  mockLinkBatchToCentre,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireCentreAdmin: vi.fn(),
  mockListCentreBatches: vi.fn(),
  mockLinkBatchToCentre: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/centres", () => ({
  requireCentreAdmin: mockRequireCentreAdmin,
  safeCentreApiError: (r: unknown) => r,
  listCentreBatches: mockListCentreBatches,
  linkBatchToCentre: mockLinkBatchToCentre,
}));

import { GET, POST } from "./route";
import { jsonRequest, routeParams } from "../../../../__test-utils__/api-test-helpers";

beforeEach(() => {
  vi.resetAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: "a@x.org" } });
  mockRequireCentreAdmin.mockResolvedValue({ ok: true });
  mockListCentreBatches.mockResolvedValue([]);
  mockLinkBatchToCentre.mockResolvedValue({ ok: true });
});

describe("GET /api/admin/centres/[id]/batches", () => {
  it("returns 403 for non-admins", async () => {
    mockRequireCentreAdmin.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });

    const res = await GET(
      new Request("http://localhost/api/admin/centres/7/batches") as never,
      routeParams({ id: "7" }) as never
    );

    expect(res.status).toBe(403);
    expect(mockListCentreBatches).not.toHaveBeenCalled();
  });

  it("returns the centre's linked batches", async () => {
    mockListCentreBatches.mockResolvedValue([
      { id: 1, batch_pk: 11, batch_id: "B_11", name: "Class 11" },
    ]);

    const res = await GET(
      new Request("http://localhost/api/admin/centres/7/batches") as never,
      routeParams({ id: "7" }) as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      batches: [{ id: 1, batch_pk: 11, batch_id: "B_11", name: "Class 11" }],
    });
    expect(mockListCentreBatches).toHaveBeenCalledWith(7);
  });

  it("400s on an invalid centre id", async () => {
    const res = await GET(
      new Request("http://localhost/api/admin/centres/abc/batches") as never,
      routeParams({ id: "abc" }) as never
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/centres/[id]/batches", () => {
  it("422s when batchId is missing", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/admin/centres/7/batches", {
        method: "POST",
        body: {},
      }) as never,
      routeParams({ id: "7" }) as never
    );
    expect(res.status).toBe(422);
    expect(mockLinkBatchToCentre).not.toHaveBeenCalled();
  });

  it("links the batch and returns the updated list", async () => {
    mockListCentreBatches.mockResolvedValue([
      { id: 1, batch_pk: 11, batch_id: "B_11", name: "Class 11" },
    ]);

    const res = await POST(
      jsonRequest("http://localhost/api/admin/centres/7/batches", {
        method: "POST",
        body: { batchId: "B_11" },
      }) as never,
      routeParams({ id: "7" }) as never
    );

    expect(res.status).toBe(200);
    expect(mockLinkBatchToCentre).toHaveBeenCalledWith({ centreId: 7, batchId: "B_11" });
    await expect(res.json()).resolves.toMatchObject({
      batches: [{ batch_id: "B_11" }],
    });
  });

  it("propagates a 422 from the lib (unknown batch)", async () => {
    mockLinkBatchToCentre.mockResolvedValue({ ok: false, status: 422, error: "Batch not found" });

    const res = await POST(
      jsonRequest("http://localhost/api/admin/centres/7/batches", {
        method: "POST",
        body: { batchId: "nope" },
      }) as never,
      routeParams({ id: "7" }) as never
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ ok: false, status: 422, error: "Batch not found" });
  });
});
