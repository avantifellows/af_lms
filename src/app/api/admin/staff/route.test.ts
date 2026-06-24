import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetServerSession, mockRequireStaffAdmin, mockGetStaffRoster } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockRequireStaffAdmin: vi.fn(),
    mockGetStaffRoster: vi.fn(),
  }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/staff-admin", () => ({
  requireStaffAdmin: mockRequireStaffAdmin,
  getStaffRoster: mockGetStaffRoster,
  safeStaffApiError: (result: { error: string }) => ({ error: result.error }),
}));

import { GET } from "./route";

function rosterRequest(url = "http://localhost/api/admin/staff") {
  return new NextRequest(new URL(url));
}

describe("GET /api/admin/staff", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireStaffAdmin.mockResolvedValue({
      ok: true,
      email: "admin@avantifellows.org",
    });
  });

  it("propagates guard failures", async () => {
    mockRequireStaffAdmin.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });
    expect((await GET(rosterRequest())).status).toBe(401);

    mockRequireStaffAdmin.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    expect((await GET(rosterRequest())).status).toBe(403);
  });

  it("passes query params through and returns the roster", async () => {
    mockGetStaffRoster.mockResolvedValueOnce({
      ok: true,
      filters: { search: "asha", kind: "teacher", code: "missing", exited: "exclude" },
      rows: [],
      summary: { total: 0 },
    });

    const response = await GET(
      rosterRequest("http://localhost/api/admin/staff?search=asha&kind=teacher&code=missing")
    );
    expect(response.status).toBe(200);
    expect(mockGetStaffRoster).toHaveBeenCalledWith({
      searchParams: { search: "asha", kind: "teacher", code: "missing" },
    });
    const data = await response.json();
    expect(data).toHaveProperty("rows");
    expect(data).toHaveProperty("summary");
    expect(data).toHaveProperty("filters");
  });

  it("returns 503 when the schema is unavailable", async () => {
    mockGetStaffRoster.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "Staff management schema unavailable",
      details: ["staff.id"],
    });
    const response = await GET(rosterRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Staff management schema unavailable",
    });
  });
});
