import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The read route through the real gate and permission layer: only the session,
// the Postgres `query()` boundary, the PMU test set list (Firestore) and the
// BigQuery client are stubbed, so the matrix, read_only, the PMU pin (ADR 0007),
// School scope, the roster loader, the Paper windows read, the attendance read
// and the rules run as in production.
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

// The route keeps warehouse reads in an in-process cache, so each test loads a
// fresh copy of it.
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
  group_user_id: "gu-1",
  user_id: "10",
  student_pk_id: "100",
  first_name: "Nisha",
  last_name: "Rao",
  phone: "9876543210",
  student_id: "NVS001",
  grade: 11,
  stream: "Engineering",
  status: "enrolled",
  program_id: 64,
  program_name: "JNV NVS",
  student_program_ids: [64],
  dropout_program_ids: [],
  ...overrides,
});

// A mixed JNV School: NVS Students alongside CoE, Nodal, unassigned, NVS
// dropouts and a Grade 13 NVS Student. Rows in the roster's grade/name order.
const mixedRoster = [
  rosterRow({ group_user_id: "gu-1", user_id: "10", first_name: "Nisha", last_name: "Rao", student_id: "NVS001", grade: 11, stream: "engineering" }),
  rosterRow({ group_user_id: "gu-2", user_id: "11", first_name: "Chetan", last_name: "Coe", student_id: "COE001", grade: 11, program_id: 1, program_name: "JNV CoE", student_program_ids: [1] }),
  rosterRow({ group_user_id: "gu-3", user_id: "12", first_name: "Ravi", last_name: "Das", student_id: "NVS003", grade: 11, stream: "Science" }),
  rosterRow({ group_user_id: "gu-4", user_id: "13", first_name: "Deepa", last_name: "Drop", student_id: "NVS004", grade: 12, status: "dropout", student_program_ids: [], dropout_program_ids: [64] }),
  // Marked dropout while an NVS batch is still current: the Active sheet drops them.
  rosterRow({ group_user_id: "gu-9", user_id: "18", first_name: "Arjun", last_name: "Stale", student_id: "NVS009", grade: 12, status: "dropout", student_program_ids: [64] }),
  rosterRow({ group_user_id: "gu-5", user_id: "14", first_name: "Maya", last_name: "Iyer", student_id: "NVS002", grade: 12, stream: " MEDICAL ", program_id: 1, program_name: "JNV CoE", student_program_ids: [1, 64] }),
  rosterRow({ group_user_id: "gu-6", user_id: "15", first_name: "Neel", last_name: "Nodal", student_id: "NOD001", grade: 12, program_id: 2, program_name: "JNV Nodal", student_program_ids: [2] }),
  rosterRow({ group_user_id: "gu-7", user_id: "16", first_name: "Uma", last_name: "None", student_id: null, grade: 12, stream: null, program_id: null, program_name: null, student_program_ids: [] }),
  rosterRow({ group_user_id: "gu-8", user_id: "17", first_name: "Gita", last_name: "Thirteen", student_id: "NVS013", grade: 13 }),
];

let permissionRow: Record<string, unknown> | null;
let school: Record<string, unknown> | null;
let roster: Record<string, unknown>[];
let sessionRows: Record<string, unknown>[];

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

