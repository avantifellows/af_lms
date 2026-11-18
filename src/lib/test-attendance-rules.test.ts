import { describe, expect, it } from "vitest";

import {
  attendanceStatus,
  examPreparingFor,
  monthStudents,
  monthTiles,
  monthlyTestsFrom,
  percentText,
  testAttendanceFrom,
  type ListedStudent,
  type PaperAttendance,
  type PaperWindow,
  type TestAttendanceStudent,
} from "./test-attendance-rules";

describe("examPreparingFor", () => {
  it.each([
    ["Engineering", "Engineering"],
    ["engineering", "Engineering"],
    ["  MEDICAL ", "Medical"],
    ["clat", "CLAT"],
    ["Ca", "CA"],
    ["nda", "NDA"],
  ])("matches %j without regard to case as %s", (raw, expected) => {
    expect(examPreparingFor(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [""], ["   "], ["Science"], ["JEE"], ["Engineering and NDA"]])(
    "treats %j as none",
    (raw) => {
      expect(examPreparingFor(raw)).toBeNull();
    },
  );
});

// Times below are written as IST wall clock and converted by hand:
// 2026-10-06 05:00 IST = 2026-10-05T23:30:00Z; 2026-10-10 23:55 IST = 2026-10-10T18:25:00Z.
const paper = (quizId: string, overrides: Partial<PaperWindow> = {}): PaperWindow => ({
  quizId,
  opensAt: "2026-10-05T23:30:00.000Z",
  closesAt: "2026-10-10T18:25:00.000Z",
  grade: 11,
  switchedOn: true,
  ...overrides,
});

describe("monthlyTestsFrom", () => {
  it("makes one Monthly Test per list entry, named by its label, with the first three letters as short name", () => {
    const tests = monthlyTestsFrom(
      [{ label: "October", quizIds: ["q1", "q2"] }],
      [paper("q1", { grade: 11 }), paper("q2", { grade: 12 })],
      new Date("2026-10-12T06:00:00.000Z"),
    );

    expect(tests).toEqual([
      {
        key: "october",
        name: "October",
        shortName: "Oct",
        opensAt: "2026-10-05T23:30:00.000Z",
        closesAt: "2026-10-10T18:25:00.000Z",
        state: "closed",
        grades: [11, 12],
      },
    ]);
  });

  const october = [{ label: "October", quizIds: ["q1"] }];
  const stateAt = (iso: string) => monthlyTestsFrom(october, [paper("q1")], new Date(iso)).map((t) => t.state);

  it("is not shown before its opening time", () => {
    expect(stateAt("2026-10-05T23:29:59.999Z")).toEqual([]);
  });

  it("is running from exactly its opening time", () => {
    expect(stateAt("2026-10-05T23:30:00.000Z")).toEqual(["running"]);
  });

  it("is still running just before its closing time", () => {
    expect(stateAt("2026-10-10T18:24:59.999Z")).toEqual(["running"]);
  });

  it("is closed from exactly its closing time", () => {
    expect(stateAt("2026-10-10T18:25:00.000Z")).toEqual(["closed"]);
  });

  it("keeps a Paper closing at 11:55 pm IST running at 11:00 pm IST that day", () => {
    // 2026-10-10 23:00 IST = 2026-10-10T17:30:00Z
    expect(stateAt("2026-10-10T17:30:00.000Z")).toEqual(["running"]);
  });

  it("opens at the earliest Paper opening and closes at the latest Paper closing", () => {
    // G12 opens 19 Aug 05:00 IST and closes 24 Aug 23:55 IST; G11 opens 26 Aug 05:00 IST and closes 30 Aug 23:55 IST.
    const tests = monthlyTestsFrom(
      [{ label: "August", quizIds: ["g12", "g11"] }],
      [
        paper("g12", { grade: 12, opensAt: "2026-08-18T23:30:00.000Z", closesAt: "2026-08-24T18:25:00.000Z" }),
        paper("g11", { grade: 11, opensAt: "2026-08-25T23:30:00.000Z", closesAt: "2026-08-30T18:25:00.000Z" }),
      ],
      new Date("2026-08-27T06:00:00.000Z"),
    );

    expect(tests).toEqual([
      expect.objectContaining({
        opensAt: "2026-08-18T23:30:00.000Z",
        closesAt: "2026-08-30T18:25:00.000Z",
        state: "running",
        grades: [11, 12],
      }),
    ]);
  });

  it("skips a switched-off Paper, a Paper with no session row and a Paper with a missing time", () => {
    // Only the G12 Paper is usable: the G11 one is switched off (as August's G11 Papers are in production).
    const tests = monthlyTestsFrom(
      [{ label: "August", quizIds: ["g12", "g11-off", "no-row", "no-close", "no-open"] }],
      [
        paper("g12", { grade: 12, opensAt: "2026-08-18T23:30:00.000Z", closesAt: "2026-08-24T18:25:00.000Z" }),
        paper("g11-off", { grade: 11, switchedOn: false, opensAt: "2026-08-25T23:30:00.000Z", closesAt: "2026-08-30T18:25:00.000Z" }),
        paper("no-close", { grade: 11, closesAt: null }),
        paper("no-open", { grade: 11, opensAt: null }),
      ],
      new Date("2026-11-18T08:30:00.000Z"),
    );

    expect(tests).toEqual([
      {
        key: "august",
        name: "August",
        shortName: "Aug",
        opensAt: "2026-08-18T23:30:00.000Z",
        closesAt: "2026-08-24T18:25:00.000Z",
        state: "closed",
        grades: [12],
      },
    ]);
  });

  it("leaves out a Monthly Test with no usable Paper", () => {
    const tests = monthlyTestsFrom(
      [
        { label: "July", quizIds: ["off"] },
        { label: "October", quizIds: ["q1"] },
      ],
      [paper("off", { switchedOn: false }), paper("q1")],
      new Date("2026-11-18T08:30:00.000Z"),
    );

    expect(tests.map((t) => t.name)).toEqual(["October"]);
  });

  it("orders Monthly Tests by closing time, whatever the list order", () => {
    const tests = monthlyTestsFrom(
      [
        { label: "October", quizIds: ["oct"] },
        { label: "July", quizIds: ["jul"] },
        { label: "September", quizIds: ["sep"] },
      ],
      [
        paper("oct", { opensAt: "2026-10-05T23:30:00.000Z", closesAt: "2026-10-10T18:25:00.000Z" }),
        paper("jul", { opensAt: "2026-07-21T23:30:00.000Z", closesAt: "2026-07-28T18:15:00.000Z" }),
        paper("sep", { opensAt: "2026-09-08T23:30:00.000Z", closesAt: "2026-09-15T18:25:00.000Z" }),
      ],
      new Date("2026-11-18T08:30:00.000Z"),
    );

    expect(tests.map((t) => [t.name, t.shortName])).toEqual([
      ["July", "Jul"],
      ["September", "Sep"],
      ["October", "Oct"],
    ]);
  });

  it("gives every Monthly Test its own key", () => {
    const tests = monthlyTestsFrom(
      [
        { label: "Mock Test", quizIds: ["a"] },
        { label: "Mock  test", quizIds: ["b"] },
      ],
      [
        paper("a", { closesAt: "2026-10-09T18:25:00.000Z" }),
        paper("b", { closesAt: "2026-10-10T18:25:00.000Z" }),
      ],
      new Date("2026-11-18T08:30:00.000Z"),
    );

    expect(tests.map((t) => [t.key, t.shortName])).toEqual([
      ["mock-test", "Moc"],
      ["mock-test-2", "Moc"],
    ]);
  });
});

// Students as the loader lists them, before any attendance.
const listed = (userId: string, grade: number, name = `Student ${userId}`): ListedStudent => ({
  userId,
  name,
  studentId: `NVS${userId}`,
  grade,
  examPreparingFor: "Engineering",
});
const opened = (userId: string, quizId: string, submitted: boolean | null = false): PaperAttendance => ({
  userId,
  quizId,
  submitted,
});

describe("testAttendanceFrom", () => {
  // October: two Grade 11 Papers (Engineering, NDA) and one Grade 12 Paper. Closed on 12 Oct.
  const octoberSets = [{ label: "October", quizIds: ["g11-eng", "g11-nda", "g12-eng"] }];
  const octoberPapers = [
    paper("g11-eng", { grade: 11 }),
    paper("g11-nda", { grade: 11 }),
    paper("g12-eng", { grade: 12 }),
  ];
  const after = new Date("2026-10-12T06:00:00.000Z");
  const marksOf = (students: ListedStudent[], attendance: PaperAttendance[]) =>
    testAttendanceFrom({ testSets: octoberSets, papers: octoberPapers, students, attendance, now: after }).students.map(
      (s) => [s.userId, s.attendance],
    );

  it("marks each Student not opened, opened or submitted for the Monthly Test", () => {
    expect(
      marksOf(
        [listed("1", 11), listed("2", 11), listed("3", 11)],
        [opened("2", "g11-eng", false), opened("3", "g11-eng", true)],
      ),
    ).toEqual([
      ["1", { october: "not_opened" }],
      ["2", { october: "opened" }],
      ["3", { october: "submitted" }],
    ]);
  });

  it("is submitted when a Student opened two Papers and submitted one", () => {
    expect(marksOf([listed("1", 11)], [opened("1", "g11-eng", false), opened("1", "g11-nda", true)])).toEqual([
      ["1", { october: "submitted" }],
    ]);
  });

  it("is opened when a Student opened two Papers and submitted none", () => {
    expect(marksOf([listed("1", 11)], [opened("1", "g11-eng", false), opened("1", "g11-nda", false)])).toEqual([
      ["1", { october: "opened" }],
    ]);
  });

  it("counts a Paper of another grade", () => {
    expect(marksOf([listed("1", 11)], [opened("1", "g12-eng", true)])).toEqual([["1", { october: "submitted" }]]);
  });

  it("counts an opened Paper with an unknown submitted state as opened, not submitted", () => {
    expect(marksOf([listed("1", 11)], [opened("1", "g11-eng", null)])).toEqual([["1", { october: "opened" }]]);
  });

  it("is submitted when any of several rows for one Paper is submitted", () => {
    expect(marksOf([listed("1", 11)], [opened("1", "g11-eng", null), opened("1", "g11-eng", true)])).toEqual([
      ["1", { october: "submitted" }],
    ]);
  });

  it("ignores rows for other Students and for Papers outside the Monthly Test", () => {
    expect(marksOf([listed("1", 11)], [opened("2", "g11-eng", true), opened("1", "sept-g11", true)])).toEqual([
      ["1", { october: "not_opened" }],
    ]);
  });

  it("leaves a grade with no Paper in a Monthly Test out of it", () => {
    // August has only Grade 12 Papers; October has both grades.
    const result = testAttendanceFrom({
      testSets: [
        { label: "August", quizIds: ["aug-g12"] },
        { label: "October", quizIds: ["g11-eng", "g12-eng"] },
      ],
      papers: [
        paper("aug-g12", { grade: 12, opensAt: "2026-08-18T23:30:00.000Z", closesAt: "2026-08-24T18:25:00.000Z" }),
        paper("g11-eng", { grade: 11 }),
        paper("g12-eng", { grade: 12 }),
      ],
      students: [listed("1", 11), listed("2", 12)],
      attendance: [opened("2", "aug-g12", true)],
      now: after,
    });

    expect(result.students.map((s) => [s.userId, s.attendance])).toEqual([
      ["1", { october: "not_opened" }],
      ["2", { august: "submitted", october: "not_opened" }],
    ]);
  });

  it("keeps each Student's other fields as listed", () => {
    const result = testAttendanceFrom({
      testSets: octoberSets,
      papers: octoberPapers,
      students: [listed("1", 11, "Nisha Rao")],
      attendance: [],
      now: after,
    });

    expect(result.students).toEqual([
      {
        userId: "1",
        name: "Nisha Rao",
        studentId: "NVS1",
        grade: 11,
        examPreparingFor: "Engineering",
        attendance: { october: "not_opened" },
      },
    ]);
  });
});

describe("attendanceStatus", () => {
  it.each([
    ["running", "not_opened", "Yet to start"],
    ["running", "opened", "In progress"],
    ["running", "submitted", "Submitted"],
    ["closed", "not_opened", "Absent"],
    ["closed", "opened", "Opened, not submitted"],
    ["closed", "submitted", "Submitted"],
  ] as const)("a %s Monthly Test with a Student %s is %s", (state, mark, status) => {
    expect(attendanceStatus(state, mark)).toBe(status);
  });
});

describe("percentText", () => {
  it("rounds to a whole percentage", () => {
    expect(percentText(2, 3)).toBe("67%");
    expect(percentText(0, 4)).toBe("0%");
  });

  it("shows a zero base as a dash, never 0%", () => {
    expect(percentText(0, 0)).toBe("—");
  });
});

// One fixture counted by hand. October covers grades 11 and 12; Student 7 is
// Grade 11 with no mark for it (not counted), as a later rule can leave a Student out.
const student = (
  userId: string,
  name: string,
  grade: number,
  attendance: TestAttendanceStudent["attendance"],
): TestAttendanceStudent => ({
  userId,
  name,
  studentId: `NVS${userId}`,
  grade,
  examPreparingFor: userId === "4" ? null : "Engineering",
  attendance,
});
const monthFixture = [
  student("1", "Zara Khan", 12, { october: "submitted" }),
  student("2", "Arun Mehta", 12, { october: "not_opened" }),
  student("3", "Bina Shah", 11, { october: "opened" }),
  student("4", "Charu Pal", 11, { october: "submitted" }),
  student("5", "Anil Rao", 11, { october: "not_opened" }),
  student("6", "Dev Iyer", 11, { october: "submitted", july: "not_opened" }),
  student("7", "Ekta Jain", 11, { july: "submitted" }),
];

describe("monthTiles", () => {
  it("counts only the Students counted for the Monthly Test", () => {
    // Counted: 1–6 (six). Submitted: 1, 4, 6. Opened, not submitted: 3. Not opened: 2, 5.
    expect(monthTiles(monthFixture, "october")).toEqual({
      counted: 6,
      attended: 4,
      submitted: 3,
      opened: 1,
      notOpened: 2,
    });
  });

  it("is all zeros when nobody is counted", () => {
    expect(monthTiles(monthFixture, "september")).toEqual({
      counted: 0,
      attended: 0,
      submitted: 0,
      opened: 0,
      notOpened: 0,
    });
  });
});

describe("monthStudents", () => {
  const closed = { key: "october", state: "closed" as const };
  const names = (rows: { student: TestAttendanceStudent; status: string }[]) =>
    rows.map((row) => `${row.student.name}: ${row.status}`);

  it("lists every counted Student by grade, then name, with their status", () => {
    expect(names(monthStudents(monthFixture, closed, "all"))).toEqual([
      "Anil Rao: Absent",
      "Bina Shah: Opened, not submitted",
      "Charu Pal: Submitted",
      "Dev Iyer: Submitted",
      "Arun Mehta: Absent",
      "Zara Khan: Submitted",
    ]);
  });

  it("filters to the Students to chase, those who opened no Paper", () => {
    expect(names(monthStudents(monthFixture, closed, "not_opened"))).toEqual([
      "Anil Rao: Absent",
      "Arun Mehta: Absent",
    ]);
  });

  it("filters to the Students who opened and did not submit", () => {
    expect(names(monthStudents(monthFixture, { key: "october", state: "running" }, "opened"))).toEqual([
      "Bina Shah: In progress",
    ]);
  });

  it("filters to the Students who submitted", () => {
    expect(names(monthStudents(monthFixture, closed, "submitted"))).toEqual([
      "Charu Pal: Submitted",
      "Dev Iyer: Submitted",
      "Zara Khan: Submitted",
    ]);
  });

  it("defaults to the Students to chase", () => {
    expect(names(monthStudents(monthFixture, { key: "october", state: "running" }))).toEqual([
      "Anil Rao: Yet to start",
      "Arun Mehta: Yet to start",
    ]);
  });
});
