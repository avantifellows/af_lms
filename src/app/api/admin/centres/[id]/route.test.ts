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
  routeParams,
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

describe("PATCH /api/admin/centres/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockQuery.mockResolvedValue([]);
  });

  it("returns 404 when the Centre id does not exist", async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/centres/999", {
        method: "PATCH",
        body: { is_active: false },
      }) as never,
      routeParams({ id: "999" })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      status: 404,
      error: "Centre not found",
    });
  });

  it("patches editable Centre fields for admin users", async () => {
    const centreRow = {
      id: "93",
      name: "Legacy Centre",
      school_id: null,
      type_code: null,
      type_label: null,
      type_is_active: null,
      category_code: null,
      category_label: null,
      category_is_active: null,
      sub_category_code: null,
      sub_category_label: null,
      sub_category_is_active: null,
      stream_codes: [],
      stream_options: [],
      is_physical: false,
      is_active: true,
      inserted_at: null,
      updated_at: null,
      school_name: null,
      school_code: null,
      school_udise_code: null,
      school_region: null,
      school_state: null,
      school_district: null,
      total_count: "1",
    };
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([centreRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...centreRow, is_active: false }]);

    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/centres/93", {
        method: "PATCH",
        body: { is_active: false },
      }) as never,
      routeParams({ id: "93" })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      centre: {
        id: 93,
        name: "Legacy Centre",
        isActive: false,
      },
    });
  });
});
