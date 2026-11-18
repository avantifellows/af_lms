import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The export route through the real gate, permission layer, loader and rules:
// only the session, the Postgres `query()` boundary, the PMU test set list
// (Firestore) and the BigQuery client are stubbed, as in the read route's tests.
const { mockQuery, mockGetServerSession, mockGetNvsTestSets, mockBigQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
  mockGetNvsTestSets: vi.fn(),
  mockBigQuery: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/test-set-list", () => ({ getNvsTestSets: mockGetNvsTestSets }));
vi.mock("@/lib/bigquery", () => ({ getBigQueryClient: () => ({ query: mockBigQuery }) }));

// The loader keeps warehouse reads in an in-process cache, so each test loads
// a fresh copy of the route.
let GET: typeof import("./route").GET;

const email = "viewer@avantifellows.org";

const jnvSchool = {
  id: "9",
  code: "JNV001",
  name: "JNV Test",
  region: "South",
  af_school_category: "JNV",
};

const rosterRow = (overrides: Record<string, unknown>) => ({
  group_user_id: `gu-${overrides.user_id}`,
  student_pk_id: `sp-${overrides.user_id}`,
  last_name: null,
  phone: "9876543210",
  status: "enrolled",
  program_id: 64,
  program_name: "JNV NVS",
  student_program_ids: [64],
  dropout_program_ids: [],
  ...overrides,
});

// Six NVS Students and one CoE Student at a mixed JNV School.
const roster = [
  rosterRow({ user_id: "1", first_name: "Zoya", last_name: "Ali", student_id: "NVS1", grade: 11, stream: "engineering" }),
  rosterRow({ user_id: "2", first_name: "Kiran", last_name: "Das", student_id: "NVS2", grade: 12, stream: "medical" }),
  rosterRow({ user_id: "3", first_name: "Neel", last_name: "Jha", student_id: "NVS3", grade: 11, stream: "Engineering" }),
  rosterRow({ user_id: "4", first_name: "Asha", last_name: "Bose", student_id: "NVS4", grade: 11, stream: "ENGINEERING" }),
  rosterRow({ user_id: "5", first_name: "Bala", last_name: "Nair", student_id: "NVS5", grade: 11, stream: null }),
  rosterRow({ user_id: "7", first_name: "Dev", last_name: "Rao", student_id: "NVS7", grade: 11, stream: "engineering" }),
  rosterRow({ user_id: "8", first_name: "Chetan", last_name: "Coe", student_id: "COE1", grade: 11, stream: "engineering", program_id: 1, program_name: "JNV CoE", student_program_ids: [1] }),
];

// `session` rows as Postgres returns them: IST wall clock.
const sessionRow = (platform_id: string, start_time: string, end_time: string, grade: string) => ({
  platform_id,
  start_time,
  end_time,
  grade,
  is_active: true,
});

// Server time 2026-11-18T08:30:00Z = 18 Nov 2026, 2:00 pm IST. August,
// September and October have closed (Grades 11 and 12); November is running
// (Grade 11 only).
const testSets = [
  { label: "August", quizIds: ["aug-g11", "aug-g12"] },
  { label: "September", quizIds: ["sep-g11", "sep-g12"] },
  { label: "October", quizIds: ["oct-g11", "oct-g12"] },
  { label: "November", quizIds: ["nov-g11"] },
];
const sessionRows = [
  sessionRow("aug-g11", "2026-08-18 05:00:00", "2026-08-22 23:55:00", "11"),
  sessionRow("aug-g12", "2026-08-18 05:00:00", "2026-08-22 23:55:00", "12"),
  sessionRow("sep-g11", "2026-09-15 05:00:00", "2026-09-19 23:55:00", "11"),
  sessionRow("sep-g12", "2026-09-15 05:00:00", "2026-09-19 23:55:00", "12"),
  sessionRow("oct-g11", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "11"),
  sessionRow("oct-g12", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "12"),
  sessionRow("nov-g11", "2026-11-17 05:00:00", "2026-11-21 23:55:00", "11"),
];

// Warehouse rows: a Student opened the Paper; `submitted` as the read returns it.
const bq = (user_id: string, quiz_id: string, submitted: boolean | null) => ({ user_id, quiz_id, submitted });
const attendanceRows = [
  // Zoya: submitted every test.
  bq("1", "aug-g11", true), bq("1", "sep-g11", true), bq("1", "oct-g11", true), bq("1", "nov-g11", true),
  // Kiran (Grade 12): absent in August and September, submitted October.
  bq("2", "oct-g12", true),
  // Neel: opened August and October without submitting, submitted September; nothing in November.
  bq("3", "aug-g11", false), bq("3", "sep-g11", true), bq("3", "oct-g11", null),
  // Asha: absent August to October, submitted November.
  bq("4", "nov-g11", true),
  // Bala: submitted August and October, opened September without submitting; November in progress.
  bq("5", "aug-g11", true), bq("5", "sep-g11", false), bq("5", "oct-g11", true), bq("5", "nov-g11", false),
  // Dev: submitted August to October; nothing in November.
  bq("7", "aug-g11", true), bq("7", "sep-g11", true), bq("7", "oct-g11", true),
  // Chetan (CoE) is not on the list, whatever the warehouse holds.
  bq("8", "oct-g11", true),
];

let permissionRow: Record<string, unknown> | null;
let school: Record<string, unknown> | null;

function row(role: string, overrides: Record<string, unknown> = {}) {
  return {
    email,
    level: 1,
    role,
    school_codes: ["JNV001"],
    regions: null,
    program_ids: [1, 2, 64],
    read_only: false,
    user_id: 777,
    ...overrides,
  };
}

const isRosterRead = (sql: string) => sql.includes("group_user");
const isSessionRead = (sql: string) => /FROM\s+session\b/.test(sql);

function defaultQuery(sql: string) {
  if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
  if (sql.includes("FROM school WHERE")) return school ? [school] : [];
  if (sql.includes("program_dropout_audits")) return roster;
  if (isSessionRead(sql)) return sessionRows;
  return [];
}

async function get(search: string, udise = "JNV001") {
  return GET(new NextRequest(`http://localhost/api/school/${udise}/test-attendance/export${search}`), {
    params: Promise.resolve({ udise }),
  });
}

/** The workbook's only sheet, as its name and rows of cell values (blank cells as ""). */
async function sheetOf(response: Response) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
  expect(workbook.worksheets).toHaveLength(1);
  const sheet = workbook.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (r) => {
    rows.push(Array.from({ length: sheet.columnCount }, (_, i) => r.getCell(i + 1).value ?? ""));
  });
  return { name: sheet.name, rows };
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  ({ GET } = await import("./route"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T08:30:00.000Z"));
  school = jnvSchool;
  permissionRow = row("pmu_govt_school_user");
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockGetNvsTestSets.mockResolvedValue(testSets);
  mockBigQuery.mockImplementation(async (options: { query: string }) =>
    options.query.includes("__TABLES__") ? [[]] : [attendanceRows],
  );
  mockQuery.mockImplementation(async (sql: string) => defaultQuery(sql));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/school/[udise]/test-attendance/export — month list", () => {
  it("returns every counted Student of a closed month under All, by grade then name, with Status and Previous 3 tests", async () => {
    const response = await get("?period=october&grade=all&examPreparingFor=all&list=all");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="test-attendance-JNV001-october.xlsx"',
    );
    // Previous 3 tests for October: August and September (the closed tests before it).
    expect(await sheetOf(response)).toEqual({
      name: "October",
      rows: [
        ["Student Name", "Student ID", "Grade", "Exam Preparing For", "Status", "Previous 3 tests"],
        ["Asha Bose", "NVS4", 11, "Engineering", "Absent", "Missed Aug, Sep"],
        ["Bala Nair", "NVS5", 11, "Not set", "Submitted", "Not submitted Sep"],
        ["Dev Rao", "NVS7", 11, "Engineering", "Submitted", ""],
        ["Neel Jha", "NVS3", 11, "Engineering", "Opened, not submitted", "Not submitted Aug"],
        ["Zoya Ali", "NVS1", 11, "Engineering", "Submitted", ""],
        ["Kiran Das", "NVS2", 12, "Medical", "Submitted", "Missed Aug, Sep"],
      ],
    });
  });
});

