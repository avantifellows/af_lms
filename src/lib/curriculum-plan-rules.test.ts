import { afterEach, describe, expect, it, vi } from "vitest";
import {
  academicYearEndDate,
  academicYearForDate,
  academicYearStartDate,
  behindPill,
  chapterProgress,
  chapterStatus,
  chapterTestStatus,
  classifySummaryClass,
  currentAcademicYearIST,
  parseAcademicYear,
  primaryExamTrack,
  primaryExamTrackForChapter,
  shiftAcademicYearForward,
  shiftDateForwardOneYear,
  uncoveredExamTracks,
} from "./curriculum-plan-rules";

describe("academic year", () => {
  it.each([
    ["2027-03-31", "2026-2027"],
    ["2027-04-01", "2027-2028"],
    ["2026-04-01", "2026-2027"],
    ["2026-12-31", "2026-2027"],
    ["2027-01-01", "2026-2027"],
  ])("puts %s in academic year %s", (date, expected) => {
    expect(academicYearForDate(date)).toBe(expected);
  });

  it("parses a consecutive academic year", () => {
    expect(parseAcademicYear("2026-2027")).toEqual({ startYear: 2026, endYear: 2027 });
  });

  it.each(["2026-2028", "2027-2026", "2026-2026", "2026", "26-27", "2026/2027", " 2026-2027", "", "abcd-efgh"])(
    "rejects %j as an academic year",
    (value) => {
      expect(parseAcademicYear(value)).toBeNull();
    },
  );

  it("runs from 1 Apr to 31 Mar", () => {
    expect(academicYearStartDate("2026-2027")).toBe("2026-04-01");
    expect(academicYearEndDate("2026-2027")).toBe("2027-03-31");
  });

  describe("current academic year", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("rolls over at midnight IST on 1 Apr, while it is still 31 Mar in UTC", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2027-03-31T18:29:00.000Z"));
      expect(currentAcademicYearIST()).toBe("2026-2027");

      vi.setSystemTime(new Date("2027-03-31T18:31:00.000Z"));
      expect(currentAcademicYearIST()).toBe("2027-2028");
    });
  });
});

describe("copy from last year", () => {
  it.each([
    ["2028-02-29", "2029-02-28"],
    ["2026-04-01", "2027-04-01"],
    ["2026-11-30", "2027-11-30"],
    ["2027-03-31", "2028-03-31"],
    ["2027-02-28", "2028-02-28"],
  ])("shifts %s to %s", (date, expected) => {
    expect(shiftDateForwardOneYear(date)).toBe(expected);
  });

  it("shifts an academic year to the next one", () => {
    expect(shiftAcademicYearForward("2026-2027")).toBe("2027-2028");
  });
});

describe("Summary Class classification", () => {
  // JEE Main, JEE Advanced and NEET have in-syllabus content for the Grade; CET and
  // Math Foundation never do.
  const tracksWithContent = ["jee_main", "jee_advanced", "neet"];

  const contentTrackCases = [
    { mapped: [], expected: { kind: "no_content" } },
    { mapped: ["jee_main"], expected: { kind: "single", tracks: ["jee_main"] } },
    { mapped: ["jee_advanced"], expected: { kind: "single", tracks: ["jee_advanced"] } },
    { mapped: ["neet"], expected: { kind: "single", tracks: ["neet"] } },
    { mapped: ["jee_main", "jee_advanced"], expected: { kind: "setup_error" } },
    { mapped: ["jee_main", "neet"], expected: { kind: "shared", tracks: ["jee_main", "neet"] } },
    { mapped: ["jee_advanced", "neet"], expected: { kind: "setup_error" } },
    { mapped: ["jee_main", "jee_advanced", "neet"], expected: { kind: "setup_error" } },
  ];
  const tracksWithoutContent = [[], ["cet"], ["math_foundation"], ["cet", "math_foundation"]];

  describe.each(tracksWithoutContent)("alongside %j", (...extraTracks: string[]) => {
    it.each(contentTrackCases)("classifies $mapped", ({ mapped, expected }) => {
      expect(classifySummaryClass([...mapped, ...extraTracks], tracksWithContent)).toEqual(expected);
    });
  });

  it("is no_content for a CET-only Centre + Grade", () => {
    expect(classifySummaryClass(["cet"], tracksWithContent)).toEqual({ kind: "no_content" });
  });

  it("drops a mapped track that has no in-syllabus content for the Grade", () => {
    expect(classifySummaryClass(["jee_main", "neet"], ["jee_main", "jee_advanced"])).toEqual({
      kind: "single",
      tracks: ["jee_main"],
    });
  });

  it("lists a shared class's tracks JEE Main first whatever the mapping order", () => {
    expect(classifySummaryClass(["neet", "jee_main"], tracksWithContent)).toEqual({
      kind: "shared",
      tracks: ["jee_main", "neet"],
    });
  });
});

