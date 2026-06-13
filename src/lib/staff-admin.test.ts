import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockWithTransaction, mockClientQuery, mockGetUserPermission } =
  vi.hoisted(() => {
    const mockClientQuery = vi.fn();
    return {
      mockQuery: vi.fn(),
      mockClientQuery,
      mockWithTransaction: vi.fn(
        async (fn: (client: { query: typeof mockClientQuery }) => Promise<unknown>) =>
          fn({ query: mockClientQuery })
      ),
      mockGetUserPermission: vi.fn(),
    };
  });

vi.mock("./db", () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}));
vi.mock("./permissions", () => ({
  getUserPermission: mockGetUserPermission,
}));

import {
  STAFF_REQUIRED_COLUMNS,
  createPosition,
  createStaffMember,
  deletePosition,
  getStaffRoster,
  isSeatRole,
  normalizeEmployeeCode,
  normalizeStaffRosterParams,
  requireStaffAdmin,
  resetStaffSchemaCheckForTests,
  updatePosition,
  updateStaffMember,
  updateTeacherRecord,
  validateTeacherUpdateBody,
} from "./staff-admin";

const SCHEMA_ROWS = STAFF_REQUIRED_COLUMNS.map((c) => ({
  table_name: c.table,
  column_name: c.column,
}));

function mockSchemaReady() {
  mockQuery.mockResolvedValueOnce(SCHEMA_ROWS);
}