describe("GET /api/school/[udise]/test-attendance/export — lists", () => {
  it("returns a running month's Yet to start list, the list the month page opens on", async () => {
    const response = await get("?period=november&grade=all&examPreparingFor=all&list=not_opened");

    expect(response.status).toBe(200);
    // Previous 3 tests for November: August, September and October.
    expect(await sheetOf(response)).toEqual({
      name: "November",
      rows: [
        ["Student Name", "Student ID", "Grade", "Exam Preparing For", "Status", "Previous 3 tests"],
        ["Dev Rao", "NVS7", 11, "Engineering", "Yet to start", ""],
        ["Neel Jha", "NVS3", 11, "Engineering", "Yet to start", "Not submitted Aug, Oct"],
      ],
    });
  });

  it("returns the All year list under the Grade and Exam Preparing For filters, Follow Up first, then Not Submitting", async () => {
    const response = await get("?period=all&grade=11&examPreparingFor=Engineering&list=all");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="test-attendance-JNV001-all-year.xlsx"',
    );
    expect(await sheetOf(response)).toEqual({
      name: "All year",
      rows: [
        ["Student Name", "Student ID", "Grade", "Exam Preparing For", "Aug", "Sep", "Oct", "Attended", "Tag", "Follow-up"],
        ["Asha Bose", "NVS4", 11, "Engineering", "Absent", "Absent", "Absent", "0 of 3 (0%)", "Follow up", "Missed Aug, Sep, Oct"],
        ["Neel Jha", "NVS3", 11, "Engineering", "Opened, not submitted", "Submitted", "Opened, not submitted", "3 of 3 (100%)", "Not submitting", "Not submitted Aug, Oct"],
        ["Dev Rao", "NVS7", 11, "Engineering", "Submitted", "Submitted", "Submitted", "3 of 3 (100%)", "", ""],
        ["Zoya Ali", "NVS1", 11, "Engineering", "Submitted", "Submitted", "Submitted", "3 of 3 (100%)", "", ""],
      ],
    });
  });

  it("returns only the Need follow-up Students under that list filter", async () => {
    const response = await get("?period=all&grade=all&examPreparingFor=all&list=follow_up");

    const { rows } = await sheetOf(response);
    expect(rows.slice(1).map((r) => [r[0], r[8], r[9]])).toEqual([
      ["Asha Bose", "Follow up", "Missed Aug, Sep, Oct"],
      ["Kiran Das", "Follow up", "Missed Aug, Sep · attended Oct"],
    ]);
  });

  it("leaves a window month blank for a Student not counted for it", async () => {
    // A Student who joined NVS on 1 Oct: counted for October only.
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes("start_date") ? [{ user_id: "7", start_date: "2026-10-01" }] : defaultQuery(sql),
    );

    const response = await get("?period=all&grade=11&examPreparingFor=Engineering&list=all");

    const { rows } = await sheetOf(response);
    expect(rows.find((r) => r[0] === "Dev Rao")).toEqual(
      ["Dev Rao", "NVS7", 11, "Engineering", "", "", "Submitted", "1 of 1 (100%)", "", ""],
    );
  });

  it("returns every matching row, not only the first 25 shown before Show all", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      rosterRow({ user_id: String(100 + i), first_name: `Student${String(i).padStart(2, "0")}`, student_id: `S${i}`, grade: 11, stream: "engineering" }),
    );
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes("program_dropout_audits") ? many : defaultQuery(sql),
    );

    const response = await get("?period=november&grade=all&examPreparingFor=all&list=not_opened");

    const { rows } = await sheetOf(response);
    expect(rows).toHaveLength(31);
    expect(rows[1][0]).toBe("Student00");
    expect(rows[30][0]).toBe("Student29");
  });

  it("opens a month on Yet to start and All year on every Student when no list filter is sent", async () => {
    const month = await sheetOf(await get("?period=november"));
    const allYear = await sheetOf(await get("?period=all"));

    expect(month.rows.slice(1).map((r) => r[0])).toEqual(["Dev Rao", "Neel Jha"]);
    expect(allYear.rows).toHaveLength(7);
  });
});