describe("Primary Exam Track", () => {
  it.each([
    [["jee_main", "neet"], "jee_main"],
    [["neet", "jee_main"], "jee_main"],
    [["jee_advanced"], "jee_advanced"],
    [["neet"], "neet"],
  ] as const)("is %s's primary track %s", (classTracks, expected) => {
    expect(primaryExamTrack(classTracks)).toBe(expected);
  });

  it("falls back to NEET for a Biology Chapter in a shared class", () => {
    expect(primaryExamTrackForChapter(["jee_main", "neet"], ["neet"])).toBe("neet");
  });

  it("keeps JEE Main for a shared class's Chapter that both tracks cover", () => {
    expect(primaryExamTrackForChapter(["jee_main", "neet"], ["neet", "jee_main"])).toBe("jee_main");
  });

  it("ignores tracks that cover the Chapter but are not the class's", () => {
    expect(primaryExamTrackForChapter(["neet"], ["jee_main", "jee_advanced", "neet"])).toBe("neet");
  });

  it("has no primary track for a Chapter none of the class's tracks cover", () => {
    expect(primaryExamTrackForChapter(["neet"], ["jee_main"])).toBeNull();
  });
});

describe("Chapter status", () => {
  it.each([
    { dueDate: null, completedOn: null, asOf: "2026-07-20", expected: { kind: "not_in_plan" } },
    { dueDate: null, completedOn: "2026-07-01", asOf: "2026-07-20", expected: { kind: "not_in_plan" } },
    { dueDate: "2026-07-10", completedOn: "2026-07-10", asOf: "2026-07-20", expected: { kind: "done" } },
    { dueDate: "2026-07-10", completedOn: "2026-07-11", asOf: "2026-07-20", expected: { kind: "done_late", days: 1 } },
    { dueDate: "2026-07-30", completedOn: "2026-08-04", asOf: "2026-08-20", expected: { kind: "done_late", days: 5 } },
    { dueDate: "2026-07-10", completedOn: "2026-07-05", asOf: "2026-07-20", expected: { kind: "done" } },
    { dueDate: "2026-07-10", completedOn: "2026-07-05", asOf: "2026-07-08", expected: { kind: "done" } },
    { dueDate: "2026-07-10", completedOn: null, asOf: "2026-07-14", expected: { kind: "overdue", days: 4 } },
    { dueDate: "2026-07-30", completedOn: null, asOf: "2026-08-02", expected: { kind: "overdue", days: 3 } },
    { dueDate: "2027-02-27", completedOn: null, asOf: "2027-03-02", expected: { kind: "overdue", days: 3 } },
    { dueDate: "2026-07-10", completedOn: null, asOf: "2026-07-10", expected: { kind: "overdue", days: 0 } },
    { dueDate: "2026-07-10", completedOn: null, asOf: "2026-07-09", expected: { kind: "not_due" } },
  ])("due $dueDate, completed $completedOn, as of $asOf → $expected.kind", ({ expected, ...input }) => {
    expect(chapterStatus(input)).toEqual(expected);
  });
});