beforeEach(() => {
  vi.resetAllMocks();
  resetStaffSchemaCheckForTests();
  mockWithTransaction.mockImplementation(
    async (fn: (client: { query: typeof mockClientQuery }) => Promise<unknown>) =>
      fn({ query: mockClientQuery })
  );
  mockClientQuery.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requireStaffAdmin", () => {
  it("rejects missing sessions, passcode users, and non-admins", async () => {
    expect(await requireStaffAdmin(null)).toMatchObject({ ok: false, status: 401 });
    expect(
      await requireStaffAdmin({
        user: { email: "x@avantifellows.org" },
        isPasscodeUser: true,
      })
    ).toMatchObject({ ok: false, status: 403 });
    mockGetUserPermission.mockResolvedValueOnce({ role: "program_manager" });
    expect(
      await requireStaffAdmin({ user: { email: "pm@avantifellows.org" } })
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("accepts admins", async () => {
    mockGetUserPermission.mockResolvedValueOnce({ role: "admin" });
    expect(
      await requireStaffAdmin({ user: { email: "admin@avantifellows.org" } })
    ).toMatchObject({ ok: true, email: "admin@avantifellows.org" });
  });
});

describe("normalizeEmployeeCode / isSeatRole", () => {
  it("normalizes codes and rejects junk", () => {
    expect(normalizeEmployeeCode(" af55 ")).toBe("AF55");
    expect(normalizeEmployeeCode("MT005")).toBeNull();
    expect(normalizeEmployeeCode(42)).toBeNull();
  });

  it("knows the seat roles", () => {
    expect(isSeatRole("pm")).toBe(true);
    expect(isSeatRole("apc")).toBe(true);
    expect(isSeatRole("principal")).toBe(false);
  });
});

describe("normalizeStaffRosterParams", () => {
  it("defaults and validates filter params", () => {
    expect(normalizeStaffRosterParams({})).toEqual({
      search: "",
      kind: "all",
      code: "all",
      exited: "exclude",
      centreId: null,
    });
    expect(
      normalizeStaffRosterParams({
        search: " asha ",
        kind: "pending_pm",
        code: "missing",
        exited: "include",
        centre: "8",
      })
    ).toEqual({
      search: "asha",
      kind: "pending_pm",
      code: "missing",
      exited: "include",
      centreId: 8,
    });
    expect(
      normalizeStaffRosterParams({ kind: "bogus", code: "bogus", centre: "abc" })
    ).toMatchObject({
      kind: "all",
      code: "all",
      centreId: null,
    });
  });
});

describe("validateTeacherUpdateBody", () => {
  it("collects payload and field errors", () => {
    expect(validateTeacherUpdateBody({ teacher_id: "af9" })).toEqual({
      payload: { teacher_id: "AF9" },
      fields: {},
    });
    expect(validateTeacherUpdateBody({ teacher_id: "nope" }).fields).toHaveProperty(
      "teacher_id"
    );
    expect(validateTeacherUpdateBody({ exit_date: "12-06-2026" }).fields).toHaveProperty(
      "exit_date"
    );
    expect(validateTeacherUpdateBody({ exit_date: "2026-06-12" }).payload).toEqual({
      exit_date: "2026-06-12",
    });
  });
});

describe("getStaffRoster", () => {
  it("returns 503 when the schema is missing", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await getStaffRoster({ searchParams: {} });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it("maps roster rows, summary, and seats", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      {
        kind: "teacher",
        record_id: "10",
        user_id: "70",
        name: "Asha Teacher",
        email: "asha@avantifellows.org",
        employee_code: "AF101",
        subject_name: "Physics",
        staff_type: null,
        designation: "Senior",
        exit_date: null,
      },
      {
        kind: "pending_pm",
        record_id: "5",
        user_id: null,
        name: "Pending Pm",
        email: "pm@avantifellows.org",
        employee_code: null,
        subject_name: null,
        staff_type: "program_manager",
        designation: null,
        exit_date: null,
      },
    ]);
    mockQuery.mockResolvedValueOnce([
      {
        total: "2",
        teachers: "1",
        staff: "0",
        pending: "1",
        missing_code: "1",
        exited: "0",
      },
    ]);
    mockQuery.mockResolvedValueOnce([{ vacant: "3" }]);
    mockQuery.mockResolvedValueOnce([
      {
        id: "44",
        centre_id: "8",
        centre_name: "JNV Adilabad - CoE",
        role: "physics",
        user_id: "70",
      },
    ]);

    const result = await getStaffRoster({
      searchParams: { code: "all" },
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      kind: "teacher",
      recordId: 10,
      userId: 70,
      employeeCode: "AF101",
      seats: [
        { id: 44, centreId: 8, centreName: "JNV Adilabad - CoE", role: "physics" },
      ],
    });
    expect(result.rows[1]).toMatchObject({
      kind: "pending_pm",
      userId: null,
      seats: [],
    });
    expect(result.summary).toEqual({
      total: 2,
      teachers: 1,
      staff: 0,
      pending: 1,
      missingCode: 1,
      exited: 0,
      vacantSeats: 3,
    });
  });

  it("applies search/kind/code filters in the WHERE clause", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    await getStaffRoster({
      searchParams: { search: "asha", kind: "teacher", code: "missing" },
    });

    const [sql, values] = mockQuery.mock.calls[1];
    expect(sql).toContain("ILIKE $1");
    expect(sql).toContain("roster.kind = $2");
    expect(sql).toContain("employee_code IS NULL");
    expect(sql).toContain("exit_date IS NULL");
    expect(values).toEqual(["%asha%", "teacher"]);
  });

  it("filters by centre via an EXISTS on seats", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    await getStaffRoster({ searchParams: { centre: "8" } });

    const [sql, values] = mockQuery.mock.calls[1];
    expect(sql).toContain("EXISTS");
    expect(sql).toContain("cp.centre_id = $1");
    expect(values).toEqual([8]);
  });
});

