import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { GET, POST } from "./route";
import {
  jsonRequest,
  NO_SESSION,
  ADMIN_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockIsAdmin = vi.mocked(isAdmin);
const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/admin/users", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns users list", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const users = [{ id: 1, email: "u@test.com", level: 3, role: "admin" }];
    mockQuery.mockResolvedValue(users);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(users);
  });
});

describe("POST /api/admin/users", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1, program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(false);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1, program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 when email is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { level: 1, program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Email and level");
  });

  it("returns 400 when level is out of range", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 5, program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Level must be between");
  });

  it("returns 400 when program_ids is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1 },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("program");
  });

  it("creates user with valid role", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValue([{ id: 10 }]);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: {
        email: "u@test.com",
        level: 2,
        role: "program_admin",
        program_ids: [1, 2],
        school_codes: ["70705"],
      },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ id: 10, success: true });
  });

  it("defaults to teacher for unknown role", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValue([{ id: 11 }]);
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1, role: "unknown", program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    // Verify teacher was passed to query
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["teacher"]),
    );
  });

  it("returns 500 on query error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockRejectedValue(new Error("DB error"));
    const req = jsonRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: { email: "u@test.com", level: 1, role: "teacher", program_ids: [1] },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(500);
  });
});