function expectNoSourceRead() {
  const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
  expect(sqls.filter(isRosterRead)).toEqual([]);
  expect(sqls.filter(isSessionRead)).toEqual([]);
  expect(mockGetNvsTestSets).not.toHaveBeenCalled();
  expect(mockBigQuery).not.toHaveBeenCalled();
}

const listSearch = "?period=october&grade=all&examPreparingFor=all&list=all";

describe("GET /api/school/[udise]/test-attendance/export — gate", () => {
  it("answers 401 when signed out, before any read", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await get(listSearch);

    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown School", async () => {
    school = null;

    const response = await get(listSearch);

    expect(response.status).toBe(404);
    expectNoSourceRead();
  });

  it.each([
    ["teacher"],
    ["program_manager"],
    ["program_admin"],
    ["holistic_mentorship_admin"],
    ["alumni_manager"],
  ])("refuses %s with 403 at an in-scope JNV School, without reading any source", async (role) => {
    permissionRow = row(role);

    const response = await get(listSearch);

    expect(response.status).toBe(403);
    expectNoSourceRead();
  });

  it.each([
    ["admin", row("admin", { level: 3, school_codes: null })],
    ["pmu_manager", row("pmu_manager", { level: 3, school_codes: null })],
    ["pmu_govt_school_user", row("pmu_govt_school_user")],
  ])("refuses %s with 403 at a non-JNV School", async (_role, permission) => {
    permissionRow = permission;
    school = { ...jnvSchool, af_school_category: "Punjab CoE" };

    const response = await get(listSearch);

    expect(response.status).toBe(403);
    expectNoSourceRead();
  });

  it("refuses a PMU user outside their Schools with 403", async () => {
    permissionRow = row("pmu_manager", { school_codes: ["JNV999"] });

    const response = await get(listSearch);

    expect(response.status).toBe(403);
    expectNoSourceRead();
  });

  it.each([
    ["admin", row("admin", { level: 3, school_codes: null })],
    ["read_only admin", row("admin", { level: 3, school_codes: null, read_only: true })],
    ["pmu_manager", row("pmu_manager")],
    ["read_only pmu_manager", row("pmu_manager", { read_only: true })],
    ["pmu_govt_school_user", row("pmu_govt_school_user")],
    ["read_only pmu_govt_school_user", row("pmu_govt_school_user", { read_only: true })],
  ])("answers 200 with the workbook for %s", async (_label, permission) => {
    permissionRow = permission;

    const response = await get(listSearch);

    expect(response.status).toBe(200);
    expect((await sheetOf(response)).rows).toHaveLength(7);
  });
});

