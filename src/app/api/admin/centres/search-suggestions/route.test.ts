import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockGetUserPermission, mockQuery } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mockGetUserPermission,
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { GET } from "./route";
import { ADMIN_SESSION, jsonRequest } from "../../../__test-utils__/api-test-helpers";
import { resetCentreSchemaCheckForTests } from "@/lib/centres";

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
};

describe("GET /api/admin/centres/search-suggestions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
  });

  it("returns compact Centre search suggestions for admin users", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          kind: "centre_name",
          value: "JNV Barwani",
          label: "JNV Barwani",
          detail: "Centre name",
        },
      ]);

    const res = await GET(
      jsonRequest("http://localhost/api/admin/centres/search-suggestions?q=bar") as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      suggestions: [
        {
          kind: "centre_name",
          value: "JNV Barwani",
          label: "JNV Barwani",
          detail: "Centre name",
        },
      ],
    });
  });
});