async function get(udise = "JNV001") {
  return GET(new NextRequest(`http://localhost/api/school/${udise}/test-attendance`), {
    params: Promise.resolve({ udise }),
  });
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  ({ GET } = await import("./route"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T08:30:00.000Z"));
  school = jnvSchool;
  roster = mixedRoster;
  sessionRows = [];
  permissionRow = row("pmu_govt_school_user");
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockGetNvsTestSets.mockResolvedValue([]);
  mockBigQuery.mockResolvedValue([[]]);
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM school WHERE")) return school ? [school] : [];
    if (sql.includes("program_dropout_audits")) return roster;
    if (isSessionRead(sql)) return sessionRows;
    return [];
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function expectNoRosterRead() {
  const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
  expect(sqls.filter(isRosterRead)).toEqual([]);
  expect(sqls.filter(isSessionRead)).toEqual([]);
  expect(mockGetNvsTestSets).not.toHaveBeenCalled();
  expect(mockBigQuery).not.toHaveBeenCalled();
}

describe("GET /api/school/[udise]/test-attendance — gate", () => {
  it("answers 401 when signed out, before any read", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown School", async () => {
    school = null;

    const response = await get();

    expect(response.status).toBe(404);
    expectNoRosterRead();
  });

  it.each([
    ["teacher"],
    ["program_manager"],
    ["program_admin"],
    ["holistic_mentorship_admin"],
    ["alumni_manager"],
  ])("refuses %s with 403 at an in-scope JNV School, without reading the roster", async (role) => {
    permissionRow = row(role);

    const response = await get();

    expect(response.status).toBe(403);
    expectNoRosterRead();
  });

  it.each([
    ["admin", row("admin", { level: 3, school_codes: null })],
    ["pmu_manager", row("pmu_manager", { level: 3, school_codes: null })],
    ["pmu_govt_school_user", row("pmu_govt_school_user")],
  ])("refuses %s with 403 at a non-JNV School", async (_role, permission) => {
    permissionRow = permission;
    school = { ...jnvSchool, af_school_category: "Punjab CoE" };

    const response = await get();

    expect(response.status).toBe(403);
    expectNoRosterRead();
  });

  it("refuses a PMU user outside their Schools with 403", async () => {
    permissionRow = row("pmu_manager", { school_codes: ["JNV999"] });

    const response = await get();

    expect(response.status).toBe(403);
    expectNoRosterRead();
  });
});

describe("GET /api/school/[udise]/test-attendance — success", () => {
  it.each([
    ["admin", row("admin", { level: 3, school_codes: null })],
    ["read_only admin", row("admin", { level: 3, school_codes: null, read_only: true })],
    ["pmu_manager", row("pmu_manager")],
    ["read_only pmu_manager", row("pmu_manager", { read_only: true })],
    ["pmu_govt_school_user", row("pmu_govt_school_user")],
    ["read_only pmu_govt_school_user", row("pmu_govt_school_user", { read_only: true })],
  ])("answers 200 for %s", async (_label, permission) => {
    permissionRow = permission;

    const response = await get();

    expect(response.status).toBe(200);
  });

  it("returns only the listed Students of a mixed School, with no Monthly Tests yet", async () => {
    permissionRow = row("admin", { level: 3, school_codes: null });

    const response = await get();

    expect(await response.json()).toEqual({
      monthlyTests: [],
      students: [
        { userId: "10", name: "Nisha Rao", studentId: "NVS001", grade: 11, examPreparingFor: "Engineering", attendance: {} },
        { userId: "12", name: "Ravi Das", studentId: "NVS003", grade: 11, examPreparingFor: null, attendance: {} },
        { userId: "14", name: "Maya Iyer", studentId: "NVS002", grade: 12, examPreparingFor: "Medical", attendance: {} },
      ],
      lastRefreshed: null,
      serverTime: "2026-11-18T08:30:00.000Z",
    });
  });

  it("answers 200 with an empty student list at a JNV School with no NVS Students", async () => {
    roster = mixedRoster.filter((student) => ["Chetan", "Neel"].includes(String(student.first_name)));

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      monthlyTests: [],
      students: [],
      lastRefreshed: null,
      serverTime: "2026-11-18T08:30:00.000Z",
    });
  });

  it("answers 500 and logs no Student data when the roster read fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM user_permission")) return [permissionRow];
      if (sql.includes("FROM school WHERE")) return [school];
      if (sql.includes("program_dropout_audits")) throw new Error("connection reset");
      return [];
    });

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load Test Attendance" });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("connection reset");
    expect(logged).not.toContain("Nisha");
    consoleError.mockRestore();
  });
});

// `session` rows as Postgres returns them for `start_time::text`: IST wall
// clock. Hand conversions (IST = UTC + 5:30) are written next to each expected
// value below.
const sessionRow = (platform_id: string, start_time: string | null, end_time: string | null, grade: string | null, is_active: boolean | null = true) => ({
  platform_id,
  start_time,
  end_time,
  grade,
  is_active,
});

