import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bigquery", () => ({
  getBigQueryClient: () => ({ query }),
  FACT_TABLE: "`fact_overall`",
  FACT_QUESTION_LEVEL_TABLE: "`fact_question`",
  DIM_STUDENT_TABLE: "`dim_student`",
  SUBMITTED_ONLY: "AND has_quiz_ended IS NOT FALSE",
}));

import {
  comparisonPrograms,
  getSessionCmsTest,
  getChapterTestReport,
  getCmsTestChapters,
  getSessionQuestionStats,
  priorityForStream,
} from "./question-analytics";

const SCOPE = { udise: "2332", grade: 12, sessionId: "EMRS_1", program: "EMRS CoE", stream: "engineering" };

const QUESTION_ROWS = [
  {
    question_id: "qa",
    question_source: "nex-gen-cms",
    question_source_id: "9248",
    position: 0,
    difficulty: "easy",
    subject: "Physics",
    responses: 48,
    attempted: 47,
    correct: 43,
    skipped: 1,
    avg_time_seconds: 282.49,
    topics: ["Interference"],
  },
  {
    question_id: "qb",
    question_source: "cms",
    question_source_id: "64ab",
    position: "1",
    difficulty: null,
    subject: "Physics",
    responses: 48,
    attempted: 0,
    correct: 0,
    skipped: 48,
    avg_time_seconds: null,
    topics: null,
  },
];

const SUMMARY_ROWS = [
  {
    gender: "female", students: 19, avg_attempt_rate: 43.62, avg_accuracy: 73.15, avg_score: 29.43,
    accuracy_students: 19, stream_students: 18, program: "EMRS CoE",
    total_time_seconds: 19 * 3452, timed_students: 19,
    cms_test_id: "9330", test_name: "12P24 - Wave Optics - JEE Main", test_format: "chapter_test",
    start_date: "2026-10-14", test_grade: 12, test_stream: "engineering", test_course: "JEE Mains",
    total_questions: 25, max_marks: 100,
  },
  {
    gender: "male", students: 29, avg_attempt_rate: 47.31, avg_accuracy: 56.55, avg_score: 22.48,
    accuracy_students: 29, stream_students: 29, program: "EMRS CoE",
    total_time_seconds: 29 * 3495, timed_students: 29,
    cms_test_id: "9330", test_name: "12P24 - Wave Optics - JEE Main", test_format: "chapter_test",
    start_date: "2026-10-14", test_grade: 12, test_stream: "engineering", test_course: "JEE Mains",
    total_questions: 25, max_marks: 100,
  },
];

const CHAPTER_ROW = {
  pk_test_id: 9330, chapter_code: "12P24", chapter_name: "Wave Optics", subject_name: "Physics",
  priority_engineering: "Medium", priority_medical: "Low", duration_minutes: 60,
};

