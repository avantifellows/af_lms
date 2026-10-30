import { beforeEach, describe, expect, it, vi } from "vitest";

const bq = vi.hoisted(() => vi.fn());
const cumulative = vi.hoisted(() => vi.fn());
const pg = vi.hoisted(() => vi.fn());

vi.mock("./bigquery", () => ({
  getBigQueryClient: () => ({ query: bq }),
  getCumulativeALData: cumulative,
  DIM_STUDENT_TABLE: "`dim_student`",
  FACT_TABLE: "`fact_overall`",
  FACT_QUESTION_LEVEL_TABLE: "`fact_question`",
  MAJOR_TEST_FORMATS: ["major_test", "mock_test"],
  SUBMITTED_ONLY: "AND has_quiz_ended IS NOT FALSE",
}));
vi.mock("./db", () => ({ query: pg }));

type Module = typeof import("./student-support");
let mod: Module;

interface Reads {
  students?: object[];
  cutoffs?: object[];
  tests?: object[];
  chapters?: object[];
}

/** Answers each BigQuery read by what it reads. */
function warehouse(reads: Reads) {
  bq.mockImplementation(async ({ query }: { query: string }) => {
    if (query.includes("`dim_student`")) return [reads.students ?? []];
    if (query.includes("dim_test_cutoffs")) return [reads.cutoffs ?? []];
    if (query.includes("WITH results AS")) return [reads.tests ?? []];
    if (query.includes("WITH answers AS")) return [reads.chapters ?? []];
    throw new Error(`unexpected read: ${query}`);
  });
}

const callsTo = (marker: string) =>
  bq.mock.calls.map(([arg]) => arg).filter((arg: { query: string }) => arg.query.includes(marker));

const ASHA = {
  uid: "101",
  student_id: "S101",
  name: " Asha ",
  gender: "Female",
  stream: "PCM",
  category: "Gen",
  mode_al: "M2",
  predicted_al: "M1",
  predicted_pct: "92.5",
};

const CUTOFFS = [
  { test_stream: "engineering", category: "Gen ", academic_level: "M1", cutoff_marks: "150" },
  { test_stream: "medical", category: "Gen", academic_level: "B1", cutoff_marks: "400" },
];

beforeEach(async () => {
  vi.resetAllMocks();
  // The caches live in the module: a fresh copy per test.
  vi.resetModules();
  mod = await import("./student-support");
});