describe("updateTeacherRecord", () => {
  it("rejects invalid bodies and unknown teachers", async () => {
    mockSchemaReady();
    expect(
      await updateTeacherRecord({ id: 1, body: { teacher_id: "junk" } })
    ).toMatchObject({ ok: false, status: 422 });

    resetStaffSchemaCheckForTests();
    mockQuery.mockResolvedValueOnce(SCHEMA_ROWS);
    mockQuery.mockResolvedValueOnce([]); // teacher lookup
    expect(
      await updateTeacherRecord({ id: 1, body: { teacher_id: "AF1" } })
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("returns 409 when the code belongs to another teacher", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 1, user_id: 70 }]);
    mockQuery.mockResolvedValueOnce([{ id: 2 }]); // clash
    expect(
      await updateTeacherRecord({ id: 1, body: { teacher_id: "AF1" } })
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("PATCHes db-service and vacates seats on exit", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("DB_SERVICE_URL", "https://db.example/api");
    vi.stubEnv("DB_SERVICE_TOKEN", "token");

    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 1, user_id: 70 }]);

    const result = await updateTeacherRecord({
      id: 1,
      body: { exit_date: "2026-06-12" },
    });
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://db.example/api/teacher/1",
      expect.objectContaining({ method: "PATCH" })
    );
    const clientSql = mockClientQuery.mock.calls.map((call) => call[0]).join("\n");
    expect(clientSql).toContain("UPDATE centre_positions SET user_id = NULL");
    expect(clientSql).toContain("UPDATE user_permission SET revoked_at = now()");
  });

  it("maps db-service failures to 422/502", async () => {
    vi.stubEnv("DB_SERVICE_URL", "https://db.example/api");
    vi.stubEnv("DB_SERVICE_TOKEN", "token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("changeset error", { status: 422 }))
    );

    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 1, user_id: 70 }]);
    mockQuery.mockResolvedValueOnce([]); // no clash
    expect(
      await updateTeacherRecord({ id: 1, body: { teacher_id: "AF1" } })
    ).toMatchObject({ ok: false, status: 422 });

    resetStaffSchemaCheckForTests();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    mockQuery.mockResolvedValueOnce(SCHEMA_ROWS);
    mockQuery.mockResolvedValueOnce([{ id: 1, user_id: 70 }]);
    mockQuery.mockResolvedValueOnce([]);
    expect(
      await updateTeacherRecord({ id: 1, body: { teacher_id: "AF1" } })
    ).toMatchObject({ ok: false, status: 502 });
  });
});

describe("createStaffMember", () => {
  it("validates the body", async () => {
    mockSchemaReady();
    const result = await createStaffMember({ body: {} });
    expect(result).toMatchObject({ ok: false, status: 422 });
    if (!result.ok && result.status === 422) {
      expect(result.fields).toHaveProperty("user_permission_id");
      expect(result.fields).toHaveProperty("employee_code");
    }
  });

  it("404s when the permission row is not a PM", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      { id: 5, email: "t@x.org", full_name: "T", role: "teacher", user_id: null },
    ]);
    expect(
      await createStaffMember({
        body: { user_permission_id: 5, employee_code: "AF7" },
      })
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("creates a user when the PM has none, then the staff row", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      {
        id: 5,
        email: "pm@avantifellows.org",
        full_name: "Pending Pm Person",
        role: "program_manager",
        user_id: null,
      },
    ]);
    mockQuery.mockResolvedValueOnce([]); // code clash check
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: "99" }] }); // user insert

    const result = await createStaffMember({
      body: { user_permission_id: 5, employee_code: "af7" },
    });
    expect(result).toEqual({ ok: true });

    const calls = mockClientQuery.mock.calls;
    expect(calls[0][0]).toContain(`INSERT INTO "user"`);
    expect(calls[0][1]).toEqual(["Pending", "Pm Person", "pm@avantifellows.org"]);
    expect(calls[1][0]).toContain("UPDATE user_permission SET user_id");
    expect(calls[2][0]).toContain("INSERT INTO staff");
    expect(calls[2][1]).toEqual([99, "AF7", null]);
  });

  it("409s when the code or person already exists", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      {
        id: 5,
        email: "pm@avantifellows.org",
        full_name: "P",
        role: "program_manager",
        user_id: 70,
      },
    ]);
    mockQuery.mockResolvedValueOnce([{ id: 1 }]); // code clash
    expect(
      await createStaffMember({
        body: { user_permission_id: 5, employee_code: "AF7" },
      })
    ).toMatchObject({ ok: false, status: 409 });
  });
});

describe("updateStaffMember", () => {
  it("updates fields and vacates on exit", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 3, user_id: 70 }]);
    const result = await updateStaffMember({
      id: 3,
      body: { exit_date: "2026-06-30" },
    });
    expect(result).toEqual({ ok: true });
    const clientSql = mockClientQuery.mock.calls.map((call) => call[0]).join("\n");
    expect(clientSql).toContain("UPDATE staff SET exit_date = $1");
    expect(clientSql).toContain("UPDATE centre_positions SET user_id = NULL");
  });

  it("404s for unknown staff and 409s on code clash", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([]);
    expect(
      await updateStaffMember({ id: 3, body: { employee_code: "AF7" } })
    ).toMatchObject({ ok: false, status: 404 });

    resetStaffSchemaCheckForTests();
    mockQuery.mockResolvedValueOnce(SCHEMA_ROWS);
    mockQuery.mockResolvedValueOnce([{ id: 3, user_id: 70 }]);
    mockQuery.mockResolvedValueOnce([{ id: 9 }]); // clash
    expect(
      await updateStaffMember({ id: 3, body: { employee_code: "AF7" } })
    ).toMatchObject({ ok: false, status: 409 });
  });
});

