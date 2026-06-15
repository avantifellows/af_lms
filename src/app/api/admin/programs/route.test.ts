import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockGetUserPermission, mockQuery } = vi.hoisted(
  () => ({
    mockGetServerSession: vi.fn(),
    mockGetUserPermission: vi.fn(),
    mockQuery: vi.fn(),
  })
);

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mockGetUserPermission,
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { GET } from "./route";
import { ADMIN_SESSION } from "../../__test-utils__/api-test-helpers";

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
};

function request(url: string) {
  return new Request(url) as never;
}

describe("GET /api/admin/programs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockQuery.mockResolvedValue([]);
  });

  it("returns programs for admin users", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: "1", name: "JNV CoE" },
      { id: "2", name: "JNV Nodal" },
    ]);

    const res = await GET(request("http://localhost/api/admin/programs"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      programs: [
        { id: 1, name: "JNV CoE" },
        { id: 2, name: "JNV Nodal" },
      ],
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM program ORDER BY name")
    );
  });

  it("passes an optional search filter through to an ILIKE query", async () => {
    mockQuery.mockResolvedValueOnce([{ id: "74", name: "Punjab CoE" }]);

    const res = await GET(
      request("http://localhost/api/admin/programs?q=punjab")
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      programs: [{ id: 74, name: "Punjab CoE" }],
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE name ILIKE $1"),
      ["%punjab%"]
    );
  });

  it("rejects non-admin users", async () => {
    mockGetUserPermission.mockResolvedValue({
      ...adminPermission,
      role: "program_manager",
    });

    const res = await GET(request("http://localhost/api/admin/programs"));

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
