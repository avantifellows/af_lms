import { describe, expect, it, vi } from "vitest";

import {
  formatCheckReport,
  runTestAttendanceCheck,
  type CheckReport,
  type CheckSources,
} from "./test-attendance-check";
import type {
  PaperWindow,
  TestAttendanceResponse,
  TestAttendanceStudent,
  TestSet,
} from "@/types/test-attendance";

// 20 Nov 2026, 12:00 IST. October (two Papers) has closed; November is running.
const NOW = new Date("2026-11-20T06:30:00.000Z");

const TEST_SETS: TestSet[] = [
  { label: "October", quizIds: ["oct-g11", "oct-g12"] },
  { label: "November", quizIds: ["nov-g11"] },
];

const PAPERS: PaperWindow[] = [
  { quizId: "oct-g11", opensAt: "2026-10-10T03:30:00.000Z", closesAt: "2026-10-12T18:25:00.000Z", grade: 11, switchedOn: true },
  { quizId: "oct-g12", opensAt: "2026-10-10T03:30:00.000Z", closesAt: "2026-10-12T18:25:00.000Z", grade: 12, switchedOn: true },
  { quizId: "nov-g11", opensAt: "2026-11-19T03:30:00.000Z", closesAt: "2026-11-21T18:25:00.000Z", grade: 11, switchedOn: true },
];

const OCTOBER = {
  key: "october",
  name: "October",
  shortName: "Oct",
  opensAt: "2026-10-10T03:30:00.000Z",
  closesAt: "2026-10-12T18:25:00.000Z",
  state: "closed" as const,
  grades: [11, 12],
};

function student(userId: string, attendance: TestAttendanceStudent["attendance"]): TestAttendanceStudent {
  return { userId, name: `Student ${userId}`, studentId: null, grade: 11, examPreparingFor: "Engineering", attendance };
}

function response(students: TestAttendanceStudent[]): TestAttendanceResponse {
  return { monthlyTests: [OCTOBER], students, lastRefreshed: null, serverTime: NOW.toISOString() };
}

type Diagnostics = Awaited<ReturnType<CheckSources["school"]>>["diagnostics"];

/**
 * Sources with the given tab answer and warehouse results. A School's tab
 * data and its listing diagnostics are given apart here and arrive together,
 * as the real source reads them, from one `school` call.
 */
function sources({
  schoolAttendance,
  schoolListing = async () => [],
  ...overrides
}: Partial<Omit<CheckSources, "school">> & {
  schoolAttendance: (schoolId: string, now: Date) => Promise<TestAttendanceResponse>;
  schoolListing?: (schoolId: string) => Promise<Diagnostics>;
  submittedResults: CheckSources["submittedResults"];
}): CheckSources {
  return {
    nvsSchools: async () => [{ id: "1", code: "70001" }],
    testSets: async () => TEST_SETS,
    paperWindows: async () => PAPERS,
    school: async (schoolId, now) => {
      const [data, diagnostics] = await Promise.all([schoolAttendance(schoolId, now), schoolListing(schoolId)]);
      return { data, diagnostics };
    },
    ...overrides,
  };
}