describe("GET /api/school/[udise]/test-attendance — Monthly Tests", () => {
  beforeEach(() => {
    // Server time 2026-11-18T08:30:00Z = 18 Nov 2026, 2:00 pm IST.
    mockGetNvsTestSets.mockResolvedValue([
      { label: "October", quizIds: ["oct-g11", "oct-g12"] },
      { label: "July", quizIds: ["jul-g12"] },
      { label: "August", quizIds: ["aug-g12-a", "aug-g12-b", "aug-g11"] },
      { label: "November", quizIds: ["nov-g11"] },
      { label: "December", quizIds: ["dec-g12"] },
      { label: "Mock", quizIds: ["no-row"] },
    ]);
    sessionRows = [
      sessionRow("jul-g12", "2026-07-22 05:00:00", "2026-07-28 23:45:00", "12"),
      sessionRow("aug-g12-a", "2026-08-19 05:00:00", "2026-08-24 23:55:00", "12"),
      sessionRow("aug-g12-b", "2026-08-19 05:00:00", "2026-08-24 23:55:00", "12"),
      // Switched off, as August's Grade 11 Papers are in production.
      sessionRow("aug-g11", "2026-08-26 05:00:00", "2026-08-30 23:55:00", "11", false),
      // Three rows for one quiz id: the switched-off one is ignored; the two
      // switched-on ones give the earliest opening and the latest closing.
      sessionRow("oct-g11", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "11"),
      sessionRow("oct-g11", "2026-10-07 05:00:00", "2026-10-12 23:55:00", "11"),
      sessionRow("oct-g11", "2026-10-01 05:00:00", "2026-10-20 23:55:00", "11", false),
      // No opening time: skipped, so October has no Grade 12.
      sessionRow("oct-g12", null, "2026-10-10 23:55:00", "12"),
      sessionRow("nov-g11", "2026-11-17 05:00:00", "2026-11-21 23:55:00", "11"),
      sessionRow("dec-g12", "2026-12-08 05:00:00", "2026-12-12 23:55:00", "12"),
    ];
  });

  it("returns the Monthly Tests that have opened, ordered by closing time, with times in UTC", async () => {
    const response = await get();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.monthlyTests).toEqual([
      {
        key: "july",
        name: "July",
        shortName: "Jul",
        opensAt: "2026-07-21T23:30:00.000Z", // 22 Jul 05:00 IST
        closesAt: "2026-07-28T18:15:00.000Z", // 28 Jul 23:45 IST
        state: "closed",
        grades: [12],
      },
      {
        key: "august",
        name: "August",
        shortName: "Aug",
        opensAt: "2026-08-18T23:30:00.000Z", // 19 Aug 05:00 IST
        closesAt: "2026-08-24T18:25:00.000Z", // 24 Aug 23:55 IST
        state: "closed",
        grades: [12],
      },
      {
        key: "october",
        name: "October",
        shortName: "Oct",
        opensAt: "2026-10-05T23:30:00.000Z", // 6 Oct 05:00 IST
        closesAt: "2026-10-12T18:25:00.000Z", // 12 Oct 23:55 IST
        state: "closed",
        grades: [11],
      },
      {
        key: "november",
        name: "November",
        shortName: "Nov",
        opensAt: "2026-11-16T23:30:00.000Z", // 17 Nov 05:00 IST
        closesAt: "2026-11-21T18:25:00.000Z", // 21 Nov 23:55 IST
        state: "running",
        grades: [11],
      },
    ]);
    expect(body.students).toHaveLength(3);
  });

  it("skips a Paper whose time cannot be read", async () => {
    mockGetNvsTestSets.mockResolvedValue([{ label: "October", quizIds: ["oct-g11", "oct-g12"] }]);
    sessionRows = [
      sessionRow("oct-g11", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "11"),
      sessionRow("oct-g12", "2026-10-01 05:00:00", "not a time", "12"),
    ];

    const response = await get();

    expect((await response.json()).monthlyTests).toEqual([
      expect.objectContaining({ closesAt: "2026-10-10T18:25:00.000Z", grades: [11] }),
    ]);
  });

  it("answers 500 when the PMU test set list is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetNvsTestSets.mockRejectedValue(new Error("Firestore answered 403"));

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load Test Attendance" });
    consoleError.mockRestore();
  });

  it("answers 500 when the session read fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM user_permission")) return [permissionRow];
      if (sql.includes("FROM school WHERE")) return [school];
      if (sql.includes("program_dropout_audits")) return roster;
      if (isSessionRead(sql)) throw new Error("statement timeout");
      return [];
    });

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load Test Attendance" });
    expect(JSON.stringify(consoleError.mock.calls)).toContain("statement timeout");
    consoleError.mockRestore();
  });
});

