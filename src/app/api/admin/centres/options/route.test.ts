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

import { GET, POST } from "./route";
import {
  ADMIN_SESSION,
  jsonRequest,
  PASSCODE_SESSION,
  PM_SESSION,
} from "../../../__test-utils__/api-test-helpers";
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

describe("GET /api/admin/centres/options", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockQuery.mockResolvedValue([]);
  });

  it("returns 401 for unauthenticated users", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for passcode and non-admin Google users", async () => {
    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect((await GET()).status).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_manager",
    });
    expect((await GET()).status).toBe(403);
  });

  it("returns controlled 503 when Centre tables are unavailable", async () => {
    mockQuery.mockResolvedValueOnce([
      { table_name: "centre_options", column_name: "option_set_id" },
    ]);

    const res = await GET();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      status: 503,
      error: "Centre management schema unavailable",
      details: ["centre_options.option_set_id"],
    });
  });

  it("returns fixed option sets for admin users", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          option_set_id: "4",
          option_set_code: "stream",
          option_set_label: "Centre Stream",
          allow_multi: true,
          option_set_sort_order: "4",
          option_id: "41",
          option_code: "jee",
          option_label: "JEE",
          option_sort_order: "1",
          option_is_active: true,
          option_inserted_at: null,
          option_updated_at: null,
        },
      ]);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      optionSets: [
        {
          id: 4,
          code: "stream",
          label: "Centre Stream",
          allowMulti: true,
          sortOrder: 4,
          options: [
            {
              id: 41,
              optionSetCode: "stream",
              code: "jee",
              label: "JEE",
              sortOrder: 1,
              isActive: true,
              insertedAt: "",
              updatedAt: "",
            },
          ],
        },
      ],
    });
  });
});

describe("POST /api/admin/centres/options", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockQuery.mockResolvedValue([]);
  });

  it("returns 422 for invalid create payloads without mutating", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await POST(
      jsonRequest("http://localhost/api/admin/centres/options", {
        method: "POST",
        body: {
          option_set_code: "custom",
          code: "",
          label: "",
          sort_order: -1,
          is_active: "yes",
        },
      }) as never
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid Centre option create payload",
      fields: {
        option_set_code: "Invalid Centre option set",
        code: "Option code is required",
        label: "Option label is required",
        sort_order: "Sort order must be zero or greater",
        is_active: "Active state is required",
      },
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("creates Centre options for admin users", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          option_id: "31",
          option_set_code: "category",
          option_code: "residential",
          option_label: "Residential",
          option_sort_order: "7",
          option_is_active: true,
          option_inserted_at: null,
          option_updated_at: null,
        },
      ]);

    const res = await POST(
      jsonRequest("http://localhost/api/admin/centres/options", {
        method: "POST",
        body: {
          option_set_code: "category",
          code: "residential",
          label: "Residential",
          sort_order: 7,
          is_active: true,
        },
      }) as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      option: {
        id: 31,
        optionSetCode: "category",
        code: "residential",
        label: "Residential",
        sortOrder: 7,
        isActive: true,
        insertedAt: "",
        updatedAt: "",
      },
    });
  });

  it("returns 409 for duplicate option codes", async () => {
    const duplicateError = new Error("duplicate key value violates unique constraint");
    Object.assign(duplicateError, { code: "23505" });
    mockQuery.mockResolvedValueOnce([]).mockRejectedValueOnce(duplicateError);

    const res = await POST(
      jsonRequest("http://localhost/api/admin/centres/options", {
        method: "POST",
        body: {
          option_set_code: "type",
          code: "coe",
          label: "CoE",
          sort_order: 1,
          is_active: true,
        },
      }) as never
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Centre option code already exists in this option set",
    });
  });
});
