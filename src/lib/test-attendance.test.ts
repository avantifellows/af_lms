import { beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_ACADEMIC_YEAR, PMU_PROGRAM_ID } from "@/lib/constants";
import type { PaperWindow } from "@/types/test-attendance";

// The loader with each source stubbed at its module edge: the roster, the
// joining-date read (`query()`), the NVS Monthly Tests (`getNvsTestSets`),
// the Paper windows and the warehouse attendance read.
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSchoolRoster: vi.fn(),
  getNvsTestSets: vi.fn(),
  readPaperWindows: vi.fn(),
  readSchoolAttendance: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/school-students", () => ({ getSchoolRoster: mocks.getSchoolRoster }));
vi.mock("@/lib/test-set-list", () => ({ getNvsTestSets: mocks.getNvsTestSets }));
vi.mock("@/lib/test-attendance-papers", () => ({ readPaperWindows: mocks.readPaperWindows }));
vi.mock("@/lib/test-attendance-warehouse", () => ({ readSchoolAttendance: mocks.readSchoolAttendance }));

import { loadSchoolTestAttendance, loadTestAttendance, readNvsJoiningDates } from "./test-attendance";

// 18 Nov 2026, 2:00 pm IST. October closed on 10 Oct at 11:55 pm IST; November is running.
const NOW = new Date("2026-11-18T08:30:00.000Z");

const rosterRow = (overrides: Record<string, unknown>) => ({
  user_id: "10",
  first_name: "Nisha",
  last_name: "Rao",
  student_id: "NVS001",
  apaar_id: "123456789012",
  grade: 11,
  stream: "Engineering",
  status: "enrolled",
  program_id: 64,
  student_program_ids: [64],
  ...overrides,
});

const ROSTER = [
  rosterRow({ user_id: "10", first_name: "Nisha", apaar_id: " 123456789012 ", stream: "engineering" }),
  rosterRow({ user_id: "11", first_name: "Ravi", last_name: null, student_id: null, apaar_id: "   ", grade: 12, stream: "Commerce" }),
  // Not listed: a CoE Student, an NVS dropout and a Grade 13 NVS Student.
  rosterRow({ user_id: "12", first_name: "Chetan", program_id: 1, student_program_ids: [1] }),
  rosterRow({ user_id: "13", first_name: "Deepa", status: "dropout" }),
  rosterRow({ user_id: "14", first_name: "Gita", grade: 13 }),
];

const window = (quizId: string, grade: number, opensAt: string, closesAt: string): PaperWindow => ({
  quizId,
  opensAt,
  closesAt,
  grade,
  switchedOn: true,
});

const PAPERS = [
  window("oct-g11", 11, "2026-10-05T23:30:00.000Z", "2026-10-10T18:25:00.000Z"),
  window("oct-g12", 12, "2026-10-05T23:30:00.000Z", "2026-10-10T18:25:00.000Z"),
  window("nov-g11", 11, "2026-11-16T23:30:00.000Z", "2026-11-21T18:25:00.000Z"),
  // December has not opened: its Paper's attendance is never asked for.
  window("dec-g11", 11, "2026-12-14T23:30:00.000Z", "2026-12-19T18:25:00.000Z"),
];

const isJoiningRead = (sql: string) => sql.includes("enrollment_record");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSchoolRoster.mockResolvedValue({ students: ROSTER, issues: [] });
  mocks.getNvsTestSets.mockResolvedValue([
    { label: "October", quizIds: ["oct-g11", "oct-g12"] },
    { label: "November", quizIds: ["nov-g11"] },
    { label: "December", quizIds: ["dec-g11"] },
  ]);
  mocks.readPaperWindows.mockResolvedValue(PAPERS);
  mocks.query.mockImplementation(async (sql: string) =>
    isJoiningRead(sql) ? [{ user_id: "11", start_date: "2026-10-20" }] : [],
  );
  mocks.readSchoolAttendance.mockResolvedValue({
    attendance: [
      { userId: "10", quizId: "oct-g11", submitted: true },
      { userId: "10", quizId: "nov-g11", submitted: null },
    ],
    lastRefreshed: "2026-11-18T08:00:00.000Z",
  });
});

