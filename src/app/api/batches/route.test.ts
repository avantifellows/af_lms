import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ isAdmin: vi.fn() }));

import { getServerSession } from "next-auth";
import { isAdmin } from "@/lib/permissions";
import { GET } from "./route";
import { NO_SESSION, ADMIN_SESSION } from "../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockIsAdmin = vi.mocked(isAdmin);
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("GET /api/batches", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = new Request("http://localhost/api/batches?program_id=1");
    const res = await GET(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(false);
    const req = new Request("http://localhost/api/batches?program_id=1");
    const res = await GET(req as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 when program_id is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const req = new Request("http://localhost/api/batches");
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  it("returns batches from DB service", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const batches = [{ id: 1, name: "Batch A" }];
    mockFetch.mockResolvedValue(new Response(JSON.stringify(batches), { status: 200 }));

    const req = new Request("http://localhost/api/batches?program_id=1");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(batches);
  });

  it("forwards error status from DB service", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockFetch.mockResolvedValue(new Response("Not found", { status: 404 }));

    const req = new Request("http://localhost/api/batches?program_id=999");
    const res = await GET(req as never);
    expect(res.status).toBe(404);
  });

  it("returns 500 on fetch error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockFetch.mockRejectedValue(new Error("network error"));

    const req = new Request("http://localhost/api/batches?program_id=1");
    const res = await GET(req as never);
    expect(res.status).toBe(500);
  });
});
