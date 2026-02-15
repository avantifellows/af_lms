import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ isAdmin: vi.fn() }));

import { getServerSession } from "next-auth";
import { isAdmin } from "@/lib/permissions";
import { PATCH } from "./route";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
  ADMIN_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockIsAdmin = vi.mocked(isAdmin);
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

const params = routeParams({ id: "42" });

describe("PATCH /api/batches/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/batches/42", {
      method: "PATCH",
      body: { metadata: { stream: "engineering" } },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(false);
    const req = jsonRequest("http://localhost/api/batches/42", {
      method: "PATCH",
      body: { metadata: { stream: "engineering" } },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(403);
  });

  it("returns 400 when metadata is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const req = jsonRequest("http://localhost/api/batches/42", {
      method: "PATCH",
      body: {},
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid stream", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const req = jsonRequest("http://localhost/api/batches/42", {
      method: "PATCH",
      body: { metadata: { stream: "invalid" } },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid stream");
  });

  it("returns 400 for invalid grade", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const req = jsonRequest("http://localhost/api/batches/42", {
      method: "PATCH",
      body: { metadata: { grade: 7 } },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid grade");
  });

  it("updates batch successfully", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const result = { id: 42, metadata: { stream: "engineering", grade: 11 } };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));

    const req = jsonRequest("http://localhost/api/batches/42", {
      method: "PATCH",
      body: { metadata: { stream: "engineering", grade: 11 } },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(result);
  });

  it("forwards error status from DB service", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockFetch.mockResolvedValue(new Response("Error", { status: 422 }));

    const req = jsonRequest("http://localhost/api/batches/42", {
      method: "PATCH",
      body: { metadata: { stream: "engineering" } },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(422);
  });

  it("returns 500 on fetch error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockFetch.mockRejectedValue(new Error("network error"));

    const req = jsonRequest("http://localhost/api/batches/42", {
      method: "PATCH",
      body: { metadata: { stream: "engineering" } },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(500);
  });
});
