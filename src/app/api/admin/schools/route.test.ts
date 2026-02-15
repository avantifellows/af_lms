import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { GET } from "./route";
import { NO_SESSION, ADMIN_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockIsAdmin = vi.mocked(isAdmin);
const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/admin/schools", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = new Request("http://localhost/api/admin/schools");
    const res = await GET(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(false);
    const req = new Request("http://localhost/api/admin/schools");
    const res = await GET(req as never);
    expect(res.status).toBe(403);
  });

  it("returns all schools when all=true", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const schools = [{ id: 1, code: "70705", name: "JNV Test", region: "R1", program_ids: [1] }];
    mockQuery.mockResolvedValue(schools);

    const req = new Request("http://localhost/api/admin/schools?all=true");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(schools);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id, code, name, region, program_ids"),
    );
  });

  it("searches schools by name or code when q is provided", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    const schools = [{ code: "70705", name: "JNV Test", region: "R1" }];
    mockQuery.mockResolvedValue(schools);

    const req = new Request("http://localhost/api/admin/schools?q=test");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(schools);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("ILIKE"),
      ["%test%"],
    );
  });

  it("defaults to empty search when no q param", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValue([]);

    const req = new Request("http://localhost/api/admin/schools");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("ILIKE"),
      ["%%"],
    );
  });
});