describe("loadTestAttendance", () => {
  it("sends only the listed Students, each with nothing but the tab's fields and their marks", async () => {
    const data = await loadTestAttendance("7", NOW);

    expect(Object.keys(data).sort()).toEqual(["lastRefreshed", "monthlyTests", "serverTime", "students"]);
    expect(data.monthlyTests.map((test) => [test.key, test.state])).toEqual([
      ["october", "closed"],
      ["november", "running"],
    ]);
    expect(data.students).toEqual([
      {
        userId: "10",
        name: "Nisha Rao",
        studentId: "NVS001",
        apaarId: "123456789012",
        grade: 11,
        examPreparingFor: "Engineering",
        attendance: { october: "submitted", november: "opened" },
      },
      // Joined NVS on 20 Oct, after October closed: counted for no Monthly
      // Test of Grade 12 (November has no Grade 12 Paper).
      { userId: "11", name: "Ravi", studentId: null, apaarId: null, grade: 12, examPreparingFor: null, attendance: {} },
    ]);
    expect(data.lastRefreshed).toBe("2026-11-18T08:00:00.000Z");
    expect(data.serverTime).toBe(NOW.toISOString());
  });

  it("trims APAAR IDs and maps empty or missing values to null", async () => {
    mocks.getSchoolRoster.mockResolvedValue({
      students: [
        rosterRow({ user_id: "20", apaar_id: " 987654321098 " }),
        rosterRow({ user_id: "21", apaar_id: "" }),
        rosterRow({ user_id: "22", apaar_id: "   " }),
        rosterRow({ user_id: "23", apaar_id: null }),
      ],
      issues: [],
    });

    const data = await loadTestAttendance("7", NOW);

    expect(data.students.map((student) => [student.userId, student.apaarId])).toEqual([
      ["20", "987654321098"],
      ["21", null],
      ["22", null],
      ["23", null],
    ]);
  });

  it("asks the warehouse only about the listed Students and the opened Monthly Tests' Papers", async () => {
    await loadTestAttendance("7", NOW);

    expect(mocks.readSchoolAttendance).toHaveBeenCalledWith("7", ["oct-g11", "oct-g12", "nov-g11"], ["10", "11"]);
    expect(mocks.readPaperWindows).toHaveBeenCalledWith(["oct-g11", "oct-g12", "nov-g11", "dec-g11"]);
  });

  it.each([
    ["the Monthly Tests read", () => mocks.getNvsTestSets.mockRejectedValue(new Error("connection terminated unexpectedly"))],
    ["the session read", () => mocks.readPaperWindows.mockRejectedValue(new Error("statement timeout"))],
    ["the roster read", () => mocks.getSchoolRoster.mockRejectedValue(new Error("connection refused"))],
    ["the joining-date read", () => mocks.query.mockRejectedValue(new Error("canceling statement"))],
    ["the attendance read", () => mocks.readSchoolAttendance.mockRejectedValue(new Error("Unrecognized name: has_submitted"))],
  ])("throws when %s fails, never answering with zeros", async (_source, fail) => {
    fail();

    await expect(loadTestAttendance("7", NOW)).rejects.toThrow();
  });
});

describe("loadSchoolTestAttendance", () => {
  it("reads the roster and joining dates once for the tab's data and the listing diagnostics", async () => {
    const { data, diagnostics } = await loadSchoolTestAttendance("7", NOW);

    expect(mocks.getSchoolRoster).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls.filter(([sql]) => isJoiningRead(sql))).toHaveLength(1);
    expect(data.students.map((student) => student.userId)).toEqual(["10", "11"]);
    expect(diagnostics).toEqual([
      { userId: "10", rawExamPreparingFor: "engineering", hasJoiningDate: false },
      { userId: "11", rawExamPreparingFor: "Commerce", hasJoiningDate: true },
    ]);
  });
});

describe("readNvsJoiningDates", () => {
  it("asks nothing when there are no Students", async () => {
    expect(await readNvsJoiningDates([])).toEqual(new Map());
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("takes each Student's earliest dated current-year NVS batch enrollment, in SQL, with parameters", async () => {
    mocks.query.mockResolvedValue([
      { user_id: 10, start_date: "2026-06-10" },
      { user_id: "11", start_date: "2026-10-20" },
    ]);

    expect(await readNvsJoiningDates(["10", "11", "12"])).toEqual(
      new Map([
        ["10", "2026-06-10"],
        ["11", "2026-10-20"],
      ]),
    );
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toMatch(/MIN\(er\.start_date\)/);
    expect(sql).toMatch(/GROUP BY er\.user_id/);
    expect(sql).toContain("er.start_date IS NOT NULL");
    expect(params).toEqual([["10", "11", "12"], CURRENT_ACADEMIC_YEAR, PMU_PROGRAM_ID]);
  });
});
