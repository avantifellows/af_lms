import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import {
  ADMIN_SESSION,
  NO_SESSION,
  PASSCODE_SESSION,
} from "../../__test-utils__/api-test-helpers";
import { PROGRAM_IDS, type UserPermission } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockCanAccessSchool: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.mockGetServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    getUserPermission: mocks.mockGetUserPermission,
    getFeatureAccess: mocks.mockGetFeatureAccess,
    canAccessSchool: mocks.mockCanAccessSchool,
  };
});
vi.mock("@/lib/db", () => ({
  query: mocks.mockQuery,
}));

function makePermission(overrides: Partial<UserPermission> = {}): UserPermission {
  return {
    id: 10,
    email: "admin@avantifellows.org",
    full_name: "Admin User",
    level: 3,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: [PROGRAM_IDS.COE],
    read_only: false,
    ...overrides,
  };
}

function request(url = "http://localhost/api/academic-mentorship/eligible-mentors?school_code=SCH001") {
  return new NextRequest(url);
}

beforeEach(() => {
  mocks.mockGetServerSession.mockReset();
  mocks.mockGetUserPermission.mockReset();
  mocks.mockGetFeatureAccess.mockReset();
  mocks.mockCanAccessSchool.mockReset();
  mocks.mockQuery.mockReset();
  mocks.mockCanAccessSchool.mockResolvedValue(true);
  mocks.mockGetFeatureAccess.mockReturnValue({
    access: "edit",
    canView: true,
    canEdit: true,
  });
});

describe("GET /api/academic-mentorship/eligible-mentors", () => {
  it("returns 401 when unauthenticated", async () => {
    const { GET } = await import("./route");
    mocks.mockGetServerSession.mockResolvedValue(NO_SESSION);

    const res = await GET(request());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when the user cannot edit academic mentorship", async () => {
    const { GET } = await import("./route");
    mocks.mockGetServerSession.mockResolvedValue(PASSCODE_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await GET(request());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns 403 when school_code is outside the actor scope", async () => {
    const { GET } = await import("./route");
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockCanAccessSchool.mockResolvedValue(false);

    const res = await GET(request());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns level-1 single-school teachers at the selected school", async () => {
    const { GET } = await import("./route");
    mocks.mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mocks.mockGetUserPermission.mockResolvedValue(makePermission());
    mocks.mockQuery.mockResolvedValue([
      { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
      { id: 22, email: "busy@avantifellows.org", full_name: "Existing Mentor" },
    ]);

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(mocks.mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("cardinality(school_codes) = 1"),
      ["SCH001"]
    );
    expect(mocks.mockQuery.mock.calls[0]?.[0]).toContain("level = 1");
    expect(mocks.mockQuery.mock.calls[0]?.[0]).toContain("role = 'teacher'");
    expect(mocks.mockQuery.mock.calls[0]?.[0]).toContain("school_codes @> ARRAY[$1]");
    await expect(res.json()).resolves.toEqual({
      mentors: [
        { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
        { id: 22, email: "busy@avantifellows.org", full_name: "Existing Mentor" },
      ],
    });
  });
});