/** Answers each query by the table it reads, so call order does not matter. */
function answerByTable() {
  query.mockImplementation(async ({ query: sql }: { query: string }) => {
    if (sql.includes("`fact_question`")) return [QUESTION_ROWS];
    if (sql.includes("GROUP BY gender")) return [SUMMARY_ROWS];
    if (sql.includes("`dim_student`")) return [[{ total: 53 }]];
    if (sql.includes("cms_test_id = @cmsTestId")) {
      return [[
        { school: "JNV Kohima", udise: "1307", program: "JNV CoE", students: 9, avg_attempt_rate: 49.33, avg_accuracy: 61.5, avg_score: 26 },
        { school: "EMRS Bhopal", udise: "2332", program: "EMRS CoE", students: 48, avg_attempt_rate: 45.8, avg_accuracy: 63.1, avg_score: 25.2 },
      ]];
    }
    if (sql.includes("dim_test")) return [[CHAPTER_ROW]];
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
}

beforeEach(() => {
  query.mockReset();
});

describe("getSessionQuestionStats", () => {
  it("reads one partition of the question fact and maps the rows", async () => {
    answerByTable();
    const stats = await getSessionQuestionStats(SCOPE);

    const { query: sql, params } = query.mock.calls[0][0];
    expect(sql).toContain("hashed_session_id = MOD(ABS(FARM_FINGERPRINT(@sessionId)), 4000) + 1");
    expect(sql).toContain("AND student_program = @program");
    expect(sql).toContain("AND LOWER(student_stream) = @stream");
    expect(params).toEqual({ udise: "2332", grade: 12, sessionId: "EMRS_1", program: "EMRS CoE", stream: "engineering" });

    expect(stats[0]).toEqual({
      question_id: "qa", cms_question_id: 9248, position: 0, difficulty: "easy", subject: "Physics",
      topics: ["Interference"], responses: 48, attempted: 47, correct: 43, incorrect: 4, skipped: 1,
      avg_time_seconds: 282,
    });
    // Old-CMS question: no CMS id, no topics.
    expect(stats[1]).toMatchObject({ cms_question_id: null, position: 1, topics: [], difficulty: null });
  });

  it("leaves program and stream out when not given", async () => {
    answerByTable();
    await getSessionQuestionStats({ udise: "2332", grade: 12, sessionId: "EMRS_1" });
    const { query: sql, params } = query.mock.calls[0][0];
    expect(sql).not.toContain("@program");
    expect(sql).not.toContain("@stream");
    expect(params).toEqual({ udise: "2332", grade: 12, sessionId: "EMRS_1" });
  });
});

describe("getChapterTestReport", () => {
  it("combines the class before rounding and joins the CMS chapter", async () => {
    answerByTable();
    const report = await getChapterTestReport(SCOPE);
    expect(report).not.toBeNull();
    const r = report!;

    expect(r.test).toMatchObject({
      test_name: "12P24 - Wave Optics - JEE Main", cms_test_id: "9330", exam: "JEE Mains",
      subject: "Physics", chapter_code: "12P24", chapter_name: "Wave Optics", priority: "Medium",
      duration_minutes: 60, total_questions: 25, max_marks: 100,
    });
    expect(r.overview).toEqual({
      students: 48, avg_attempt_rate: 45.8, avg_accuracy: 63.1, avg_score: 25.2,
      // Students in the test's stream who submitted: one is from another stream.
      appeared: 47, enrolled: 53, avg_time_minutes: 58,
    });
    expect(r.gender.map((g) => [g.gender, g.avg_accuracy])).toEqual([["female", 73.2], ["male", 56.6]]);
    // This School's row is the report's own cohort, matching the overview.
    expect(r.comparison.find((c) => c.is_this_school)).toMatchObject({
      school: "EMRS Bhopal", students: 48, avg_attempt_rate: 45.8, avg_accuracy: 63.1, avg_score: 25.2,
    });
    expect(r.questions).toHaveLength(2);
  });

  it("compares with Schools of the same model, grade and stream", async () => {
    answerByTable();
    await getChapterTestReport(SCOPE);
    const call = query.mock.calls.find(([c]) => c.query.includes("cms_test_id = @cmsTestId"))!;
    const { query: sql, params } = call[0];
    expect(sql).toContain("student_program IN UNNEST(@programs)");
    expect(sql).toContain("student_grade = @grade");
    expect(sql).toContain("LOWER(student_stream) = @stream");
    expect(params).toMatchObject({ cmsTestId: "9330", grade: 12, stream: "engineering" });
    expect(params.programs).toContain("JNV CoE");
    expect(params.programs).not.toContain("JNV Nodal");
  });

  it("shows no comparison for a program that is neither CoE nor Nodal", async () => {
    answerByTable();
    const report = await getChapterTestReport({ ...SCOPE, program: "Maharashtra Coaching Test Prep" });
    expect(report!.comparison).toEqual([]);
    expect(query.mock.calls.some(([c]) => c.query.includes("cms_test_id = @cmsTestId"))).toBe(false);
  });

  it("returns null when the session has no submitted results", async () => {
    query.mockImplementation(async ({ query: sql }: { query: string }) =>
      sql.includes("GROUP BY gender") ? [[]] : [[]],
    );
    expect(await getChapterTestReport(SCOPE)).toBeNull();
  });
});

describe("getCmsTestChapters", () => {
  it("looks up numeric ids only, once each", async () => {
    answerByTable();
    const map = await getCmsTestChapters(["9330", "9330", "64abcdef"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0].params).toEqual({ ids: [9330] });
    expect(map.get("9330")?.chapter_name).toBe("Wave Optics");
  });

  it("does not query when no id is a new-CMS id", async () => {
    expect((await getCmsTestChapters(["64abcdef"])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("priorityForStream", () => {
  const chapter = {
    chapter_code: null, chapter_name: null, subject: null,
    priority_engineering: "High", priority_medical: "Low", duration_minutes: null,
  };
  it("uses the NEET priority for medical tests and the JEE one otherwise", () => {
    expect(priorityForStream(chapter, "medical")).toBe("Low");
    expect(priorityForStream(chapter, "engineering")).toBe("High");
    expect(priorityForStream(chapter, null)).toBe("High");
    expect(priorityForStream(undefined, "medical")).toBeNull();
  });
});

describe("getSessionCmsTest", () => {
  it("reads the session's CMS test from one partition, checking the question when given", async () => {
    query.mockResolvedValue([[{ cms_test_id: "9330" }]]);
    expect(await getSessionCmsTest(SCOPE, 9248)).toBe("9330");
    const { query: sql, params } = query.mock.calls[0][0];
    expect(sql).toContain("hashed_session_id = MOD(ABS(FARM_FINGERPRINT(@sessionId)), 4000) + 1");
    expect(sql).toContain("AND question_source_id = @questionId");
    expect(sql).toContain("student_school_udise_code = @udise");
    expect(params).toMatchObject({ udise: "2332", sessionId: "EMRS_1", questionId: "9248" });
  });

  it("is null for a session with no new-CMS test", async () => {
    query.mockResolvedValue([[{ cms_test_id: null }]]);
    expect(await getSessionCmsTest(SCOPE)).toBeNull();
    query.mockResolvedValue([[{ cms_test_id: "64abcdef" }]]);
    expect(await getSessionCmsTest(SCOPE)).toBeNull();
    expect(query.mock.calls[0][0].query).not.toContain("@questionId");
  });
});

describe("comparisonPrograms", () => {
  it("groups CoEs with CoEs and Nodals with Nodals", () => {
    expect(comparisonPrograms("EMRS CoE")).toEqual(expect.arrayContaining(["JNV CoE", "Punjab CoE", "EMRS CoE"]));
    expect(comparisonPrograms("JNV CoE")).not.toContain("JNV Nodal");
    expect(comparisonPrograms("JNV Nodal")).toEqual(["JNV Nodal", "Punjab Nodal"]);
  });

  it("is empty for any other program", () => {
    expect(comparisonPrograms("JNV NVS")).toEqual([]);
    expect(comparisonPrograms("Maharashtra Coaching Test Prep")).toEqual([]);
    expect(comparisonPrograms(null)).toEqual([]);
  });
});