describe("GET /api/school/[udise]/test-attendance/export — parameters", () => {
  it.each([
    ["no period", "?grade=all&examPreparingFor=all&list=all"],
    ["an empty period", "?period=&grade=all"],
    ["a grade of 13", "?period=october&grade=13"],
    ["a grade that is not a number", "?period=october&grade=eleven"],
    ["an unknown Exam Preparing For", "?period=october&examPreparingFor=Arts"],
    ["Exam Preparing For in another case", "?period=october&examPreparingFor=engineering"],
    ["an unknown list filter", "?period=october&list=everyone"],
    ["a tag filter on a month", "?period=october&list=follow_up"],
    ["a status filter on All year", "?period=all&list=not_opened"],
  ])("answers 400 for %s, without reading any source", async (_label, search) => {
    const response = await get(search);

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expectNoSourceRead();
  });

  it("accepts Not set as Exam Preparing For", async () => {
    const response = await get("?period=october&examPreparingFor=Not%20set&list=all");

    expect(response.status).toBe(200);
    expect((await sheetOf(response)).rows.slice(1).map((r) => r[0])).toEqual(["Bala Nair"]);
  });

  it.each([
    ["an unknown Monthly Test key", "?period=march"],
    ["a Monthly Test that has not opened yet", "?period=december"],
  ])("answers 404 for %s", async (_label, search) => {
    mockGetNvsTestSets.mockResolvedValue([...testSets, { label: "December", quizIds: ["dec-g12"] }]);
    mockQuery.mockImplementation(async (sql: string) =>
      isSessionRead(sql)
        ? [...sessionRows, sessionRow("dec-g12", "2026-12-08 05:00:00", "2026-12-12 23:55:00", "12")]
        : defaultQuery(sql),
    );

    const response = await get(search);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Monthly Test not found" });
  });
});

describe("GET /api/school/[udise]/test-attendance/export — failed sources", () => {
  it.each([
    ["the PMU test set list is unavailable", () => mockGetNvsTestSets.mockResolvedValue("unavailable")],
    [
      "the roster read fails",
      () =>
        mockQuery.mockImplementation(async (sql: string) => {
          if (sql.includes("program_dropout_audits")) throw new Error("connection reset");
          return defaultQuery(sql);
        }),
    ],
    [
      "the session read fails",
      () =>
        mockQuery.mockImplementation(async (sql: string) => {
          if (isSessionRead(sql)) throw new Error("statement timeout");
          return defaultQuery(sql);
        }),
    ],
    ["the attendance read fails", () => mockBigQuery.mockRejectedValue(new Error("Access Denied: Table fact_student_test_attendance"))],
  ])("answers 500, never an empty workbook, when %s", async (_label, fail) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    fail();

    const response = await get(listSearch);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to export Test Attendance" });
    consoleError.mockRestore();
  });

  it("logs the error message only, never Student names or ids", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockBigQuery.mockRejectedValue(new Error("Access Denied: Table fact_student_test_attendance"));

    await get(listSearch);

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("Access Denied");
    expect(logged).not.toMatch(/Zoya|Neel|NVS1|NVS3/);
    consoleError.mockRestore();
  });

  it("still exports when the last-refreshed lookup fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockBigQuery.mockImplementation(async (options: { query: string }) => {
      if (options.query.includes("__TABLES__")) throw new Error("Access Denied: __TABLES__");
      return [attendanceRows];
    });

    const response = await get(listSearch);

    expect(response.status).toBe(200);
    expect((await sheetOf(response)).rows).toHaveLength(7);
    consoleError.mockRestore();
  });
});