describe("runTestAttendanceCheck: Submitted on the tab vs submitted results", () => {
  it("lists a Student Submitted on the tab with no submitted result", async () => {
    const report = await runTestAttendanceCheck(
      sources({
        schoolAttendance: async () => response([student("101", { october: "submitted" })]),
        submittedResults: async () => [],
      }),
      NOW,
    );

    expect(report.monthlyTests).toEqual([
      expect.objectContaining({
        key: "october",
        name: "October",
        submittedWithoutResult: ["101"],
        resultWithoutSubmitted: [],
      }),
    ]);
  });

  it("lists a Student with a submitted result the tab does not call Submitted, on a Paper of another grade too", async () => {
    const report = await runTestAttendanceCheck(
      sources({
        schoolAttendance: async () =>
          response([student("102", { october: "opened" }), student("105", { october: "not_opened" })]),
        submittedResults: async () => [{ userId: "102", quizId: "oct-g12" }],
      }),
      NOW,
    );

    expect(report.monthlyTests[0].submittedWithoutResult).toEqual([]);
    expect(report.monthlyTests[0].resultWithoutSubmitted).toEqual(["102"]);
  });

  it("counts matches, and leaves out results from Students the tab does not count for the Monthly Test", async () => {
    const report = await runTestAttendanceCheck(
      sources({
        schoolAttendance: async () =>
          response([
            student("101", { october: "submitted" }),
            student("102", { october: "opened" }),
            student("103", { october: "submitted" }),
            // Joined after October closed: not counted for October.
            student("104", {}),
            student("105", { october: "not_opened" }),
          ]),
        submittedResults: async () => [
          { userId: "102", quizId: "oct-g11" },
          { userId: "103", quizId: "oct-g11" },
          { userId: "103", quizId: "oct-g12" },
          { userId: "104", quizId: "oct-g11" },
          // Not on any NVS School's list.
          { userId: "999", quizId: "oct-g12" },
        ],
      }),
      NOW,
    );

    expect(report.monthlyTests).toEqual([
      {
        key: "october",
        name: "October",
        counted: 4,
        tabSubmitted: 2,
        withResult: 2,
        matched: 1,
        submittedWithoutResult: ["101"],
        resultWithoutSubmitted: ["102"],
        resultsNotCounted: 2,
      },
    ]);
  });
});

describe("runTestAttendanceCheck: a source that cannot be read fails the run", () => {
  const okAttendance = async () => response([student("101", { october: "submitted" })]);

  it("fails when the results table cannot be read", async () => {
    const run = runTestAttendanceCheck(
      sources({
        schoolAttendance: okAttendance,
        submittedResults: async () => {
          throw new Error("Access Denied: fact_student_test_results_overall");
        },
      }),
      NOW,
    );
    await expect(run).rejects.toThrow("Access Denied: fact_student_test_results_overall");
  });

  it("fails when the tab's loader fails for any School", async () => {
    const run = runTestAttendanceCheck(
      sources({
        nvsSchools: async () => [
          { id: "1", code: "70001" },
          { id: "2", code: "70002" },
        ],
        schoolAttendance: async (schoolId) => {
          if (schoolId === "2") throw new Error("Unrecognized name: has_submitted");
          return response([student("101", { october: "submitted" })]);
        },
        submittedResults: async () => [],
      }),
      NOW,
    );
    await expect(run).rejects.toThrow("Unrecognized name: has_submitted");
  });

  it("fails when the PMU test set list is unavailable", async () => {
    const run = runTestAttendanceCheck(
      sources({
        testSets: async () => {
          throw new Error("PMU test set list unavailable");
        },
        schoolAttendance: okAttendance,
        submittedResults: async () => [],
      }),
      NOW,
    );
    await expect(run).rejects.toThrow("PMU test set list unavailable");
  });

  it("fails when the Student listing cannot be read", async () => {
    const run = runTestAttendanceCheck(
      sources({
        schoolAttendance: okAttendance,
        schoolListing: async () => {
          throw new Error("connection refused");
        },
        submittedResults: async () => [],
      }),
      NOW,
    );
    await expect(run).rejects.toThrow("connection refused");
  });

  it("fails when no NVS School is found, rather than reporting no differences", async () => {
    const run = runTestAttendanceCheck(
      sources({ nvsSchools: async () => [], schoolAttendance: okAttendance, submittedResults: async () => [] }),
      NOW,
    );
    await expect(run).rejects.toThrow("No NVS (JNV) Schools found");
  });
});

