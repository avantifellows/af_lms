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
  createSeatedUser,
  createStaffMember,
  createTeacher,
  deletePosition,
  getSubjectOptions,
  getStaffRoster,
  isSeatRole,
  normalizeEmployeeCode,
  normalizeStaffRosterParams,
  requireStaffAdmin,
  resetStaffSchemaCheckForTests,
  setUserRole,
  updatePosition,
  updateStaffMember,
  updateStaffName,
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

  it("PATCHes db-service and vacates seats on exit when there are no active Academic Mentees", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("DB_SERVICE_URL", "https://db.example/api");
    vi.stubEnv("DB_SERVICE_TOKEN", "token");

    mockSchemaReady();
    mockQuery
      .mockResolvedValueOnce([{ id: 1, user_id: 70 }])
      .mockResolvedValueOnce([]);

    const result = await updateTeacherRecord({
      id: 1,
      body: { exit_date: "2026-06-12" },
    });
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://db.example/api/teacher/1",
      expect.objectContaining({ method: "PATCH" })
    );
    const blockerCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("academic_mentorship_mentor_mentee_mappings")
    );
    expect(String(blockerCall?.[0])).toContain("m.mentor_user_id = $1");
    expect(String(blockerCall?.[0])).toContain("m.ended_at IS NULL");
    expect(blockerCall?.[1]).toEqual([70]);
    const clientSql = mockClientQuery.mock.calls.map((call) => call[0]).join("\n");
    expect(clientSql).toContain("holistic_mentorship_mentor_mentee_mappings");
    expect(clientSql).toContain("end_reason = $3");
    expect(clientSql).toContain("UPDATE centre_positions SET user_id = NULL");
    expect(clientSql).toContain("UPDATE user_permission SET revoked_at = now()");
  });

  it("does not break teacher exits before the Academic Mentorship table is deployed", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("DB_SERVICE_URL", "https://db.example/api");
    vi.stubEnv("DB_SERVICE_TOKEN", "token");
    const missingTable = Object.assign(new Error("relation does not exist"), {
      code: "42P01",
    });

    mockSchemaReady();
    mockQuery
      .mockResolvedValueOnce([{ id: 1, user_id: 70 }])
      .mockRejectedValueOnce(missingTable);

    const result = await updateTeacherRecord({
      id: 1,
      body: { exit_date: "2026-06-12" },
    });

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://db.example/api/teacher/1",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("blocks teacher exit when the teacher has active Academic Mentees", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("DB_SERVICE_URL", "https://db.example/api");
    vi.stubEnv("DB_SERVICE_TOKEN", "token");

    mockSchemaReady();
    mockQuery
      .mockResolvedValueOnce([{ id: 1, user_id: 70 }])
      .mockResolvedValueOnce([
        {
          school_code: "54019",
          academic_year: "2026-2027",
          mentee_count: "2",
        },
      ]);

    const result = await updateTeacherRecord({
      id: 1,
      body: { exit_date: "2026-06-12" },
    });

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.error).toContain("2 active Mentees");
    expect(result.error).toContain(
      "/admin/academic-mentorship?school_code=54019&academic_year=2026-2027"
    );
    expect(mockFetch).not.toHaveBeenCalled();
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
    mockQuery.mockResolvedValueOnce([]); // existing-user-by-email lookup (none)
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

  it("reuses an existing user found by email instead of inserting a duplicate", async () => {
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
    mockQuery.mockResolvedValueOnce([{ id: "70" }]); // existing user found by email
    mockQuery.mockResolvedValueOnce([]); // staff clash check (none)

    const result = await createStaffMember({
      body: { user_permission_id: 5, employee_code: "AF7" },
    });
    expect(result).toEqual({ ok: true });

    const calls = mockClientQuery.mock.calls;
    // No "user" INSERT — the existing id 70 is reused.
    expect(calls.some(([sql]) => String(sql).includes(`INSERT INTO "user"`))).toBe(
      false
    );
    expect(calls[0][0]).toContain("UPDATE user_permission SET user_id");
    expect(calls[0][1]).toEqual([70, 5]);
    expect(calls[1][0]).toContain("INSERT INTO staff");
    expect(calls[1][1]).toEqual([70, "AF7", null]);
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

describe("updateStaffName", () => {
  it("rejects a blank name", async () => {
    mockSchemaReady();
    expect(
      await updateStaffName({ body: { user_id: 70, full_name: "   " } })
    ).toMatchObject({ ok: false, status: 422 });
  });

  it("requires an identifier", async () => {
    mockSchemaReady();
    expect(
      await updateStaffName({ body: { full_name: "Jane Doe" } })
    ).toMatchObject({ ok: false, status: 422 });
  });

  it("writes the user table (split) and mirrors full_name for a linked user", async () => {
    mockSchemaReady();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE "user"
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE user_permission
    const result = await updateStaffName({
      body: { user_id: 70, full_name: "  Jane  Kumari Doe " },
    });
    expect(result).toEqual({ ok: true });
    const calls = mockClientQuery.mock.calls;
    expect(calls[0][0]).toContain('UPDATE "user" SET first_name = $1');
    expect(calls[0][1]).toEqual(["Jane", "Kumari Doe", 70]);
    expect(calls[1][0]).toContain("UPDATE user_permission SET full_name = $1");
    expect(calls[1][1]).toEqual(["Jane Kumari Doe", 70]);
  });

  it("updates user_permission.full_name for a pending row", async () => {
    mockSchemaReady();
    mockClientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const result = await updateStaffName({
      body: { permission_id: 12, full_name: "Asha" },
    });
    expect(result).toEqual({ ok: true });
    const call = mockClientQuery.mock.calls[0];
    expect(call[0]).toContain("UPDATE user_permission SET full_name = $1");
    expect(call[1]).toEqual(["Asha", 12]);
  });

  it("404s when nothing matched", async () => {
    mockSchemaReady();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(
      await updateStaffName({ body: { user_id: 999, full_name: "Ghost" } })
    ).toMatchObject({ ok: false, status: 404 });
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
    mockQuery.mockResolvedValueOnce([{ level: 1 }]); // region-level guard (not level 2)
    mockQuery.mockResolvedValueOnce([]); // duplicate check (none)
    expect(
      await createPosition({ body: { centre_id: 8, role: "physics", user_id: 70 } })
    ).toEqual({ ok: true });
    const insertCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO centre_positions")
    )!;
    expect(insertCall[1]).toEqual([8, "physics", 70]);
    const clearCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET school_codes = NULL, regions = NULL")
    )!;
    expect(clearCall[1]).toEqual([70]);
  });

  it("createPosition syncs teacher.subject_id when seated with a subject role", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user
    mockQuery.mockResolvedValueOnce([{ level: 1 }]); // region-level guard
    mockQuery.mockResolvedValueOnce([]); // duplicate check (none)
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // INSERT centre_positions
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 2 }] }); // subject lookup → Chemistry
    expect(
      await createPosition({ body: { centre_id: 8, role: "chemistry", user_id: 70 } })
    ).toEqual({ ok: true });
    const subjectLookup = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FROM subject WHERE LOWER(name")
    )!;
    expect(subjectLookup[1]).toEqual(["chemistry"]);
    const teacherUpdate = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE teacher SET subject_id")
    )!;
    expect(teacherUpdate[1]).toEqual([2, 70]);
  });

  it("createPosition does NOT touch teacher.subject_id for a PM-tier seat", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user
    mockQuery.mockResolvedValueOnce([{ level: 1 }]); // region-level guard
    mockQuery.mockResolvedValueOnce([]); // duplicate check (none)
    expect(
      await createPosition({ body: { centre_id: 8, role: "pm", user_id: 70 } })
    ).toEqual({ ok: true });
    expect(
      mockClientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE teacher SET subject_id")
      )
    ).toBe(false);
  });

  it("createPosition rejects duplicate occupied seats", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user
    mockQuery.mockResolvedValueOnce([{ level: 1 }]); // region-level guard (not level 2)
    mockQuery.mockResolvedValueOnce([{ id: 44 }]); // duplicate
    expect(
      await createPosition({ body: { centre_id: 8, role: "physics", user_id: 70 } })
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("createPosition rejects seating a region-level (level-2) user", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user
    mockQuery.mockResolvedValueOnce([{ level: 2 }]); // region-level user → blocked
    expect(
      await createPosition({ body: { centre_id: 8, role: "physics", user_id: 70 } })
    ).toMatchObject({ ok: false, status: 422 });
    // No transaction / insert happened.
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("updatePosition vacates a seat without clearing scope", async () => {
    mockSchemaReady();
    // Occupant 70 has another active seat, so vacating this one isn't a strand.
    mockQuery.mockResolvedValueOnce([
      { id: 44, centre_id: 8, role: "physics", user_id: 70 },
    ]);
    mockQuery.mockResolvedValueOnce([{ id: 99 }]); // isLastActiveSeat → not last
    expect(await updatePosition({ id: 44, body: { user_id: null } })).toEqual({
      ok: true,
    });
    const updateCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE centre_positions SET user_id = $1")
    )!;
    expect(updateCall[1]).toEqual([null, 44]);
    const holisticCleanup = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("holistic_mentorship_mentor_mentee_mappings")
    );
    expect(holisticCleanup?.[1]).toEqual([
      70,
      "af_lms_staff_management",
      "mentor_seat_changed",
      false,
      expect.any(Array),
    ]);
    expect(String(holisticCleanup?.[0])).toContain("NOT EXISTS");
    expect(
      mockClientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("SET school_codes = NULL")
      )
    ).toBe(false);
  });

  it("updatePosition refuses to vacate an occupant's only seat unless forced", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      { id: 44, centre_id: 8, role: "physics", user_id: 70 },
    ]); // position
    mockQuery.mockResolvedValueOnce([]); // isLastActiveSeat → no other seats → last
    const blocked = await updatePosition({ id: 44, body: { user_id: null } });
    expect(blocked).toMatchObject({ ok: false, status: 409, code: "last_seat" });
    expect(mockClientQuery).not.toHaveBeenCalled();

    // With force the vacate proceeds (no last-seat check query needed).
    resetStaffSchemaCheckForTests();
    mockQuery.mockResolvedValueOnce(SCHEMA_ROWS);
    mockQuery.mockResolvedValueOnce([
      { id: 44, centre_id: 8, role: "physics", user_id: 70 },
    ]);
    expect(
      await updatePosition({ id: 44, body: { user_id: null }, force: true })
    ).toEqual({ ok: true });
    expect(
      mockClientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE centre_positions SET user_id = $1")
      )
    ).toBe(true);
  });

  it("updatePosition fills a seat and clears the occupant's explicit scope", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      { id: 44, centre_id: 8, role: "physics", user_id: null },
    ]); // position
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user lookup
    mockQuery.mockResolvedValueOnce([{ level: 1 }]); // region-level guard (not level 2)
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

  it("setUserRole updates every active seat for the person", async () => {
    mockSchemaReady();
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 44 }, { id: 51 }] }); // 2 seats updated
    expect(
      await setUserRole({ body: { user_id: 70, role: "spm" } })
    ).toEqual({ ok: true });
    const updateCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE centre_positions SET role = $1")
    )!;
    expect(updateCall[0]).toContain("WHERE user_id = $2 AND deleted_at IS NULL");
    expect(updateCall[1]).toEqual(["spm", 70]);
    // spm is a PM tier, not a subject — no teacher.subject_id write.
    expect(
      mockClientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE teacher SET subject_id")
      )
    ).toBe(false);
  });

  it("setUserRole syncs teacher.subject_id when set to a subject role", async () => {
    mockSchemaReady();
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 44 }] }); // seat updated
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // subject lookup → Maths
    expect(
      await setUserRole({ body: { user_id: 70, role: "maths" } })
    ).toEqual({ ok: true });
    const teacherUpdate = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE teacher SET subject_id")
    )!;
    expect(teacherUpdate[1]).toEqual([1, 70]);
  });

  it("setUserRole validates user_id and role", async () => {
    mockSchemaReady();
    expect(
      await setUserRole({ body: { user_id: 0, role: "spm" } })
    ).toMatchObject({ ok: false, status: 422, fields: { user_id: expect.any(String) } });
    resetStaffSchemaCheckForTests();
    mockQuery.mockResolvedValueOnce(SCHEMA_ROWS);
    expect(
      await setUserRole({ body: { user_id: 70, role: "principal" } })
    ).toMatchObject({ ok: false, status: 422, fields: { role: expect.any(String) } });
  });

  it("setUserRole 404s when the person holds no active seats", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([]); // no seats updated
    expect(
      await setUserRole({ body: { user_id: 70, role: "spm" } })
    ).toMatchObject({ ok: false, status: 404 });
  });

  // --- app-role sync (user_permission.role driven by centre seats) ---

  // Locate the syncAppRoleFromSeats UPDATE among the transaction's queries.
  const appRoleUpdate = () =>
    mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE user_permission") &&
      String(sql).includes("SET role = $2")
    );

  it("createPosition promotes Teachers without overwriting manually elevated roles", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user
    mockQuery.mockResolvedValueOnce([{ level: 1 }]); // region-level guard
    mockQuery.mockResolvedValueOnce([]); // duplicate check (none)
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // INSERT centre_positions
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // clearExplicitSchoolScope
    mockClientQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] }); // has a PM-tier seat
    expect(
      await createPosition({ body: { centre_id: 8, role: "apm", user_id: 70 } })
    ).toEqual({ ok: true });
    const roleUpdate = appRoleUpdate()!;
    expect(roleUpdate[1]).toEqual([70, "program_manager"]);
    // The narrow role band also preserves holistic_mentorship_admin.
    expect(String(roleUpdate[0])).toContain(
      "role IN ('teacher', 'program_manager')"
    );
  });

  it("createPosition keeps role at teacher for a subject seat (no PM seat)", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user
    mockQuery.mockResolvedValueOnce([{ level: 1 }]); // region-level guard
    mockQuery.mockResolvedValueOnce([]); // duplicate check (none)
    // SELECT-has-PM-seat falls through to the default mock ({ rows: [] }) → none.
    expect(
      await createPosition({ body: { centre_id: 8, role: "physics", user_id: 70 } })
    ).toEqual({ ok: true });
    expect(appRoleUpdate()![1]).toEqual([70, "teacher"]);
  });

  it("setUserRole promotes to program_manager when set to a PM tier", async () => {
    mockSchemaReady();
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 44 }] }); // seats updated
    mockClientQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] }); // has a PM-tier seat
    expect(
      await setUserRole({ body: { user_id: 70, role: "spm" } })
    ).toEqual({ ok: true });
    expect(appRoleUpdate()![1]).toEqual([70, "program_manager"]);
  });

  it("setUserRole demotes to teacher when all seats become subject roles", async () => {
    mockSchemaReady();
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 44 }] }); // seats updated
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 4 }] }); // subject lookup (physics)
    // SELECT-has-PM-seat → default mock ({ rows: [] }) → no PM tier left.
    expect(
      await setUserRole({ body: { user_id: 70, role: "physics" } })
    ).toEqual({ ok: true });
    expect(appRoleUpdate()![1]).toEqual([70, "teacher"]);
  });

  it("updatePosition re-derives the prior occupant's role when a seat is vacated", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      { id: 44, centre_id: 8, role: "pm", user_id: 70 },
    ]); // position (occupied by 70)
    mockQuery.mockResolvedValueOnce([{ id: 99 }]); // isLastActiveSeat → not last
    expect(await updatePosition({ id: 44, body: { user_id: null } })).toEqual({
      ok: true,
    });
    // 70 lost this PM seat; with no PM seat left (default mock) → teacher.
    expect(appRoleUpdate()![1]).toEqual([70, "teacher"]);
  });

  it("deletePosition demotes the occupant when their last PM seat is removed", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 44, user_id: 70 }]); // position
    mockQuery.mockResolvedValueOnce([{ id: 99 }]); // isLastActiveSeat → not last (subject seat remains)
    expect(await deletePosition({ id: 44 })).toEqual({ ok: true });
    expect(appRoleUpdate()![1]).toEqual([70, "teacher"]);
  });

  it("deletePosition of a vacant seat touches no app role", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 44, user_id: null }]); // vacant position
    expect(await deletePosition({ id: 44 })).toEqual({ ok: true });
    expect(appRoleUpdate()).toBeUndefined();
  });

  // --- program_ids sync (user_permission.program_ids = union of seat programs) ---

  const progUpdate = () =>
    mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE user_permission") &&
      String(sql).includes("SET program_ids")
    );
  // Route the transaction's client queries by SQL so the program_id SELECT can
  // return a controlled set regardless of call order.
  const routeClient = (programIds: number[], hasPmSeat = true) =>
    mockClientQuery.mockImplementation((sql: unknown) => {
      const s = String(sql);
      if (s.includes("SELECT DISTINCT c.program_id"))
        return Promise.resolve({ rows: programIds.map((program_id: number) => ({ program_id })) });
      if (s.includes("role = ANY")) return Promise.resolve({ rows: hasPmSeat ? [{ n: 1 }] : [] });
      return Promise.resolve({ rows: [] });
    });

  it("createPosition sets program_ids to the union of the person's seat programs", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 70 }]); // user
    mockQuery.mockResolvedValueOnce([{ level: 1 }]); // region-level guard
    mockQuery.mockResolvedValueOnce([]); // duplicate check
    routeClient([2, 1]); // active seats now span programs 1 and 2 (unsorted)
    expect(
      await createPosition({ body: { centre_id: 8, role: "pm", user_id: 70 } })
    ).toEqual({ ok: true });
    const upd = progUpdate()!;
    expect(upd[1]).toEqual([70, [1, 2]]); // sorted union
    // Seat sync never shrinks either manually elevated admin role's Program scope.
    expect(String(upd[0])).toContain(
      "role NOT IN ('admin', 'holistic_mentorship_admin')"
    );
    expect(String(upd[0])).toContain("revoked_at IS NULL");
  });

  it("deletePosition recomputes program_ids from the remaining seats", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 44, user_id: 70 }]); // position
    mockQuery.mockResolvedValueOnce([{ id: 99 }]); // isLastActiveSeat → not last
    routeClient([1]); // after removal only a program-1 seat remains
    expect(await deletePosition({ id: 44 })).toEqual({ ok: true });
    expect(progUpdate()![1]).toEqual([70, [1]]);
  });

  it("does not touch program_ids when the person has no active seat", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 44, user_id: 70 }]); // position
    mockQuery.mockResolvedValueOnce([{ id: 99 }]); // isLastActiveSeat → not last
    routeClient([]); // no seats resolve to a program
    expect(await deletePosition({ id: 44 })).toEqual({ ok: true });
    expect(progUpdate()).toBeUndefined();
  });

  it("createTeacher creates the user, teacher record, and seat", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      { id: 88, email: "t@x.org", full_name: "Pending Teacher", role: "teacher", level: 1, user_id: null },
    ]); // permission
    mockQuery.mockResolvedValueOnce([{ id: 4 }]); // subject exists
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre exists
    mockQuery.mockResolvedValueOnce([]); // teacher_id clash (none)
    mockQuery.mockResolvedValueOnce([]); // reuse-by-email (no existing user)
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 500 }] }); // INSERT user
    expect(
      await createTeacher({
        body: { user_permission_id: 88, subject_id: 4, centre_id: 8, teacher_id: "af777" },
      })
    ).toEqual({ ok: true });
    const teacherInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO teacher")
    );
    expect(teacherInsert![1]).toEqual([500, 4, "AF777"]);
    const seatInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO centre_positions")
    );
    expect(String(seatInsert![0])).toContain("'subject_tbd'");
    expect(seatInsert![1]).toEqual([8, 500]);
    // seat-as-source-of-truth: explicit scope cleared on seat creation
    expect(
      mockClientQuery.mock.calls.some((c) =>
        String(c[0]).includes("school_codes = NULL")
      )
    ).toBe(true);
  });

  it("createTeacher allows a blank AF id (not-yet-hired) and reuses an existing user", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      { id: 88, email: "t@x.org", full_name: "T", role: "teacher", level: 1, user_id: 70 },
    ]); // permission (already linked to a user)
    mockQuery.mockResolvedValueOnce([{ id: 4 }]); // subject
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([]); // teacher clash (none)
    expect(
      await createTeacher({ body: { user_permission_id: 88, subject_id: 4, centre_id: 8 } })
    ).toEqual({ ok: true });
    const teacherInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO teacher")
    );
    expect(teacherInsert![1]).toEqual([70, 4, null]); // teacher_id null
  });

  it("createTeacher requires subject and centre", async () => {
    mockSchemaReady();
    expect(
      await createTeacher({ body: { user_permission_id: 88 } })
    ).toMatchObject({
      ok: false,
      status: 422,
      fields: { subject_id: expect.any(String), centre_id: expect.any(String) },
    });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("createTeacher rejects region-level users", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      { id: 88, email: "t@x.org", full_name: "T", role: "teacher", level: 2, user_id: 70 },
    ]);
    expect(
      await createTeacher({ body: { user_permission_id: 88, subject_id: 4, centre_id: 8 } })
    ).toMatchObject({ ok: false, status: 422 });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("createTeacher 409s when the person already has a teacher record", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([
      { id: 88, email: "t@x.org", full_name: "T", role: "teacher", level: 1, user_id: 70 },
    ]);
    mockQuery.mockResolvedValueOnce([{ id: 4 }]); // subject
    mockQuery.mockResolvedValueOnce([{ id: 8 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 999 }]); // teacher clash → exists
    expect(
      await createTeacher({ body: { user_permission_id: 88, subject_id: 4, centre_id: 8 } })
    ).toMatchObject({ ok: false, status: 409 });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("createSeatedUser creates a teacher + permission + seat atomically", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8, program_id: 2 }]); // centre + program
    mockQuery.mockResolvedValueOnce([]); // existing permission (none)
    mockQuery.mockResolvedValueOnce([]); // AF clash (none)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 600 }] }) // INSERT user_permission
      .mockResolvedValueOnce({ rows: [] }) // SELECT user (none)
      .mockResolvedValueOnce({ rows: [{ id: 700 }] }); // INSERT user
    expect(
      await createSeatedUser({
        body: {
          email: "new@x.org",
          full_name: "New Teach",
          kind: "teacher",
          centre_id: 8,
          subject_id: 4,
          af_id: "af9",
        },
      })
    ).toEqual({ ok: true });
    const permInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO user_permission")
    );
    expect(permInsert![1]).toEqual(["new@x.org", "teacher", [2], "New Teach"]);
    const teacherInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO teacher")
    );
    expect(teacherInsert![1]).toEqual([700, 4, "AF9"]);
    const seatInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO centre_positions")
    );
    expect(seatInsert![1]).toEqual([8, "subject_tbd", 700]);
  });

  it("createSeatedUser creates a PM/staff member + tier seat (AF optional)", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8, program_id: 2 }]); // centre
    mockQuery.mockResolvedValueOnce([]); // existing permission (none)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 601 }] }) // INSERT user_permission
      .mockResolvedValueOnce({ rows: [] }) // SELECT user (none)
      .mockResolvedValueOnce({ rows: [{ id: 701 }] }); // INSERT user
    expect(
      await createSeatedUser({
        body: { email: "pm@x.org", kind: "staff", role: "spm", centre_id: 8 },
      })
    ).toEqual({ ok: true });
    const permInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO user_permission")
    );
    expect(permInsert![1]).toEqual(["pm@x.org", "program_manager", [2], null]);
    const staffInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO staff")
    );
    expect(staffInsert![1]).toEqual([701, null]); // employee_code null (no AF)
    const seatInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO centre_positions")
    );
    expect(seatInsert![1]).toEqual([8, "spm", 701]);
  });

  it("createSeatedUser refuses an email that already exists", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8, program_id: 2 }]); // centre
    mockQuery.mockResolvedValueOnce([{ id: 593 }]); // existing permission → conflict
    expect(
      await createSeatedUser({
        body: { email: "dup@x.org", kind: "teacher", centre_id: 8, subject_id: 4 },
      })
    ).toMatchObject({ ok: false, status: 409 });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("createSeatedUser reactivates a dormant teacher record instead of duplicating (re-add after delete)", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8, program_id: 2 }]); // centre
    mockQuery.mockResolvedValueOnce([]); // existing permission (none — was deleted)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 602 }] }) // INSERT user_permission
      .mockResolvedValueOnce({ rows: [{ id: 246195 }] }) // SELECT user (exists by email)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE user_permission user_id
      .mockResolvedValueOnce({ rows: [{ id: 3098 }] }); // dormant teacher row exists
    expect(
      await createSeatedUser({
        body: { email: "orphan@x.org", kind: "teacher", centre_id: 8, subject_id: 4 },
      })
    ).toEqual({ ok: true });
    // Reuses the dormant row — no duplicate teacher inserted.
    expect(
      mockClientQuery.mock.calls.some((c) =>
        String(c[0]).includes("UPDATE teacher SET")
      )
    ).toBe(true);
    expect(
      mockClientQuery.mock.calls.some((c) =>
        String(c[0]).includes("INSERT INTO teacher")
      )
    ).toBe(false);
  });

  it("createSeatedUser blocks a centre with no program", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 8, program_id: null }]); // no program
    expect(
      await createSeatedUser({
        body: { email: "x@x.org", kind: "teacher", centre_id: 8, subject_id: 4 },
      })
    ).toMatchObject({ ok: false, status: 422, fields: { centre_id: expect.any(String) } });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("createSeatedUser requires a subject for teachers and a valid tier for staff", async () => {
    mockSchemaReady();
    expect(
      await createSeatedUser({ body: { email: "x@x.org", kind: "teacher", centre_id: 8 } })
    ).toMatchObject({ ok: false, status: 422, fields: { subject_id: expect.any(String) } });
    resetStaffSchemaCheckForTests();
    mockQuery.mockResolvedValueOnce(SCHEMA_ROWS);
    expect(
      await createSeatedUser({
        body: { email: "x@x.org", kind: "staff", role: "principal", centre_id: 8 },
      })
    ).toMatchObject({ ok: false, status: 422, fields: { role: expect.any(String) } });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("getSubjectOptions returns id + English label", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 4, name: "Physics" },
      { id: 2, name: "Chemistry" },
    ]);
    expect(await getSubjectOptions()).toEqual([
      { id: 4, name: "Physics" },
      { id: 2, name: "Chemistry" },
    ]);
  });

  it("deletePosition soft-deletes a vacant seat", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 44, user_id: null }]); // vacant seat
    expect(await deletePosition({ id: 44 })).toEqual({ ok: true });
    // Soft-delete now runs inside the transaction (so the role re-derive is atomic).
    expect(
      mockClientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("SET deleted_at = now()")
      )
    ).toBe(true);
  });

  it("deletePosition refuses to delete an occupant's only seat unless forced", async () => {
    mockSchemaReady();
    mockQuery.mockResolvedValueOnce([{ id: 44, user_id: 70 }]); // occupied seat
    mockQuery.mockResolvedValueOnce([]); // isLastActiveSeat → last
    expect(await deletePosition({ id: 44 })).toMatchObject({
      ok: false,
      status: 409,
      code: "last_seat",
    });

    resetStaffSchemaCheckForTests();
    mockQuery.mockResolvedValueOnce(SCHEMA_ROWS);
    mockQuery.mockResolvedValueOnce([{ id: 44, user_id: 70 }]); // occupied seat (force skips the last-seat check)
    expect(await deletePosition({ id: 44, force: true })).toEqual({ ok: true });
    expect(
      mockClientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("SET deleted_at = now()")
      )
    ).toBe(true);
  });
});
