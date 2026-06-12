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

import { PATCH } from "./route";
import {
  ADMIN_SESSION,
  jsonRequest,
  PASSCODE_SESSION,
  PM_SESSION,
  routeParams,
} from "../../../../__test-utils__/api-test-helpers";
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

describe("PATCH /api/admin/centres/options/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockQuery.mockResolvedValue([]);
  });

  it("returns 401 and 403 before patching", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    expect(
      (
        await PATCH(
          jsonRequest("http://localhost/api/admin/centres/options/31", {
            method: "PATCH",
            body: {},
          }) as never,
          routeParams({ id: "31" })
        )
      ).status
    ).toBe(401);

    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect(
      (
        await PATCH(
          jsonRequest("http://localhost/api/admin/centres/options/31", {
            method: "PATCH",
            body: {},
          }) as never,
          routeParams({ id: "31" })
        )
      ).status
    ).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_admin",
    });
    expect(
      (
        await PATCH(
          jsonRequest("http://localhost/api/admin/centres/options/31", {
            method: "PATCH",
            body: {},
          }) as never,
          routeParams({ id: "31" })
        )
      ).status
    ).toBe(403);
  });

  it("rejects attempts to change code or option set", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/centres/options/31", {
        method: "PATCH",
        body: {
          code: "changed",
          option_set_code: "stream",
          label: "Changed",
          sort_order: 2,
          is_active: true,
        },
      }) as never,
      routeParams({ id: "31" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid Centre option edit payload",
      fields: {
        code: "Option code is read-only",
        option_set_code: "Option set is read-only",
      },
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("updates editable fields for admin users", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          option_id: "31",
          option_set_code: "category",
          option_code: "residential",
          option_label: "Residential Updated",
          option_sort_order: "9",
          option_is_active: false,
          option_inserted_at: null,
          option_updated_at: null,
        },
      ]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/centres/options/31", {
        method: "PATCH",
        body: {
          label: "Residential Updated",
          sort_order: 9,
          is_active: false,
        },
      }) as never,
      routeParams({ id: "31" })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      option: {
        id: 31,
        optionSetCode: "category",
        code: "residential",
        label: "Residential Updated",
        sortOrder: 9,
        isActive: false,
        insertedAt: "",
        updatedAt: "",
      },
    });
  });

  it("returns controlled schema errors without raw schema details", async () => {
    mockQuery.mockResolvedValueOnce([
      { table_name: "centre_options", column_name: "option_set_id" },
    ]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/centres/options/31", {
        method: "PATCH",
        body: {
          label: "Residential Updated",
          sort_order: 9,
          is_active: false,
        },
      }) as never,
      routeParams({ id: "31" })
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      status: 503,
      error: "Centre management schema unavailable",
    });
  });

  it("returns 404 when the option id does not exist", async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/centres/options/999", {
        method: "PATCH",
        body: {
          label: "Missing",
          sort_order: 1,
          is_active: true,
        },
      }) as never,
      routeParams({ id: "999" })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      status: 404,
      error: "Centre option not found",
    });
  });

  it("returns 404 for malformed option ids before querying Centre tables", async () => {
    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/centres/options/not-a-number", {
        method: "PATCH",
        body: {
          label: "Bad Id",
          sort_order: 1,
          is_active: true,
        },
      }) as never,
      routeParams({ id: "not-a-number" })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      status: 404,
      error: "Centre option not found",
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