// Warehouse rows as the attendance read's query returns them: one per Student
// and quiz, `submitted` null when the warehouse does not know.
const bqRow = (user_id: string, quiz_id: string, submitted: boolean | null) => ({ user_id, quiz_id, submitted });

// Server time 2026-11-18T08:30:00Z = 18 Nov 2026, 2:00 pm IST.
// October (closed): Grade 11 Engineering and NDA Papers, a Grade 12 Paper.
// November (running): Grade 11 only.
function useOctoberAndNovember() {
  mockGetNvsTestSets.mockResolvedValue([
    { label: "October", quizIds: ["oct-g11-eng", "oct-g11-nda", "oct-g12"] },
    { label: "November", quizIds: ["nov-g11"] },
  ]);
  sessionRows = [
    sessionRow("oct-g11-eng", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "11"),
    sessionRow("oct-g11-nda", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "11"),
    sessionRow("oct-g12", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "12"),
    sessionRow("nov-g11", "2026-11-17 05:00:00", "2026-11-21 23:55:00", "11"),
  ];
}

describe("GET /api/school/[udise]/test-attendance — attendance", () => {
  beforeEach(useOctoberAndNovember);

  it("returns each listed Student's mark for every Monthly Test they are counted for", async () => {
    mockBigQuery.mockResolvedValue([
      [
        // Nisha (Grade 11): opened both October Papers, submitted the NDA one; opened November.
        bqRow("10", "oct-g11-eng", false),
        bqRow("10", "oct-g11-nda", true),
        bqRow("10", "nov-g11", null),
        // Ravi (Grade 11): sat October on the Grade 12 Paper; nothing in November.
        bqRow("12", "oct-g12", true),
        // Maya (Grade 12): opened October without submitting.
        bqRow("14", "oct-g12", false),
      ],
    ]);

    const response = await get();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.students.map((s: { userId: string; attendance: unknown }) => [s.userId, s.attendance])).toEqual([
      ["10", { october: "submitted", november: "opened" }],
      ["12", { october: "submitted", november: "not_opened" }],
      // Grade 12 has no Paper in November: no mark for it.
      ["14", { october: "opened" }],
    ]);
  });

  it("returns only listed Students, whatever the warehouse holds for others", async () => {
    mockBigQuery.mockResolvedValue([
      [
        // Chetan (CoE), Deepa (NVS dropout) and Gita (Grade 13) sat October.
        bqRow("11", "oct-g11-eng", true),
        bqRow("13", "oct-g12", true),
        bqRow("17", "oct-g12", true),
      ],
    ]);

    const response = await get();

    const body = await response.json();
    expect(body.students.map((s: { userId: string }) => s.userId)).toEqual(["10", "12", "14"]);
    expect(JSON.stringify(body)).not.toMatch(/Chetan|Deepa|Gita|COE001|NVS004|NVS013/);
  });

  it("asks the warehouse only about the listed Students and the opened Monthly Tests' Papers", async () => {
    await get();

    const attendanceReads = mockBigQuery.mock.calls.filter(([options]) => options.params.userIds);
    expect(attendanceReads).toHaveLength(1);
    const params = attendanceReads[0][0].params;
    expect([...params.userIds].sort()).toEqual(["10", "12", "14"]);
    expect([...params.quizIds].sort()).toEqual(["nov-g11", "oct-g11-eng", "oct-g11-nda", "oct-g12"]);
  });

  it("answers 500 and logs no Student data when the attendance read fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockBigQuery.mockRejectedValue(new Error("Access Denied: Table fact_student_test_attendance"));

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load Test Attendance" });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("Access Denied");
    expect(logged).not.toContain("Nisha");
    consoleError.mockRestore();
  });
});

