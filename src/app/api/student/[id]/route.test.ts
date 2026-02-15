import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import { PATCH } from "./route";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
  ADMIN_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

const params = routeParams({ id: "100" });

describe("PATCH /api/student/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "John" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(401);
  });

  it("updates only student fields when no group_id", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ updated: true }), { status: 200 }));

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "Jane", last_name: "Doe" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.student).toEqual({ updated: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("updates student + grade when group_id and user_id provided", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ updated: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ gradeUpdated: true }), { status: 200 }));

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "Jane", group_id: "g1", user_id: "u1" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.student).toBeDefined();
    expect(json.grade).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("updates student + grade + batch when all IDs provided", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ s: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ g: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ b: true }), { status: 200 }));

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "Jane", group_id: "g1", batch_group_id: "bg1", user_id: "u1" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.student).toBeDefined();
    expect(json.grade).toBeDefined();
    expect(json.batch).toBeDefined();
  });

  it("returns error when group_id provided without user_id", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { group_id: "g1" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("user_id is required");
  });

  it("returns error when batch_group_id provided without user_id", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { batch_group_id: "bg1" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("user_id is required");
  });

  it("returns partial results with warnings on mixed success/failure", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ s: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response("Grade error", { status: 500 })); // grade fails

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "Jane", group_id: "g1", user_id: "u1" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.student).toBeDefined();
    expect(json.warnings).toBeDefined();
    expect(json.warnings[0]).toContain("Failed to update grade");
  });

  it("returns 500 on fetch exception", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockRejectedValue(new Error("network error"));

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "Jane" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(500);
  });
});
