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
} from "../../__test-utils__/api-test-helpers";
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

describe("GET /api/admin/centres", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockQuery.mockResolvedValue([]);
  });

  it("returns 401 for unauthenticated users and 403 for passcode/non-admin users", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    expect((await GET(jsonRequest("http://localhost/api/admin/centres") as never)).status).toBe(401);

    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect((await GET(jsonRequest("http://localhost/api/admin/centres") as never)).status).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_manager",
    });
    expect((await GET(jsonRequest("http://localhost/api/admin/centres") as never)).status).toBe(403);
  });

  it("returns paginated Centre rows for admin users", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "91",
          name: "JNV Pune CoE",
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
          updated_at: "2026-01-06T00:00:00.000Z",
          school_name: null,
          school_code: null,
          school_udise_code: null,
          school_region: null,
          school_state: null,
          school_district: null,
          total_count: "1",
        },
      ]);

    const res = await GET(
      jsonRequest("http://localhost/api/admin/centres?search=pune&active=true") as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      filters: {
        search: "pune",
        active: "true",
      },
      pagination: {
        page: 1,
        limit: 25,
        totalRows: 1,
      },
      rows: [
        {
          id: 91,
          name: "JNV Pune CoE",
          updatedAt: "2026-01-06T00:00:00.000Z",
        },
      ],
    });
  });

  it("returns controlled 503 when Centre tables are unavailable", async () => {
    mockQuery.mockResolvedValueOnce([
      { table_name: "centres", column_name: "stream_codes" },
    ]);

    const res = await GET(jsonRequest("http://localhost/api/admin/centres") as never);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      status: 503,
      error: "Centre management schema unavailable",
      details: ["centres.stream_codes"],
    });
  });
});

describe("POST /api/admin/centres", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockQuery.mockResolvedValue([]);
  });

  it("returns 422 validation errors from the Centre service", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await POST(
      jsonRequest("http://localhost/api/admin/centres", {
        method: "POST",
        body: {
          name: "",
          stream_codes: "jee",
          is_physical: "no",
          is_active: true,
        },
      }) as never
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid Centre payload",
      fields: {
        name: "Centre name is required",
        stream_codes: "Centre Stream codes must be an array of strings",
        is_physical: "Physical status is required",
      },
    });
  });
});