// The warehouse stub: the attendance table's last-modified time comes from the
// dataset's table metadata; any other query is the attendance read.
const isLastRefreshedRead = (sql: string) => sql.includes("__TABLES__");
const warehouseCalls = (read: (sql: string) => boolean) =>
  mockBigQuery.mock.calls.filter(([options]) => read(String(options.query))).length;
const isAttendanceRead = (sql: string) => !isLastRefreshedRead(sql);

describe("GET /api/school/[udise]/test-attendance — last refreshed", () => {
  beforeEach(useOctoberAndNovember);

  it("returns when the attendance table was last rebuilt, with the server time the response was built", async () => {
    mockBigQuery.mockImplementation(async (options: { query: string }) =>
      isLastRefreshedRead(options.query) ? [[{ last_refreshed: "2026-11-18T08:15:42.000Z" }]] : [[]],
    );

    const response = await get();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lastRefreshed).toBe("2026-11-18T08:15:42.000Z");
    expect(body.serverTime).toBe("2026-11-18T08:30:00.000Z");
  });

  it("still returns the data, with the time unknown, when the last-refreshed lookup fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockBigQuery.mockImplementation(async (options: { query: string }) => {
      if (isLastRefreshedRead(options.query)) throw new Error("Access Denied: __TABLES__");
      return [[bqRow("10", "nov-g11", true)]];
    });

    const response = await get();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lastRefreshed).toBeNull();
    expect(body.students[0]).toMatchObject({ userId: "10", attendance: { october: "not_opened", november: "submitted" } });
    consoleError.mockRestore();
  });

  it("marks the time unknown when the table metadata has no row for the attendance table", async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect((await response.json()).lastRefreshed).toBeNull();
  });
});

describe("GET /api/school/[udise]/test-attendance — 60-second warehouse cache", () => {
  beforeEach(() => {
    useOctoberAndNovember();
    mockBigQuery.mockImplementation(async (options: { query: string }) =>
      isLastRefreshedRead(options.query)
        ? [[{ last_refreshed: "2026-11-18T08:15:42.000Z" }]]
        : [[bqRow("10", "nov-g11", true)]],
    );
  });

  it("reads the warehouse once for two requests for one School inside 60 seconds", async () => {
    await get();
    vi.setSystemTime(new Date("2026-11-18T08:30:59.000Z"));

    const response = await get();

    expect(warehouseCalls(isAttendanceRead)).toBe(1);
    expect(warehouseCalls(isLastRefreshedRead)).toBe(1);
    const body = await response.json();
    expect(body.lastRefreshed).toBe("2026-11-18T08:15:42.000Z");
    expect(body.students[0].attendance).toEqual({ october: "not_opened", november: "submitted" });
    // The server time is still the time this response was built.
    expect(body.serverTime).toBe("2026-11-18T08:30:59.000Z");
  });

  it("reads the warehouse again for a request 60 seconds later", async () => {
    await get();
    vi.setSystemTime(new Date("2026-11-18T08:31:00.000Z"));

    await get();

    expect(warehouseCalls(isAttendanceRead)).toBe(2);
    expect(warehouseCalls(isLastRefreshedRead)).toBe(2);
  });

  it("reads the warehouse again for another School", async () => {
    permissionRow = row("pmu_manager", { school_codes: ["JNV001", "JNV002"] });
    await get();
    school = { ...jnvSchool, id: "10", code: "JNV002" };

    await get("JNV002");

    expect(warehouseCalls(isAttendanceRead)).toBe(2);
  });

  it("does not keep a failed attendance read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementationOnce(() => {});
    mockBigQuery.mockImplementationOnce(async () => {
      throw new Error("Access Denied: Table fact_student_test_attendance");
    });
    const first = await get();
    expect(first.status).toBe(500);

    const second = await get();

    expect(second.status).toBe(200);
    expect((await second.json()).students[0].attendance).toEqual({ october: "not_opened", november: "submitted" });
    consoleError.mockRestore();
  });
});

