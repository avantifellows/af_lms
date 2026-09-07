import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  canAccessSchool: vi.fn(),
  getResolvedPermission: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { canAccessSchool, getResolvedPermission } from "@/lib/permissions";
import type { UserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import { authorizeSchoolAccess } from "./api-auth";
import {
  ADMIN_SESSION,
  NO_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
} from "@/app/api/__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockCanAccessSchool = vi.mocked(canAccessSchool);
const mockResolvedPermission = vi.mocked(getResolvedPermission);

function permission(overrides: Partial<UserPermission> = {}): UserPermission {
  return {
    email: "admin@avantifellows.org",
    level: 3,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: null,
    read_only: false,
    ...overrides,
  } as UserPermission;
}

const SCHOOL_ROW = {
  id: "101",
  code: "70705",
  name: "JNV Bhavnagar",
  region: "West",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("authorizeSchoolAccess", () => {
  it("returns 401 when no session", async () => {
    mockSession.mockResolvedValue(NO_SESSION);

    const result = await authorizeSchoolAccess("1234567890");
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(401);
      await expect(result.response.json()).resolves.toEqual({
        error: "Unauthorized",
      });
    }
  });

  it("returns 404 when school not found", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([]);

    const result = await authorizeSchoolAccess("9999999999");
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(404);
      await expect(result.response.json()).resolves.toEqual({
        error: "School not found",
      });
    }
  });

  it("queries by udise_code OR code", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([SCHOOL_ROW]);
    mockCanAccessSchool.mockResolvedValue(true);

    await authorizeSchoolAccess("70705");

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("udise_code = $1 OR code = $1");
    expect(params).toEqual(["70705"]);
  });

  // --- Passcode user tests ---

  it("authorizes passcode user with matching schoolCode", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);
    mockQuery.mockResolvedValue([SCHOOL_ROW]);

    const result = await authorizeSchoolAccess("70705");
    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.school).toEqual(SCHOOL_ROW);
    }
    // canAccessSchool should NOT be called for passcode users
    expect(mockCanAccessSchool).not.toHaveBeenCalled();
  });

  it("returns 403 for passcode user with wrong schoolCode", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);
    mockQuery.mockResolvedValue([{ ...SCHOOL_ROW, code: "99999" }]);

    const result = await authorizeSchoolAccess("1234567890");
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toEqual({
        error: "Access denied",
      });
    }
  });

  // --- Email user tests ---

  it("authorizes email user with access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([SCHOOL_ROW]);
    mockCanAccessSchool.mockResolvedValue(true);

    const result = await authorizeSchoolAccess("70705");
    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.school).toEqual(SCHOOL_ROW);
    }
    expect(mockCanAccessSchool).toHaveBeenCalledWith(
      "admin@avantifellows.org",
      "70705",
      "West"
    );
  });

  it("returns 403 for email user without access", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockQuery.mockResolvedValue([SCHOOL_ROW]);
    mockCanAccessSchool.mockResolvedValue(false);

    const result = await authorizeSchoolAccess("70705");
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toEqual({
        error: "Access denied",
      });
    }
    expect(mockCanAccessSchool).toHaveBeenCalledWith(
      "pm@avantifellows.org",
      "70705",
      "West"
    );
  });

  it("returns 403 for email user with null email", async () => {
    mockSession.mockResolvedValue({
      user: { email: null, name: "No Email" },
      expires: "2099-01-01",
    });
    mockQuery.mockResolvedValue([SCHOOL_ROW]);
    mockCanAccessSchool.mockResolvedValue(false);

    const result = await authorizeSchoolAccess("70705");
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(403);
    }
    expect(mockCanAccessSchool).toHaveBeenCalledWith(null, "70705", "West");
  });

  it("returns full school info (id, code, name, region) on success", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const schoolWithNullRegion = {
      id: "202",
      code: "80808",
      name: "Test School",
      region: null,
    };
    mockQuery.mockResolvedValue([schoolWithNullRegion]);
    mockCanAccessSchool.mockResolvedValue(true);

    const result = await authorizeSchoolAccess("80808");
    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.school).toEqual({
        id: "202",
        code: "80808",
        name: "Test School",
        region: null,
      });
    }
    // null region → passed as undefined to canAccessSchool
    expect(mockCanAccessSchool).toHaveBeenCalledWith(
      "admin@avantifellows.org",
      "80808",
      undefined
    );
  });

  // --- read_only ---
  // School access says who may *see* a school; read_only says whether they may
  // change anything there. A read-only admin passes canAccessSchool, so routes
  // that trigger work must opt in with requireEdit.

  it("reports readOnly on success so views can mirror the write verdict", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([SCHOOL_ROW]);
    mockCanAccessSchool.mockResolvedValue(true);
    mockResolvedPermission.mockResolvedValue(permission({ read_only: true }));

    const result = await authorizeSchoolAccess("70705");
    expect(result.authorized).toBe(true);
    if (result.authorized) expect(result.readOnly).toBe(true);
  });

  it("reports readOnly=false for a full-access user", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([SCHOOL_ROW]);
    mockCanAccessSchool.mockResolvedValue(true);
    mockResolvedPermission.mockResolvedValue(permission());

    const result = await authorizeSchoolAccess("70705", { requireEdit: true });
    expect(result.authorized).toBe(true);
    if (result.authorized) expect(result.readOnly).toBe(false);
  });

  it("403s a read-only user when requireEdit is set", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([SCHOOL_ROW]);
    mockCanAccessSchool.mockResolvedValue(true);
    mockResolvedPermission.mockResolvedValue(permission({ read_only: true }));

    const result = await authorizeSchoolAccess("70705", { requireEdit: true });
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toEqual({
        error: "Read-only access cannot perform this action",
      });
    }
  });

  it("still lets a read-only user through without requireEdit (reads)", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockQuery.mockResolvedValue([SCHOOL_ROW]);
    mockCanAccessSchool.mockResolvedValue(true);
    mockResolvedPermission.mockResolvedValue(
      permission({ email: "pm@avantifellows.org", role: "program_manager", read_only: true })
    );

    const result = await authorizeSchoolAccess("70705");
    expect(result.authorized).toBe(true);
  });

  it("requireEdit does not affect passcode users (they cannot be read-only)", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION as never);
    mockQuery.mockResolvedValue([SCHOOL_ROW]);

    const result = await authorizeSchoolAccess("70705", { requireEdit: true });
    expect(result.authorized).toBe(true);
    if (result.authorized) expect(result.readOnly).toBe(false);
    expect(mockResolvedPermission).not.toHaveBeenCalled();
  });
});
