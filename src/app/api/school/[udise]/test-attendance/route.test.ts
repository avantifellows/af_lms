import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The read route through the real gate and permission layer: only the session
// and the Postgres `query()` boundary are stubbed, so the matrix, read_only,
// the PMU pin (ADR 0007), School scope and the roster loader run as in
// production.
const { mockQuery, mockGetServerSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { GET } from "./route";

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

async function get() {
  return GET(new NextRequest("http://localhost/api/school/JNV001/test-attendance"), {
    params: Promise.resolve({ udise: "JNV001" }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T08:30:00.000Z"));
  school = jnvSchool;
  roster = mixedRoster;
  permissionRow = row("pmu_govt_school_user");
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM school WHERE")) return school ? [school] : [];
    if (sql.includes("program_dropout_audits")) return roster;
    return [];
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function expectNoRosterRead() {
  const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
  expect(sqls.filter(isRosterRead)).toEqual([]);
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
        { userId: "10", name: "Nisha Rao", studentId: "NVS001", grade: 11, examPreparingFor: "Engineering" },
        { userId: "12", name: "Ravi Das", studentId: "NVS003", grade: 11, examPreparingFor: null },
        { userId: "14", name: "Maya Iyer", studentId: "NVS002", grade: 12, examPreparingFor: "Medical" },
      ],
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