// NVS batch enrollment rows of the current academic year, current or ended,
// `start_date` as YYYY-MM-DD. The joining-date read takes the earliest per
// Student in SQL (MIN … GROUP BY); the stub below does the same.
const enrollmentRow = (user_id: string, start_date: string | null, is_current: boolean) => ({
  user_id,
  start_date,
  is_current,
});
const isJoiningRead = (sql: string) => sql.includes("start_date");

describe("GET /api/school/[udise]/test-attendance — joining dates", () => {
  let enrollmentRows: ReturnType<typeof enrollmentRow>[];

  beforeEach(() => {
    // Server time 2026-11-18T08:30:00Z = 18 Nov 2026, 2:00 pm IST.
    // October closed on 10 Oct at 11:55 pm IST; November is running. Both have Grade 11 and 12 Papers.
    mockGetNvsTestSets.mockResolvedValue([
      { label: "October", quizIds: ["oct-g11", "oct-g12"] },
      { label: "November", quizIds: ["nov-g11", "nov-g12"] },
    ]);
    sessionRows = [
      sessionRow("oct-g11", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "11"),
      sessionRow("oct-g12", "2026-10-06 05:00:00", "2026-10-10 23:55:00", "12"),
      sessionRow("nov-g11", "2026-11-17 05:00:00", "2026-11-21 23:55:00", "11"),
      sessionRow("nov-g12", "2026-11-17 05:00:00", "2026-11-21 23:55:00", "12"),
    ];
    enrollmentRows = [];
    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
      if (sql.includes("FROM school WHERE")) return school ? [school] : [];
      if (sql.includes("program_dropout_audits")) return roster;
      if (isSessionRead(sql)) return sessionRows;
      if (isJoiningRead(sql)) {
        const asked = (params[0] as unknown[]).map(String);
        const earliest = new Map<string, string>();
        for (const r of enrollmentRows) {
          if (!asked.includes(r.user_id) || r.start_date == null) continue;
          const seen = earliest.get(r.user_id);
          if (seen == null || r.start_date < seen) earliest.set(r.user_id, r.start_date);
        }
        return [...earliest].map(([user_id, start_date]) => ({ user_id, start_date }));
      }
      return [];
    });
  });

  it("counts a Student from their earliest NVS batch enrollment and leaves out tests that closed before they joined", async () => {
    enrollmentRows = [
      // Nisha: an ended NVS batch from June, then a current one from 20 Oct. June decides.
      enrollmentRow("10", "2026-10-20", true),
      enrollmentRow("10", "2026-06-10", false),
      // Ravi joined NVS on 20 Oct, after October closed.
      enrollmentRow("12", "2026-10-20", true),
      // Maya has no dated enrollment: counted for every Monthly Test of her grade.
    ];

    const response = await get();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.students.map((s: { userId: string; attendance: unknown }) => [s.userId, s.attendance])).toEqual([
      ["10", { october: "not_opened", november: "not_opened" }],
      ["12", { november: "not_opened" }],
      ["14", { october: "not_opened", november: "not_opened" }],
    ]);
  });

  it("answers 500 and logs no Student data when the joining-date read fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM user_permission")) return [permissionRow];
      if (sql.includes("FROM school WHERE")) return [school];
      if (sql.includes("program_dropout_audits")) return roster;
      if (isSessionRead(sql)) return sessionRows;
      if (isJoiningRead(sql)) throw new Error("canceling statement due to statement timeout");
      return [];
    });

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load Test Attendance" });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("statement timeout");
    expect(logged).not.toContain("Nisha");
    consoleError.mockRestore();
  });
});