describe("runTestAttendanceCheck: reading the Schools", () => {
  const nineSchools = async () => Array.from({ length: 9 }, (_, i) => ({ id: String(i + 1), code: `7000${i + 1}` }));

  it("reads each School once, for both the comparison and the listing checks", async () => {
    const school = vi.fn(async (schoolId: string) => ({
      data: response([student(`${schoolId}01`, { october: "submitted" })]),
      diagnostics: [{ userId: `${schoolId}01`, rawExamPreparingFor: "Commerce", hasJoiningDate: false }],
    }));

    const report = await runTestAttendanceCheck(
      { ...sources({ schoolAttendance: async () => response([]), submittedResults: async () => [] }), nvsSchools: nineSchools, school },
      NOW,
    );

    expect(school).toHaveBeenCalledTimes(9);
    expect(school.mock.calls.map(([schoolId]) => schoolId)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(report.listedStudents).toBe(9);
    expect(report.monthlyTests[0].counted).toBe(9);
    expect(report.noJoiningDate).toBe(9);
    expect(report.examPreparingFor.unrecognised).toBe(9);
  });

  it("starts no more Schools after one fails, and fails the run", async () => {
    const school = vi.fn(async (schoolId: string) => {
      if (schoolId === "2") throw new Error("Unrecognized name: has_submitted");
      return { data: response([]), diagnostics: [] };
    });

    const run = runTestAttendanceCheck(
      { ...sources({ schoolAttendance: async () => response([]), submittedResults: async () => [] }), nvsSchools: nineSchools, school },
      NOW,
    );

    await expect(run).rejects.toThrow("Unrecognized name: has_submitted");
    expect(school.mock.calls.map(([schoolId]) => schoolId)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("runTestAttendanceCheck: listed Students", () => {
  it("counts listed Students with an unrecognised Exam Preparing For value and with no joining date", async () => {
    const report = await runTestAttendanceCheck(
      sources({
        nvsSchools: async () => [
          { id: "1", code: "70001" },
          { id: "2", code: "70002" },
        ],
        schoolAttendance: async () => response([]),
        schoolListing: async (schoolId: string) =>
          schoolId === "1"
            ? [
                { userId: "101", rawExamPreparingFor: "Engineering", hasJoiningDate: true },
                { userId: "102", rawExamPreparingFor: " engineering ", hasJoiningDate: true },
                { userId: "103", rawExamPreparingFor: "Commerce", hasJoiningDate: false },
                { userId: "104", rawExamPreparingFor: null, hasJoiningDate: false },
              ]
            : [
                { userId: "201", rawExamPreparingFor: "Commerce", hasJoiningDate: true },
                { userId: "202", rawExamPreparingFor: "Arts", hasJoiningDate: true },
                { userId: "203", rawExamPreparingFor: "  ", hasJoiningDate: true },
              ],
        submittedResults: async () => [],
      }),
      NOW,
    );

    expect(report.schools).toBe(2);
    expect(report.listedStudents).toBe(7);
    // Blank is "Not set", not unrecognised.
    expect(report.examPreparingFor).toEqual({
      unrecognised: 3,
      values: [
        { value: "Commerce", count: 2 },
        { value: "Arts", count: 1 },
      ],
    });
    expect(report.noJoiningDate).toBe(2);
  });
});

describe("runTestAttendanceCheck: session rows of the listed Papers", () => {
  it("lists every quiz id with no session row, no grade or a missing time, and the switched-off ones", async () => {
    const report = await runTestAttendanceCheck(
      sources({
        testSets: async () => [
          { label: "August", quizIds: ["aug-g11", "aug-g12"] },
          { label: "September", quizIds: ["sep-g11", "sep-g12", "sep-x"] },
        ],
        paperWindows: async () => [
          { quizId: "aug-g11", opensAt: "2026-08-10T03:30:00.000Z", closesAt: "2026-08-12T18:25:00.000Z", grade: 11, switchedOn: false },
          { quizId: "aug-g12", opensAt: "2026-08-10T03:30:00.000Z", closesAt: "2026-08-12T18:25:00.000Z", grade: 12, switchedOn: true },
          { quizId: "sep-g11", opensAt: "2026-09-10T03:30:00.000Z", closesAt: "2026-09-12T18:25:00.000Z", grade: null, switchedOn: true },
          { quizId: "sep-g12", opensAt: null, closesAt: null, grade: 12, switchedOn: true },
        ],
        schoolAttendance: async () => response([]),
        submittedResults: async () => [],
      }),
      NOW,
    );

    expect(report.papers).toEqual({
      quizIds: 5,
      incomplete: [
        { quizId: "sep-g11", testSet: "September", missing: ["grade"] },
        { quizId: "sep-g12", testSet: "September", missing: ["opening time", "closing time"] },
        { quizId: "sep-x", testSet: "September", missing: ["session row"] },
      ],
      switchedOff: [{ quizId: "aug-g11", testSet: "August" }],
    });
  });
});

describe("formatCheckReport", () => {
  const report: CheckReport = {
    checkedAt: "2026-11-20T06:30:00.000Z",
    schools: 2,
    listedStudents: 7,
    monthlyTests: [
      {
        key: "september",
        name: "September",
        counted: 3,
        tabSubmitted: 2,
        withResult: 2,
        matched: 2,
        submittedWithoutResult: [],
        resultWithoutSubmitted: [],
        resultsNotCounted: 0,
      },
      {
        key: "october",
        name: "October",
        counted: 4,
        tabSubmitted: 3,
        withResult: 2,
        matched: 1,
        submittedWithoutResult: ["101", "107"],
        resultWithoutSubmitted: ["102"],
        resultsNotCounted: 2,
      },
    ],
    examPreparingFor: { unrecognised: 3, values: [{ value: "Commerce", count: 2 }, { value: "Arts", count: 1 }] },
    noJoiningDate: 2,
    papers: {
      quizIds: 5,
      incomplete: [{ quizId: "sep-g12", testSet: "September", missing: ["opening time", "closing time"] }],
      switchedOff: [{ quizId: "aug-g11", testSet: "August" }],
    },
  };

  it("prints both difference lists with their counts per closed Monthly Test, and the listing and session checks", () => {
    expect(formatCheckReport(report)).toBe(
      [
        "Test Attendance pre-launch check, 2026-11-20 12:00 IST",
        "NVS Schools: 2 · listed Students: 7",
        "",
        "September (closed)",
        "  Counted 3 · Submitted on the tab 2 · with a submitted result 2 · both 2",
        "  Submitted on the tab, no submitted result (0): none",
        "  Submitted result, not Submitted on the tab (0): none",
        "  Submitted results from Students the tab does not count (not compared): 0",
        "",
        "October (closed)",
        "  Counted 4 · Submitted on the tab 3 · with a submitted result 2 · both 1",
        "  Submitted on the tab, no submitted result (2): 101, 107",
        "  Submitted result, not Submitted on the tab (1): 102",
        "  Submitted results from Students the tab does not count (not compared): 2",
        "",
        "Exam Preparing For: 3 listed Students have an unrecognised value (shown as Not set): Commerce 2, Arts 1",
        "No joining date: 2 listed Students (counted for every Monthly Test of their grade)",
        "",
        "session rows: 5 quiz ids in the test set list",
        "  Missing a session row, grade or time (1):",
        "    sep-g12 (September): opening time, closing time",
        "  Switched off, skipped by the tab (1): aug-g11 (August)",
        "",
      ].join("\n"),
    );
  });

  it("says so when nothing is missing and no Monthly Test has closed", () => {
    const clean: CheckReport = {
      ...report,
      monthlyTests: [],
      examPreparingFor: { unrecognised: 0, values: [] },
      noJoiningDate: 0,
      papers: { quizIds: 5, incomplete: [], switchedOff: [] },
    };
    expect(formatCheckReport(clean)).toBe(
      [
        "Test Attendance pre-launch check, 2026-11-20 12:00 IST",
        "NVS Schools: 2 · listed Students: 7",
        "",
        "No Monthly Test has closed yet: nothing to compare.",
        "",
        "Exam Preparing For: 0 listed Students have an unrecognised value (shown as Not set)",
        "No joining date: 0 listed Students (counted for every Monthly Test of their grade)",
        "",
        "session rows: 5 quiz ids in the test set list",
        "  Every one has a session row with a grade and both times.",
        "  Switched off, skipped by the tab (0): none",
        "",
      ].join("\n"),
    );
  });
});