describe("Chapter Test Status", () => {
  describe("with no sessions", () => {
    it.each([
      // Default test date = due + 1 = 11 Jul; overdue from test date + 8 = 19 Jul.
      { dueDate: "2026-07-10", testDate: null, asOf: "2026-07-11", expected: "not_due" },
      { dueDate: "2026-07-10", testDate: null, asOf: "2026-07-18", expected: "not_due" },
      { dueDate: "2026-07-10", testDate: null, asOf: "2026-07-19", expected: "overdue" },
      // Plan test date 15 Jul wins over the default.
      { dueDate: "2026-07-10", testDate: "2026-07-15", asOf: "2026-07-22", expected: "not_due" },
      { dueDate: "2026-07-10", testDate: "2026-07-15", asOf: "2026-07-23", expected: "overdue" },
      // Default test date across a month end: due 31 Jul → test 1 Aug → overdue from 9 Aug.
      { dueDate: "2026-07-31", testDate: null, asOf: "2026-08-08", expected: "not_due" },
      { dueDate: "2026-07-31", testDate: null, asOf: "2026-08-09", expected: "overdue" },
      // Undated Chapters are never overdue.
      { dueDate: null, testDate: null, asOf: "2027-03-31", expected: "not_due" },
    ])("due $dueDate, test $testDate, as of $asOf → $expected", ({ expected, ...input }) => {
      expect(chapterTestStatus({ ...input, sessionEndTimes: [] })).toEqual({ kind: expected });
    });
  });

  it("is conducted by a session ending later on the as-of day", () => {
    expect(
      chapterTestStatus({
        dueDate: "2026-07-10",
        testDate: null,
        sessionEndTimes: ["2026-07-20T23:30:00"],
        asOf: "2026-07-20",
      }),
    ).toEqual({ kind: "conducted", conductedOn: "2026-07-20" });
  });

  it("is scheduled by a session ending the day after as-of", () => {
    expect(
      chapterTestStatus({
        dueDate: "2026-07-10",
        testDate: null,
        sessionEndTimes: ["2026-07-21 00:15:00"],
        asOf: "2026-07-20",
      }),
    ).toEqual({ kind: "scheduled" });
  });

  it("is scheduled, not overdue, by a session with no end time long after the test date", () => {
    expect(
      chapterTestStatus({ dueDate: "2026-07-10", testDate: null, sessionEndTimes: [null], asOf: "2026-09-01" }),
    ).toEqual({ kind: "scheduled" });
  });

  it("shows the earliest end date among ended sessions", () => {
    expect(
      chapterTestStatus({
        dueDate: "2026-07-10",
        testDate: null,
        sessionEndTimes: ["2026-07-25T10:00:00", null, "2026-07-12 16:00:00", "2026-08-05T10:00:00"],
        asOf: "2026-07-30",
      }),
    ).toEqual({ kind: "conducted", conductedOn: "2026-07-12" });
  });

  it("is conducted for an undated Chapter whose session has ended", () => {
    expect(
      chapterTestStatus({ dueDate: null, testDate: null, sessionEndTimes: ["2026-06-02T11:00:00"], asOf: "2026-06-10" }),
    ).toEqual({ kind: "conducted", conductedOn: "2026-06-02" });
  });
});

describe("Behind", () => {
  it("counts Due, Done and Behind for a class's plan Chapters", () => {
    const chapters = [
      { dueDate: "2026-07-01", completedOn: "2026-07-01" }, // due, done
      { dueDate: "2026-07-05", completedOn: "2026-07-09" }, // due, done late
      { dueDate: "2026-07-08", completedOn: null }, // due, overdue
      { dueDate: "2026-07-10", completedOn: null }, // due on the as-of date
      { dueDate: "2026-07-20", completedOn: "2026-07-02" }, // done early, not yet due
      { dueDate: null, completedOn: "2026-07-03" }, // not in plan
    ];

    expect(chapterProgress(chapters, "2026-07-10")).toEqual({ due: 4, done: 2, behind: 2 });
  });

  it.each([
    [0, { tone: "green", label: "On track" }],
    [1, { tone: "amber", label: "1 behind" }],
    [2, { tone: "amber", label: "2 behind" }],
    [3, { tone: "red", label: "3 behind" }],
    [12, { tone: "red", label: "12 behind" }],
  ])("shows %i behind as %j", (behind, expected) => {
    expect(behindPill(behind)).toEqual(expected);
  });
});

describe("uncovered tracks", () => {
  const tracksWithContent = ["jee_main", "jee_advanced", "neet"];

  it.each([
    { mapped: ["jee_main", "neet"], planTracks: ["jee_main", "jee_advanced", "neet"], expected: [] },
    { mapped: ["jee_main", "neet"], planTracks: ["jee_main"], expected: ["neet"] },
    { mapped: ["jee_main", "cet"], planTracks: ["jee_main", "neet"], expected: ["cet"] },
    {
      mapped: ["neet", "math_foundation", "jee_advanced"],
      planTracks: ["jee_main"],
      expected: ["jee_advanced", "neet", "math_foundation"],
    },
  ])("for mapped $mapped against a plan serving $planTracks → $expected", ({ mapped, planTracks, expected }) => {
    expect(uncoveredExamTracks(mapped, planTracks, tracksWithContent)).toEqual(expected);
  });

  it("flags a served track that has no in-syllabus content for the Grade", () => {
    expect(uncoveredExamTracks(["neet"], ["neet"], ["jee_main"])).toEqual(["neet"]);
  });
});
