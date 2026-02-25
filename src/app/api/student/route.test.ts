import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import { POST } from "./route";
import { jsonRequest, NO_SESSION, ADMIN_SESSION } from "../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("POST /api/student", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/student", {
      method: "POST",
      body: { apaar_id: "AP123" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when neither apaar_id nor student_id is provided", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const req = jsonRequest("http://localhost/api/student", {
      method: "POST",
      body: { first_name: "John" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("apaar_id or student_id");
  });

  it("proxies request to DB service successfully", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const result = { id: 1, apaar_id: "AP123" };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));

    const req = jsonRequest("http://localhost/api/student", {
      method: "POST",
      body: { apaar_id: "AP123", first_name: "John" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(result);
  });

  it("forwards error status from DB service", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(new Response("Bad request", { status: 400 }));

    const req = jsonRequest("http://localhost/api/student", {
      method: "POST",
      body: { apaar_id: "AP123" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 500 on fetch error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockRejectedValue(new Error("network error"));

    const req = jsonRequest("http://localhost/api/student", {
      method: "POST",
      body: { apaar_id: "AP123" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(500);
  });
});