describe("positions", () => {
  it("createPosition validates role and centre", async () => {
    mockSchemaReady();
    expect(
      await createPosition({ body: { centre_id: 1, role: "principal" } })
    ).toMatchObject({ ok: false, status: 422 });

    resetStaffSchemaCheckForTests();
    mockQuery.mockResolvedValueOnce(SCHEMA_ROWS);
    mockQuery.mockResolvedValueOnce([]); // centre lookup
    expect(
      await createPosition({ body: { centre_id: 1, role: "pm" } })
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("createPosition inserts a vacant seat (no scope clear)", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    expect(
      await createPosition({ body: { centre_id: 8, role: "physics" } })
    ).toEqual({ ok: true });
    // A vacant seat goes through the transaction client; no occupant → no clear.
    const insertCall = mockClientQuery.mock.calls.at(-1)!;
    expect(insertCall[0]).toContain("INSERT INTO centre_positions");
    expect(insertCall[1]).toEqual([8, "physics", null]);
    expect(
      mockClientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("SET school_codes = NULL")
      )
    ).toBe(false);
  });

  it("createPosition clears the occupant's explicit school scope (strict per-user)", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user
    mockQuery.mockResolvedValueOnce([]); // duplicate check (none)
    expect(
      await createPosition({ body: { centre_id: 8, role: "physics", user_id: 70 } })
    ).toEqual({ ok: true });
    const insertCall = mockClientQuery.mock.calls[0];
    expect(insertCall[0]).toContain("INSERT INTO centre_positions");
    expect(insertCall[1]).toEqual([8, "physics", 70]);
    const clearCall = mockClientQuery.mock.calls[1];
    expect(clearCall[0]).toContain("SET school_codes = NULL, regions = NULL");
    expect(clearCall[1]).toEqual([70]);
  });

  it("createPosition rejects duplicate occupied seats", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user
    mockQuery.mockResolvedValueOnce([{ id: 44 }]); // duplicate
    expect(
      await createPosition({ body: { centre_id: 8, role: "physics", user_id: 70 } })
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("updatePosition vacates a seat without clearing scope", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 44, centre_id: 8, role: "physics" }]);
    expect(await updatePosition({ id: 44, body: { user_id: null } })).toEqual({
      ok: true,
    });
    const updateCall = mockClientQuery.mock.calls.at(-1)!;
    expect(updateCall[0]).toContain("SET user_id = $1");
    expect(updateCall[1]).toEqual([null, 44]);
    expect(
      mockClientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("SET school_codes = NULL")
      )
    ).toBe(false);
  });

  it("updatePosition fills a seat and clears the occupant's explicit scope", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 44, centre_id: 8, role: "physics" }]); // position
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user lookup
    mockQuery.mockResolvedValueOnce([]); // duplicate check (none)
    expect(await updatePosition({ id: 44, body: { user_id: 70 } })).toEqual({
      ok: true,
    });
    const updateCall = mockClientQuery.mock.calls[0];
    expect(updateCall[0]).toContain("SET user_id = $1");
    expect(updateCall[1]).toEqual([70, 44]);
    const clearCall = mockClientQuery.mock.calls[1];
    expect(clearCall[0]).toContain("SET school_codes = NULL, regions = NULL");
    expect(clearCall[1]).toEqual([70]);
  });

  it("deletePosition soft-deletes", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 44 }]);
    mockQuery.mockResolvedValueOnce([]);
    expect(await deletePosition({ id: 44 })).toEqual({ ok: true });
    expect(mockQuery.mock.calls.at(-1)![0]).toContain("SET deleted_at = now()");
  });
});