describe("getScoreJourney", () => {
  beforeEach(() => {
    warehouse({
      students: [
        ASHA,
        {
          uid: "102", student_id: null, name: null, gender: null, stream: "Arts", category: null,
          mode_al: null, predicted_al: null, predicted_pct: null,
        },
      ],
      cutoffs: CUTOFFS,
    });
    cumulative.mockResolvedValue({
      tests: [
        { session_id: "t1", test_name: "FT 1", start_date: "2026-07-01", stream: "engineering" },
        { session_id: "t2", test_name: "FT 2", start_date: "2026-08-01", stream: null },
        { session_id: "t3", test_name: "FT 3", start_date: "2026-08-15", stream: null },
        { session_id: "t4", test_name: "FT 4", start_date: "2026-09-01", stream: null },
        { session_id: "t5", test_name: "FT 5", start_date: "2026-09-15", stream: null },
      ],
      students: [
        {
          student_id: "101",
          stream: "PCM",
          progression: [
            { session_id: "t1", academic_level: "M2", marks_scored: 100, max_marks_possible: 300 },
            { session_id: "t2", academic_level: "Not Qualified", marks_scored: 40, max_marks_possible: 300 },
            { session_id: "t3", academic_level: "Not Eligible for Academic Level", marks_scored: 10, max_marks_possible: 300 },
            { session_id: "t4", academic_level: "M1", marks_scored: null, max_marks_possible: 300 },
            { session_id: "t5", academic_level: "M1", marks_scored: 200, max_marks_possible: 0 },
          ],
        },
      ],
    });
  });

  it("reads the grade's enrolled students in the stream, and the cumulative AL with the test grade", async () => {
    await mod.getScoreJourney("70705", 12, "JNV CoE", "engineering", 11);

    const [students] = callsTo("`dim_student`");
    expect(students.params).toEqual({ udise: "70705", grade: 12, program: "JNV CoE", stream: "engineering" });
    expect(students.query).toContain("LOWER(student_stream) = @stream");
    expect(students.query).not.toContain("@uid");
    expect(cumulative).toHaveBeenCalledWith("70705", 12, "JNV CoE", "engineering", 11);
  });

  it("leaves the stream filter out when no stream is asked for", async () => {
    await mod.getScoreJourney("70705", 12, "JNV CoE");
    const [students] = callsTo("`dim_student`");
    expect(students.params).toEqual({ udise: "70705", grade: 12, program: "JNV CoE" });
    expect(students.query).not.toContain("@stream");
  });

  it("shapes a row per student from the levelled tests and the cutoffs", async () => {
    const data = await mod.getScoreJourney("70705", 12, "JNV CoE", "engineering");

    expect(data.tests).toEqual([
      { sessionId: "t1", name: "FT 1", date: "2026-07-01", stream: "engineering" },
      { sessionId: "t2", name: "FT 2", date: "2026-08-01", stream: null },
      { sessionId: "t3", name: "FT 3", date: "2026-08-15", stream: null },
      { sessionId: "t4", name: "FT 4", date: "2026-09-01", stream: null },
      { sessionId: "t5", name: "FT 5", date: "2026-09-15", stream: null },
    ]);
    const [asha, other] = data.students;
    expect(asha).toMatchObject({
      uid: "101",
      studentId: "S101",
      name: "Asha",
      examStream: "engineering",
      predicted: "M1",
      predictedPct: 92.5,
      mode: "M2",
      status: "Sliding",
      // Not Qualified reads as M3; an unlevelled or unmarked test is left out.
      last3: ["M2", "M3", "M1"],
      latestPct: null,
    });
    // Median of 100, 40, 200 = 100; the M1 cutoff 150 is 50 marks = 13 questions away.
    expect(asha.toNext).toEqual({
      kind: "count", questions: 13, median: 100, cutoff: 150, nextLevel: "M1", tests: ["FT 1", "FT 2", "FT 5"],
    });
    // Every test's raw result, levelled or not.
    expect(Object.keys(asha.results)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    expect(asha.results.t2).toEqual({ level: "Not Qualified", marks: 40, max: 300 });

    // No name, no tests; no usable stream reads as engineering.
    expect(other).toMatchObject({
      uid: "102", name: "102", examStream: "engineering", status: null, last3: [], latestPct: null,
      predictedPct: null, toNext: { kind: "none" }, results: {},
    });
  });

  it("counts only the student's own stream's tests, so the journey agrees with the report", async () => {
    warehouse({
      students: [ASHA, { ...ASHA, uid: "103", stream: "PCB" }, { ...ASHA, uid: "104", stream: null }],
      cutoffs: CUTOFFS,
    });
    const sittings = [
      { session_id: "jee", academic_level: "Not Qualified", marks_scored: 20, max_marks_possible: 300 },
      { session_id: "neet", academic_level: "B1", marks_scored: 600, max_marks_possible: 720 },
      { session_id: "any", academic_level: "M2", marks_scored: 100, max_marks_possible: 300 },
    ];
    cumulative.mockResolvedValue({
      tests: [
        { session_id: "jee", test_name: "JEE FT", start_date: "2026-07-01", stream: "engineering" },
        { session_id: "neet", test_name: "NEET FT", start_date: "2026-07-02", stream: "medical" },
        { session_id: "any", test_name: "Common FT", start_date: "2026-07-03", stream: null },
      ],
      students: ["101", "103", "104"].map((id) => ({ student_id: id, stream: null, progression: sittings })),
    });
    const { students } = await mod.getScoreJourney("70705", 12, "JNV CoE");
    const byUid = Object.fromEntries(students.map((s) => [s.uid, s]));
    // Engineering: the JEE paper and the common one, never the NEET paper.
    expect(byUid["101"].last3).toEqual(["M3", "M2"]);
    // Medical: a JEE "Not Qualified" is not a B3.
    expect(byUid["103"]).toMatchObject({ examStream: "medical", last3: ["B1", "M2"] });
    // No usable stream: engineering, as dbt defaults it.
    expect(byUid["104"]).toMatchObject({ examStream: "engineering", last3: ["M3", "M2"] });
  });

  it("orders tests on the same day by session id, whatever order the warehouse returns", async () => {
    const day = "2026-07-01";
    cumulative.mockResolvedValue({
      tests: [
        { session_id: "s3", test_name: "C", start_date: day, stream: null },
        { session_id: "s1", test_name: "A", start_date: day, stream: null },
        { session_id: "s2", test_name: "B", start_date: day, stream: null },
      ],
      students: [
        {
          student_id: "101",
          stream: "PCM",
          progression: [
            { session_id: "s3", academic_level: "M1", marks_scored: 200, max_marks_possible: 300 },
            { session_id: "s1", academic_level: "M3", marks_scored: 30, max_marks_possible: 300 },
            { session_id: "s2", academic_level: "M2", marks_scored: 100, max_marks_possible: 300 },
          ],
        },
      ],
    });
    const data = await mod.getScoreJourney("70705", 12, "JNV CoE");
    expect(data.tests.map((t) => t.sessionId)).toEqual(["s1", "s2", "s3"]);
    expect(data.students[0].last3).toEqual(["M3", "M2", "M1"]);
  });

  it("keeps the latest score as a percentage, rounded", async () => {
    cumulative.mockResolvedValue({
      tests: [],
      students: [
        {
          student_id: "101",
          stream: "PCM",
          progression: [{ session_id: "t1", academic_level: "M2", marks_scored: 100, max_marks_possible: 300 }],
        },
      ],
    });
    const data = await mod.getScoreJourney("70705", 12, "JNV CoE");
    expect(data.students[0].latestPct).toBe(33.3);
  });

  it("keeps a view per request, so a repeat call reads nothing", async () => {
    await mod.getScoreJourney("70705", 12, "JNV CoE", "engineering");
    await mod.getScoreJourney("70705", 12, "JNV CoE", "engineering");
    expect(cumulative).toHaveBeenCalledTimes(1);
    expect(callsTo("`dim_student`")).toHaveLength(1);
  });
});

// A full test's rows: the overall row plus a row per subject the student sat.
function testRow(over: Record<string, unknown>) {
  return {
    session_id: "a",
    hashed_session_id: 11,
    test_name: "FT A",
    start_date: "2026-07-01",
    test_course: "JEE Mains",
    test_format: "major_test",
    test_stream: "engineering",
    section: "overall",
    marks_scored: 90,
    max_marks_possible: 300,
    percentage: 30,
    num_correct: 25,
    num_wrong: 10,
    num_partially_correct: 0,
    num_skipped: 40,
    academic_level: "M3",
    centre_rank: 5,
    takers: 40,
    ...over,
  };
}

const TEST_ROWS = [
  testRow({ session_id: "adv", hashed_session_id: 14, test_name: "JEE Advanced Paper 1", start_date: "2026-09-15",
    test_course: "JEE Advanced", percentage: 50, academic_level: "M1" }),
  // Absent: the School sat it, the student has no rows.
  testRow({ session_id: "c", hashed_session_id: 13, test_name: "FT C", start_date: "2026-09-01", section: null,
    marks_scored: null, percentage: null, academic_level: null, centre_rank: null, takers: null }),
  testRow({ session_id: "b", hashed_session_id: 12, test_name: "FT B", start_date: { value: "2026-08-01" },
    marks_scored: 120, percentage: 40.04, academic_level: "M2", centre_rank: "3" }),
  testRow({ session_id: "b", hashed_session_id: 12, test_name: "FT B", start_date: { value: "2026-08-01" },
    section: "Maths", marks_scored: 50, percentage: 50 }),
  testRow({ session_id: "a", section: "Physics", marks_scored: 30, percentage: 30 }),
  testRow({ session_id: "a" }),
  testRow({ session_id: "a", section: "Chemistry", marks_scored: 20, percentage: 20 }),
  // The other stream's test: not this student's.
  testRow({ session_id: "n", hashed_session_id: 15, test_name: "NEET 1", test_course: "NEET", test_stream: "medical" }),
  // A chapter test: chapter answers, not test history.
  testRow({ session_id: "ch", hashed_session_id: 16, test_name: "12P01 Electrostatics", test_format: "chapter_test",
    test_stream: null, section: "Physics", start_date: "2026-07-10" }),
  // A baseline: test history, but not chapter competency.
  testRow({ session_id: "base", hashed_session_id: 17, test_name: "Baseline Test", start_date: "2026-06-01",
    marks_scored: 60, percentage: 20, academic_level: "Not Qualified" }),
];

function chapterRow(over: Record<string, unknown>) {
  return {
    test_course: "JEE Mains",
    section: "Physics",
    chapter_key: "12P01",
    chapter_name: "Electrostatics",
    chapter_code: "12P01",
    priority: "High",
    topic_code: null,
    topic_name: null,
    n: 0,
    attempted: 0,
    correct: 0,
    marks: 0,
    max_marks: 0,
    sessions: ["a"],
    ...over,
  };
}

const CHAPTER_ROWS = [
  chapterRow({ topic_code: "JM-2", topic_name: null, n: 2, attempted: 2, correct: 2, marks: 8, max_marks: 8, sessions: ["a", "b"] }),
  chapterRow({ topic_code: "JM-1", topic_name: "Coulomb's law", n: 4, attempted: 4, correct: 1, marks: 0, max_marks: 16 }),
  chapterRow({ n: 2, attempted: 0, correct: 0, marks: 0, max_marks: 8, sessions: ["b", "ch"] }),
  chapterRow({ section: "Chemistry", chapter_key: "legacy-7", chapter_name: null, chapter_code: null, priority: null,
    n: 2, attempted: 1, correct: 1, marks: 4, max_marks: 8, sessions: null }),
  chapterRow({ test_course: "JEE Advanced", n: 3, attempted: 3, correct: 3, marks: 9, max_marks: 9, sessions: ["adv"] }),
];

describe("getStudentReport", () => {
  beforeEach(() => {
    warehouse({ students: [ASHA], cutoffs: CUTOFFS, tests: TEST_ROWS, chapters: CHAPTER_ROWS });
    pg.mockResolvedValue([
      { code: "12P01", url: "https://pyq/1" },
      { code: "12P01", url: "https://pyq/2" },
      { code: "11C02", url: "https://pyq/3" },
    ]);
  });

  it("reads one enrolled student and the School's tests, then that student's chapter answers", async () => {
    await mod.getStudentReport("70705", 12, "JNV CoE", "101");

    const [student] = callsTo("`dim_student`");
    expect(student.params).toEqual({ udise: "70705", grade: 12, program: "JNV CoE", uid: 101 });
    expect(student.query).toContain("enrollment_user_id = @uid");
    expect(callsTo("WITH results AS")[0].params).toEqual({ udise: "70705", grade: 12, program: "JNV CoE", uid: "101" });

    const [chapters] = callsTo("WITH answers AS");
    expect(chapters.query).toContain("priority_engineering");
    // Only the sessions the student sat in their stream, baselines left out.
    expect(chapters.params).toEqual({
      uid: 101,
      courses: ["JEE Mains", "JEE Advanced"],
      formats: ["major_test", "mock_test", "chapter_test"],
      hashes: [14, 12, 11, 16],
      sessions: ["adv", "b", "a", "ch"],
    });
  });

  it("is null for a student who isn't enrolled in this grade", async () => {
    warehouse({ students: [], cutoffs: CUTOFFS, tests: TEST_ROWS });
    await expect(mod.getStudentReport("70705", 12, "JNV CoE", "999")).resolves.toBeNull();
    expect(callsTo("WITH answers AS")).toHaveLength(0);
  });

  it("reads a student with no usable stream as engineering, as dbt does", async () => {
    for (const stream of ["Arts", null]) {
      bq.mockReset();
      vi.resetModules();
      mod = await import("./student-support");
      warehouse({ students: [{ ...ASHA, stream }], cutoffs: CUTOFFS, tests: TEST_ROWS, chapters: [] });
      const report = (await mod.getStudentReport("70705", 12, "JNV CoE", "101"))!;
      expect(report.student).toMatchObject({ examStream: "engineering", last3: ["M3", "M3", "M2"] });
      expect(report.tests.map((t) => t.sessionId)).toEqual(["adv", "c", "b", "a", "base"]);
      expect(callsTo("WITH answers AS")[0].params.courses).toEqual(["JEE Mains", "JEE Advanced"]);
    }
  });

  it("orders same-day tests by session id in the history and the level journey", async () => {
    const day = { start_date: "2026-08-01", hashed_session_id: 20 };
    warehouse({
      students: [ASHA],
      cutoffs: CUTOFFS,
      chapters: [],
      tests: [
        testRow({ ...day, session_id: "s2", test_name: "FT 2", academic_level: "M2", marks_scored: 100 }),
        testRow({ ...day, session_id: "s3", test_name: "FT 3", academic_level: "M1", marks_scored: 200 }),
        testRow({ ...day, session_id: "s1", test_name: "FT 1", academic_level: "M3", marks_scored: 30 }),
      ],
    });
    const report = (await mod.getStudentReport("70705", 12, "JNV CoE", "101"))!;
    expect(report.tests.map((t) => t.sessionId)).toEqual(["s3", "s2", "s1"]);
    expect(report.student.last3).toEqual(["M3", "M2", "M1"]);
  });

  it("asks a medical student's chapters for NEET with the medical priority", async () => {
    warehouse({ students: [{ ...ASHA, stream: "PCB" }], cutoffs: CUTOFFS, tests: TEST_ROWS, chapters: [] });
    await mod.getStudentReport("70705", 12, "JNV CoE", "101");
    const [chapters] = callsTo("WITH answers AS");
    expect(chapters.query).toContain("priority_medical");
    expect(chapters.params.courses).toEqual(["NEET"]);
    expect(chapters.params.sessions).toEqual(["n", "ch"]);
  });

  it("levels the student from their full tests, oldest first, Advanced left out", async () => {
    const { student } = (await mod.getStudentReport("70705", 12, "JNV CoE", "101"))!;
    expect(student).toMatchObject({ name: "Asha", last3: ["M3", "M3", "M2"], latestPct: 40, results: {} });
    // Median of 60, 90, 120 = 90; the M1 cutoff 150 is 15 questions away.
    expect(student.toNext).toEqual({
      kind: "count", questions: 15, median: 90, cutoff: 150, nextLevel: "M1", tests: ["Baseline Test", "FT A", "FT B"],
    });
  });

  it("lists every full test newest first, with absences, subjects A–Z and change per exam", async () => {
    const { tests } = (await mod.getStudentReport("70705", 12, "JNV CoE", "101"))!;
    expect(tests.map((t) => [t.sessionId, t.exam, t.absent, t.change])).toEqual([
      ["adv", "JEE Advanced", false, null],
      ["c", "JEE Main", true, null],
      ["b", "JEE Main", false, 10],
      ["a", "JEE Main", false, 10],
      ["base", "JEE Main", false, null],
    ]);
    const b = tests[2];
    expect(b).toMatchObject({ date: "2026-08-01", level: "M2", rank: 3, takers: 40 });
    expect(b.overall).toEqual({ marks: 120, max: 300, pct: 40, correct: 25, wrong: 10, partial: 0, skipped: 40 });
    expect(tests[3].subjects.map((s) => [s.subject, s.marks])).toEqual([["Chemistry", 20], ["Physics", 30]]);
    expect(tests[1]).toMatchObject({ overall: null, level: null, rank: null, subjects: [] });
  });

  it("groups chapter answers by exam and subject, with flags, weakest topics first and PYQ links", async () => {
    const { chapters } = (await mod.getStudentReport("70705", 12, "JNV CoE", "101"))!;
    expect(chapters.map((e) => [e.exam, e.subjects.map((s) => s.subject)])).toEqual([
      ["JEE Main", ["Chemistry", "Physics"]],
      ["JEE Advanced", ["Physics"]],
    ]);

    const physics = chapters[0].subjects[1];
    expect(physics).toMatchObject({ passMark: 35, answers: 8, attempt: 75, accuracy: 50 });
    expect(physics.chapters).toHaveLength(1);
    const [ch] = physics.chapters;
    // 8 of 32 marks is 25%, under 35 with accuracy 50%: a concept gap.
    expect(ch).toMatchObject({
      key: "12P01", code: "12P01", name: "Electrostatics", priority: "High",
      n: 8, attempt: 75, accuracy: 50, score: 25, tests: 3, flag: "C",
      pyq: ["https://pyq/1", "https://pyq/2"],
    });
    // The untagged answers stay in the chapter but aren't a topic.
    expect(ch.topics).toEqual([
      { code: "JM-1", name: "Coulomb's law", n: 4, attempt: 100, accuracy: 25, score: 0, flag: "C" },
      { code: "JM-2", name: "JM-2", n: 2, attempt: 100, accuracy: 100, score: 100, flag: null },
    ]);

    const [legacy] = chapters[0].subjects[0].chapters;
    expect(legacy).toMatchObject({ key: "legacy-7", code: null, name: "legacy-7", flag: null, pyq: [], topics: [], tests: 0 });

    // Advanced has its own pass mark; 100% is not flagged.
    expect(chapters[1].subjects[0]).toMatchObject({ passMark: 30, chapters: [expect.objectContaining({ flag: null, score: 100 })] });
  });

  it("reads cutoffs and PYQ links once across reports", async () => {
    await mod.getStudentReport("70705", 12, "JNV CoE", "101");
    await mod.getStudentReport("70705", 12, "JNV CoE", "102");
    expect(callsTo("dim_test_cutoffs")).toHaveLength(1);
    expect(pg).toHaveBeenCalledTimes(1);
    expect(callsTo("`dim_student`")).toHaveLength(2);
  });
});
