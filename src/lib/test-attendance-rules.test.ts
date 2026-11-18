import { describe, expect, it } from "vitest";

import {
  allYearStudents,
  allYearTiles,
  attendanceStatus,
  attendedText,
  countedTestsLine,
  ALL_STUDENTS,
  examPreparingFor,
  examPreparingForOptions,
  filterStudents,
  followUpFor,
  monthGroupRows,
  monthStudents,
  monthTiles,
  monthlyTestsFrom,
  percentText,
  tagWindow,
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

  describe("joining date", () => {
    // October opens 6 Oct 05:00 IST and closes 10 Oct 11:55 pm IST (18:25 UTC).
    const marksJoined = (joinedOn: Map<string, string>) =>
      testAttendanceFrom({
        testSets: octoberSets,
        papers: octoberPapers,
        students: [listed("1", 11)],
        attendance: [],
        joinedOn,
        now: after,
      }).students.map((s) => s.attendance);

    it("leaves a Student who joined the day after closing out of the Monthly Test", () => {
      expect(marksJoined(new Map([["1", "2026-10-11"]]))).toEqual([{}]);
    });

    it.each([
      ["before opening", "2026-09-01"],
      ["while it was running", "2026-10-08"],
      ["on the closing day", "2026-10-10"],
    ])("counts a Student who joined %s", (_when, joined) => {
      expect(marksJoined(new Map([["1", joined]]))).toEqual([{ october: "not_opened" }]);
    });

    it("counts a Student with no joining date", () => {
      expect(marksJoined(new Map([["2", "2026-10-11"]]))).toEqual([{ october: "not_opened" }]);
    });

    it("reads the closing day in IST, not UTC", () => {
      // Closes 11 Oct 12:30 am IST = 10 Oct 19:00 UTC: the closing day is 11 Oct.
      const result = testAttendanceFrom({
        testSets: [{ label: "October", quizIds: ["late"] }],
        papers: [paper("late", { closesAt: "2026-10-10T19:00:00.000Z" })],
        students: [listed("1", 11), listed("2", 11)],
        attendance: [],
        joinedOn: new Map([
          ["1", "2026-10-11"],
          ["2", "2026-10-12"],
        ]),
        now: after,
      });

      expect(result.students.map((s) => [s.userId, s.attendance])).toEqual([
        ["1", { october: "not_opened" }],
        ["2", {}],
      ]);
    });

    it("drops the month page's count by the Students who joined after it closed", () => {
      // September closes 12 Sep 11:55 pm IST, October 10 Oct 11:55 pm IST.
      // Students 1–3 joined before September; 4 and 5 joined on 20 Sep.
      const result = testAttendanceFrom({
        testSets: [
          { label: "September", quizIds: ["sep"] },
          { label: "October", quizIds: ["oct"] },
        ],
        papers: [
          paper("sep", { opensAt: "2026-09-07T23:30:00.000Z", closesAt: "2026-09-12T18:25:00.000Z" }),
          paper("oct"),
        ],
        students: [listed("1", 11), listed("2", 11), listed("3", 11), listed("4", 11), listed("5", 11)],
        attendance: [opened("1", "sep", true), opened("4", "oct", true)],
        joinedOn: new Map([
          ["1", "2026-06-15"],
          ["2", "2026-06-15"],
          ["3", "2026-06-15"],
          ["4", "2026-09-20"],
          ["5", "2026-09-20"],
        ]),
        now: after,
      });

      expect(monthTiles(result.students, "september")).toEqual({
        counted: 3,
        attended: 1,
        submitted: 1,
        opened: 0,
        notOpened: 2,
      });
      expect(monthTiles(result.students, "october")).toEqual({
        counted: 5,
        attended: 1,
        submitted: 1,
        opened: 0,
        notOpened: 4,
      });
    });
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

// A second fixture for groups and filters, counted by hand. October covers
// grades 11 and 12. Jaya (Grade 12, NDA) has no October mark, so she is not
// counted and her group gets no row. Farah's "Science" is not one of the five.
const grouped = (
  userId: string,
  name: string,
  grade: number,
  examPreparingFor: string | null,
  attendance: TestAttendanceStudent["attendance"],
): TestAttendanceStudent => ({
  userId,
  name,
  studentId: `NVS${userId}`,
  grade,
  examPreparingFor: examPreparingFor as TestAttendanceStudent["examPreparingFor"],
  attendance,
});
const groupFixture = [
  grouped("9", "Indu Bose", 12, "CA", { october: "not_opened" }),
  grouped("5", "Esha Nair", 11, null, { october: "not_opened" }),
  grouped("1", "Asha Roy", 11, "Engineering", { october: "submitted" }),
  grouped("7", "Gita Sen", 12, "Engineering", { october: "submitted" }),
  grouped("4", "Dina Paul", 11, "Medical", { october: "submitted" }),
  grouped("6", "Farah Ali", 11, "Science", { october: "opened" }),
  grouped("2", "Bala Iyer", 11, "engineering", { october: "opened" }),
  grouped("10", "Jaya Das", 12, "NDA", { july: "submitted" }),
  grouped("3", "Chen Lal", 11, "Engineering", { october: "not_opened" }),
  grouped("8", "Hari Om", 12, "Engineering", { october: "submitted" }),
];

describe("monthGroupRows", () => {
  it("has one row per grade and Exam Preparing For with a counted Student, Grade 11 first, in group order", () => {
    expect(monthGroupRows(groupFixture, "october")).toEqual([
      { grade: 11, examPreparingFor: "Engineering", counted: 3, attended: 2, submitted: 1, opened: 1, notOpened: 1 },
      { grade: 11, examPreparingFor: "Medical", counted: 1, attended: 1, submitted: 1, opened: 0, notOpened: 0 },
      { grade: 11, examPreparingFor: "Not set", counted: 2, attended: 1, submitted: 0, opened: 1, notOpened: 1 },
      { grade: 12, examPreparingFor: "Engineering", counted: 2, attended: 2, submitted: 2, opened: 0, notOpened: 0 },
      { grade: 12, examPreparingFor: "CA", counted: 1, attended: 0, submitted: 0, opened: 0, notOpened: 1 },
    ]);
  });

  it("adds up to the tiles", () => {
    // Counted: Students 1–9. Submitted: 1, 4, 7, 8. Opened only: 2, 6. Not opened: 3, 5, 9.
    expect(monthTiles(groupFixture, "october")).toEqual({
      counted: 9,
      attended: 6,
      submitted: 4,
      opened: 2,
      notOpened: 3,
    });
  });

  it("has no rows when nobody is counted", () => {
    expect(monthGroupRows(groupFixture, "september")).toEqual([]);
  });
});

describe("filterStudents", () => {
  const closed = { key: "october", state: "closed" as const };
  const names = (rows: { student: TestAttendanceStudent }[]) => rows.map((row) => row.student.name);

  it("keeps every Student with no filter set", () => {
    expect(filterStudents(groupFixture, ALL_STUDENTS)).toHaveLength(10);
  });

  it("applies the Grade filter to the tiles, the group rows and the list", () => {
    const grade12 = filterStudents(groupFixture, { grade: 12, examPreparingFor: "all" });

    // Counted Grade 12: Gita, Hari (submitted), Indu (not opened). Jaya is not counted.
    expect(monthTiles(grade12, "october")).toEqual({ counted: 3, attended: 2, submitted: 2, opened: 0, notOpened: 1 });
    expect(monthGroupRows(grade12, "october").map((row) => `${row.grade} ${row.examPreparingFor}`)).toEqual([
      "12 Engineering",
      "12 CA",
    ]);
    expect(names(monthStudents(grade12, closed, "all"))).toEqual(["Gita Sen", "Hari Om", "Indu Bose"]);
  });

  it("applies the Exam Preparing For filter to the tiles, the group rows and the list", () => {
    const engineering = filterStudents(groupFixture, { grade: "all", examPreparingFor: "Engineering" });

    // Asha, Bala ("engineering"), Chen (Grade 11); Gita, Hari (Grade 12).
    expect(monthTiles(engineering, "october")).toEqual({ counted: 5, attended: 4, submitted: 3, opened: 1, notOpened: 1 });
    expect(monthGroupRows(engineering, "october").map((row) => `${row.grade} ${row.examPreparingFor}`)).toEqual([
      "11 Engineering",
      "12 Engineering",
    ]);
    expect(names(monthStudents(engineering, closed, "all"))).toEqual([
      "Asha Roy",
      "Bala Iyer",
      "Chen Lal",
      "Gita Sen",
      "Hari Om",
    ]);
  });

  it("puts a blank and an unrecognised Exam Preparing For under Not set", () => {
    const notSet = filterStudents(groupFixture, { grade: "all", examPreparingFor: "Not set" });

    expect(names(monthStudents(notSet, closed, "all"))).toEqual(["Esha Nair", "Farah Ali"]);
    expect(monthTiles(notSet, "october")).toEqual({ counted: 2, attended: 1, submitted: 0, opened: 1, notOpened: 1 });
  });

  it("applies both filters together", () => {
    const rows = monthGroupRows(filterStudents(groupFixture, { grade: 11, examPreparingFor: "Medical" }), "october");

    expect(rows).toEqual([
      { grade: 11, examPreparingFor: "Medical", counted: 1, attended: 1, submitted: 1, opened: 0, notOpened: 0 },
    ]);
  });

  it("can leave nobody, and every count is then zero", () => {
    const none = filterStudents(groupFixture, { grade: 12, examPreparingFor: "Medical" });

    expect(monthTiles(none, "october")).toEqual({ counted: 0, attended: 0, submitted: 0, opened: 0, notOpened: 0 });
    expect(monthGroupRows(none, "october")).toEqual([]);
  });
});

describe("examPreparingForOptions", () => {
  it("offers the five, then Not set when some listed Student has none", () => {
    expect(examPreparingForOptions(groupFixture)).toEqual(["Engineering", "Medical", "CLAT", "CA", "NDA", "Not set"]);
  });

  it("offers Not set for an unrecognised value", () => {
    expect(examPreparingForOptions([grouped("6", "Farah Ali", 11, "Science", {})])).toEqual([
      "Engineering",
      "Medical",
      "CLAT",
      "CA",
      "NDA",
      "Not set",
    ]);
  });

  it("offers only the five when every listed Student has one", () => {
    expect(examPreparingForOptions([grouped("1", "Asha Roy", 11, "Engineering", {})])).toEqual([
      "Engineering",
      "Medical",
      "CLAT",
      "CA",
      "NDA",
    ]);
  });
});

// All year (#527). Monthly Tests as the endpoint returns them: ordered by closing time.
const monthly = (key: string, name: string, state: "running" | "closed" = "closed") => ({
  key,
  name,
  shortName: name.slice(0, 3),
  opensAt: "2026-01-01T00:00:00.000Z",
  closesAt: "2026-01-02T00:00:00.000Z",
  state,
  grades: [11, 12],
});
const jul = monthly("july", "July");
const aug = monthly("august", "August");
const sep = monthly("september", "September");
const oct = monthly("october", "October");
const nov = monthly("november", "November", "running");

describe("tagWindow", () => {
  it("is the last 3 closed Monthly Tests, oldest first", () => {
    expect(tagWindow([jul, aug, sep, oct, nov]).map((t) => t.key)).toEqual(["august", "september", "october"]);
  });

  it("never counts a running Monthly Test", () => {
    expect(tagWindow([sep, oct, nov]).map((t) => t.key)).toEqual(["september", "october"]);
  });

  it.each([
    [[], []],
    [[nov], []],
    [[oct], ["october"]],
    [[sep, oct], ["september", "october"]],
    [[aug, sep, oct], ["august", "september", "october"]],
  ])("holds fewer tests early in the year: %#", (tests, keys) => {
    expect(tagWindow(tests).map((t) => t.key)).toEqual(keys);
  });
});

const window3 = [aug, sep, oct];
const marks = (attendance: TestAttendanceStudent["attendance"]): TestAttendanceStudent => ({
  userId: "1",
  name: "Asha Roy",
  studentId: "NVS1",
  grade: 11,
  examPreparingFor: "Engineering",
  attendance,
});
const tagOf = (attendance: TestAttendanceStudent["attendance"], window = window3) =>
  followUpFor(marks(attendance), window).tag;

describe("followUpFor — tags", () => {
  it("gives no tag for exactly 1 Absent", () => {
    expect(tagOf({ august: "not_opened", september: "submitted", october: "submitted" })).toBeNull();
  });

  it("gives the Follow Up Tag for exactly 2 Absent", () => {
    expect(tagOf({ august: "not_opened", september: "submitted", october: "not_opened" })).toBe("follow_up");
  });

  it("gives the Follow Up Tag for 3 Absent", () => {
    expect(tagOf({ august: "not_opened", september: "not_opened", october: "not_opened" })).toBe("follow_up");
  });

  it("gives no tag for exactly 1 Opened, not submitted", () => {
    expect(tagOf({ august: "submitted", september: "opened", october: "submitted" })).toBeNull();
  });

  it("gives the Not Submitting Tag for exactly 2 Opened, not submitted", () => {
    expect(tagOf({ august: "opened", september: "submitted", october: "opened" })).toBe("not_submitting");
  });

  it("gives the Not Submitting Tag for 2 Opened, not submitted and 1 Absent", () => {
    expect(tagOf({ august: "not_opened", september: "opened", october: "opened" })).toBe("not_submitting");
  });

  it("gives no tag for one miss plus one non-submission", () => {
    expect(tagOf({ august: "not_opened", september: "opened", october: "submitted" })).toBeNull();
  });

  it("never tags a Student counted for one Monthly Test of the window", () => {
    expect(tagOf({ october: "not_opened" })).toBeNull();
    expect(tagOf({ october: "opened" })).toBeNull();
  });

  it("judges a Student only on the window's tests they are counted for", () => {
    // Not counted for August; Absent in September and October.
    expect(tagOf({ september: "not_opened", october: "not_opened" })).toBe("follow_up");
  });

  it("never counts a running Monthly Test or one before the window", () => {
    // Absent in July (before the window) and November (running); Absent once in the window.
    const window = tagWindow([jul, aug, sep, oct, nov]);
    expect(
      tagOf({ july: "not_opened", august: "submitted", september: "submitted", october: "not_opened", november: "not_opened" }, window),
    ).toBeNull();
  });

  it("gives no tag when no Monthly Test has closed", () => {
    expect(tagOf({ november: "not_opened" }, [])).toBeNull();
  });
});

const noteOf = (attendance: TestAttendanceStudent["attendance"], window = window3) => {
  const { note, tone } = followUpFor(marks(attendance), window);
  return { note, tone };
};

describe("followUpFor — notes", () => {
  it("gives no note to a Student with no miss and no non-submission", () => {
    expect(noteOf({ august: "submitted", september: "submitted", october: "submitted" })).toEqual({ note: null, tone: null });
  });

  it("names a single miss in red", () => {
    expect(noteOf({ august: "submitted", september: "submitted", october: "not_opened" })).toEqual({
      note: "Missed Oct",
      tone: "red",
    });
  });

  it("names a single non-submission in amber", () => {
    expect(noteOf({ august: "submitted", september: "opened", october: "submitted" })).toEqual({
      note: "Not submitted Sep",
      tone: "amber",
    });
  });

  it("puts misses first, then non-submissions, and is red when it has a miss", () => {
    expect(noteOf({ august: "not_opened", september: "submitted", october: "opened" })).toEqual({
      note: "Missed Aug · Not submitted Oct",
      tone: "red",
    });
  });

  it("names the months of a Not Submitting Tag in calendar order, in amber", () => {
    expect(noteOf({ august: "submitted", september: "opened", october: "opened" })).toEqual({
      note: "Not submitted Sep, Oct",
      tone: "amber",
    });
  });

  it("is red for a Not Submitting Tag with a miss", () => {
    expect(noteOf({ august: "opened", september: "not_opened", october: "opened" })).toEqual({
      note: "Missed Sep · Not submitted Aug, Oct",
      tone: "red",
    });
  });

  it("names only the window's tests", () => {
    const window = tagWindow([jul, aug, sep, oct, nov]);
    expect(
      noteOf({ july: "not_opened", august: "submitted", september: "submitted", october: "submitted", november: "not_opened" }, window),
    ).toEqual({ note: null, tone: null });
  });
});

const patternOf = (attendance: TestAttendanceStudent["attendance"]) => {
  const { tag, pattern, note, tone } = followUpFor(marks(attendance), window3);
  return { tag, pattern, note, tone };
};

describe("followUpFor — Follow Up patterns", () => {
  it("1: missed every counted test", () => {
    expect(patternOf({ august: "not_opened", september: "not_opened", october: "not_opened" })).toEqual({
      tag: "follow_up",
      pattern: 1,
      note: "Missed Aug, Sep, Oct",
      tone: "red",
    });
  });

  it("1: missed every counted test when counted for two", () => {
    expect(patternOf({ september: "not_opened", october: "not_opened" })).toEqual({
      tag: "follow_up",
      pattern: 1,
      note: "Missed Sep, Oct",
      tone: "red",
    });
  });

  it("1: missed the latest two in a row", () => {
    expect(patternOf({ august: "submitted", september: "not_opened", october: "not_opened" })).toEqual({
      tag: "follow_up",
      pattern: 1,
      note: "Missed Sep, Oct in a row",
      tone: "red",
    });
  });

  it("1: missed the latest two in a row after opening and not submitting the first", () => {
    expect(patternOf({ august: "opened", september: "not_opened", october: "not_opened" })).toEqual({
      tag: "follow_up",
      pattern: 1,
      note: "Missed Sep, Oct in a row · Not submitted Aug",
      tone: "red",
    });
  });

  it("2: missed the first and the last of three", () => {
    expect(patternOf({ august: "not_opened", september: "submitted", october: "not_opened" })).toEqual({
      tag: "follow_up",
      pattern: 2,
      note: "Missed Aug and Oct",
      tone: "red",
    });
  });

  it("2: missed the first and the last of three, with the middle opened, not submitted", () => {
    expect(patternOf({ august: "not_opened", september: "opened", october: "not_opened" })).toEqual({
      tag: "follow_up",
      pattern: 2,
      note: "Missed Aug and Oct · Not submitted Sep",
      tone: "red",
    });
  });

  it("3: missed the first two and attended the latest", () => {
    expect(patternOf({ august: "not_opened", september: "not_opened", october: "submitted" })).toEqual({
      tag: "follow_up",
      pattern: 3,
      note: "Missed Aug, Sep · attended Oct",
      tone: "red",
    });
  });

  it("3: says Not submitted instead of attended when the latest was opened, not submitted", () => {
    expect(patternOf({ august: "not_opened", september: "not_opened", october: "opened" })).toEqual({
      tag: "follow_up",
      pattern: 3,
      note: "Missed Aug, Sep · Not submitted Oct",
      tone: "red",
    });
  });

  it("has no pattern without the Follow Up Tag", () => {
    expect(patternOf({ august: "opened", september: "opened", october: "submitted" }).pattern).toBeNull();
    expect(patternOf({ august: "not_opened", september: "submitted", october: "submitted" }).pattern).toBeNull();
  });
});

// The All year list, written out by hand. Window: Aug, Sep, Oct.
const yearStudent = (
  userId: string,
  name: string,
  grade: number,
  attendance: TestAttendanceStudent["attendance"],
  examPreparingFor: TestAttendanceStudent["examPreparingFor"] = "Engineering",
): TestAttendanceStudent => ({ userId, name, studentId: `NVS${userId}`, grade, examPreparingFor, attendance });
const yearFixture = [
  yearStudent("1", "Zoya Ali", 11, { august: "submitted", september: "submitted", october: "submitted" }),
  yearStudent("2", "Kiran Das", 12, { august: "not_opened", september: "not_opened", october: "submitted" }), // pattern 3
  yearStudent("3", "Lata Sen", 11, { august: "not_opened", september: "submitted", october: "not_opened" }), // pattern 2
  yearStudent("4", "Mohan Roy", 12, { august: "submitted", september: "not_opened", october: "not_opened" }), // pattern 1
  yearStudent("5", "Neel Jha", 11, { august: "opened", september: "submitted", october: "opened" }), // Not Submitting
  yearStudent("6", "Asha Bose", 11, { august: "not_opened", september: "not_opened", october: "not_opened" }), // pattern 1
  yearStudent("7", "Bala Nair", 11, { august: "submitted", september: "opened", october: "submitted" }), // note only
  yearStudent("8", "Omar Khan", 11, { october: "not_opened" }), // joined late: counted for one
  yearStudent("9", "Pia Shah", 12, {}, null), // counted for none
  yearStudent("10", "Ravi Iyer", 12, { august: "opened", september: "opened", october: "not_opened" }, "Medical"), // Not Submitting
];
const yearNames = (rows: { student: TestAttendanceStudent }[]) => rows.map((row) => row.student.name);

describe("allYearStudents", () => {
  it("lists Follow Up by pattern, then Not Submitting, then everyone else; grade then name within each", () => {
    expect(yearNames(allYearStudents(yearFixture, window3))).toEqual([
      "Asha Bose", // Follow Up 1, Grade 11
      "Mohan Roy", // Follow Up 1, Grade 12
      "Lata Sen", // Follow Up 2
      "Kiran Das", // Follow Up 3
      "Neel Jha", // Not Submitting, Grade 11
      "Ravi Iyer", // Not Submitting, Grade 12
      "Bala Nair", // the rest, Grade 11
      "Omar Khan",
      "Zoya Ali",
      "Pia Shah", // Grade 12
    ]);
  });

  it("filters to Need follow-up", () => {
    expect(yearNames(allYearStudents(yearFixture, window3, "follow_up"))).toEqual([
      "Asha Bose",
      "Mohan Roy",
      "Lata Sen",
      "Kiran Das",
    ]);
  });

  it("filters to Not submitting", () => {
    expect(yearNames(allYearStudents(yearFixture, window3, "not_submitting"))).toEqual(["Neel Jha", "Ravi Iyer"]);
  });

  it("gives each row its tag, note and Attended over the window", () => {
    const rows = allYearStudents(yearFixture, window3);
    const row = (name: string) => {
      const found = rows.find((r) => r.student.name === name)!;
      return { tag: found.followUp.tag, note: found.followUp.note, attended: attendedText(found.attended, found.counted) };
    };
    expect(row("Kiran Das")).toEqual({ tag: "follow_up", note: "Missed Aug, Sep · attended Oct", attended: "1 of 3 (33%)" });
    expect(row("Neel Jha")).toEqual({ tag: "not_submitting", note: "Not submitted Aug, Oct", attended: "3 of 3 (100%)" });
    expect(row("Bala Nair")).toEqual({ tag: null, note: "Not submitted Sep", attended: "3 of 3 (100%)" });
    expect(row("Omar Khan")).toEqual({ tag: null, note: "Missed Oct", attended: "0 of 1 (0%)" });
    expect(row("Ravi Iyer")).toEqual({ tag: "not_submitting", note: "Missed Oct · Not submitted Aug, Sep", attended: "2 of 3 (67%)" });
    expect(row("Pia Shah")).toEqual({ tag: null, note: null, attended: "—" });
  });
});

describe("allYearTiles", () => {
  it("counts Enrolled, sittings over the window and Need follow-up for the fixture", () => {
    // Sittings: eight Students counted for all three tests, Omar for one, Pia for none = 25.
    // Attended: Zoya 3, Kiran 1, Lata 1, Mohan 1, Neel 3, Asha 0, Bala 3, Omar 0, Ravi 2 = 14.
    // Opened, not submitted: Neel 2, Bala 1, Ravi 2 = 5. Follow Up: Asha, Mohan, Lata, Kiran.
    expect(allYearTiles(yearFixture, window3)).toEqual({
      enrolled: 10,
      sittings: 25,
      attended: 14,
      openedNotSubmitted: 5,
      followUp: 4,
    });
  });

  it("has no sittings when no Monthly Test has closed", () => {
    expect(allYearTiles(yearFixture, [])).toEqual({
      enrolled: 10,
      sittings: 0,
      attended: 0,
      openedNotSubmitted: 0,
      followUp: 0,
    });
  });

  it("applies the Grade filter to the tiles and the list", () => {
    const grade12 = filterStudents(yearFixture, { grade: 12, examPreparingFor: "all" });
    // Kiran, Mohan, Pia, Ravi. Sittings 3 + 3 + 0 + 3; attended 1 + 1 + 2; opened, not submitted: Ravi 2.
    expect(allYearTiles(grade12, window3)).toEqual({
      enrolled: 4,
      sittings: 9,
      attended: 4,
      openedNotSubmitted: 2,
      followUp: 2,
    });
    expect(yearNames(allYearStudents(grade12, window3))).toEqual(["Mohan Roy", "Kiran Das", "Ravi Iyer", "Pia Shah"]);
  });

  it("applies the Exam Preparing For filter to the tiles and the list", () => {
    const notSet = filterStudents(yearFixture, { grade: "all", examPreparingFor: "Not set" });
    expect(allYearTiles(notSet, window3)).toEqual({
      enrolled: 1,
      sittings: 0,
      attended: 0,
      openedNotSubmitted: 0,
      followUp: 0,
    });
    expect(yearNames(allYearStudents(notSet, window3))).toEqual(["Pia Shah"]);
  });
});

describe("countedTestsLine", () => {
  const rules = "Follow up: Absent in 2 or more of them. Not submitting: Opened, not submitted in 2 or more of them.";

  it("names the counted tests and the running one that is added once it closes", () => {
    expect(countedTestsLine([jul, aug, sep, oct, nov])).toBe(
      `Counts tests that have closed: Aug, Sep, Oct. November is added once it closes. ${rules}`,
    );
  });

  it("names only the counted tests when none is running", () => {
    expect(countedTestsLine([sep, oct])).toBe(`Counts tests that have closed: Sep, Oct. ${rules}`);
  });

  it("names two running tests", () => {
    const retest = monthly("retest", "Retest", "running");
    expect(countedTestsLine([oct, nov, retest])).toBe(
      `Counts tests that have closed: Oct. November and Retest are added once they close. ${rules}`,
    );
  });
});
