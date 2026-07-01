import { describe, it, expect, vi, beforeEach } from "vitest";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

// --- Hoisted mocks ---

const mocks = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(function () {
    return { __type: "DynamoDBClient" };
  }),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mocks.mockSend })),
  },
  QueryCommand: vi.fn(function (params: unknown) {
    return { __type: "QueryCommand", params };
  }),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.mockQuery,
}));

beforeEach(() => {
  vi.resetModules();
  mocks.mockSend.mockReset();
  mocks.mockQuery.mockReset();
  // Default for queries beyond the roster fetch (e.g. the multi-school
  // issue check inside processStudents).
  mocks.mockQuery.mockResolvedValue([]);
});

// --- Helper factories ---

// Roster-shaped row, as returned by the canonical school-roster query that
// the deep-dive now shares with the Enrollment tab.
function makeStudent(overrides: Partial<{
  group_user_id: string;
  user_id: string;
  student_id: string | null;
  apaar_id: string | null;
  first_name: string;
  last_name: string | null;
  gender: string | null;
  stream: string | null;
  grade: number | null;
  status: string | null;
  program_name: string | null;
  program_id: number | null;
}> = {}) {
  const user_id = overrides.user_id ?? "user-1";
  return {
    group_user_id: `gu-${user_id}`,
    user_id,
    student_pk_id: null,
    student_id: "stu-1",
    apaar_id: "apaar-1",
    first_name: "Alice",
    last_name: "Smith",
    phone: null,
    email: null,
    date_of_birth: null,
    category: null,
    gender: "female",
    stream: null,
    grade: 10,
    grade_id: null,
    status: null,
    program_name: null,
    program_id: null,
    updated_at: null,
    ...overrides,
  };
}

// One v2 document (one per session × student).
function makeV2Doc(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "sess-1",
    user_id: "enrollment-u1",
    student_id: "stu-1",
    apaar_id: "apaar-1",
    report_header: { test_name: "Mid-Term Physics", test_date: "2026-01-15" },
    overall_performance: {
      marks_scored: 80,
      max_marks_possible: 100,
      percentage: 80,
      accuracy: 75,
      num_correct: 15,
      num_wrong: 3,
      num_skipped: 2,
      total_questions: 20,
    },
    subject_performance: [
      {
        subject: "Physics",
        marks_scored: 30,
        max_marks_possible: 40,
        percentage: 75,
        accuracy: 70,
        num_correct: 7,
        num_wrong: 2,
        num_skipped: 1,
        total_questions: 10,
      },
    ],
    chapter_performance: [
      {
        chapter_name: "Mechanics",
        chapter_id: "chap-mech",
        subject: "Physics",
        marks_scored: 8,
        max_marks_possible: 10,
        percentage: 80,
        accuracy: 80,
        total_questions: 5,
        num_correct: 4,
        num_wrong: 1,
        num_skipped: 0,
      },
    ],
    ...overrides,
  };
}

// --- Tests ---

describe("getTestDeepDiveFromDynamo (v2)", () => {
  async function importModule() {
    return import("./dynamodb");
  }

  describe("Postgres roster lookup", () => {
    it("uses the canonical school-roster query (current academic year, no grade param)", async () => {
      mocks.mockQuery.mockResolvedValueOnce([]);

      const { getTestDeepDiveFromDynamo } = await importModule();
      await getTestDeepDiveFromDynamo("school-abc", "JNV Test", 10, "sess-1");

      expect(mocks.mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mocks.mockQuery.mock.calls[0];
      expect(sql).toContain("g.type = 'school' AND g.child_id = $1");
      expect(sql).toContain("er.academic_year = $2");
      expect(params).toEqual(["school-abc", CURRENT_ACADEMIC_YEAR]);
    });

    it("returns null + skips DynamoDB when Postgres returns no students", async () => {
      mocks.mockQuery.mockResolvedValueOnce([]);

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");

      expect(result).toBeNull();
      expect(mocks.mockSend).not.toHaveBeenCalled();
    });

    it("only includes roster students of the requested grade", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ user_id: "u-g10", student_id: "stu-g10", apaar_id: null, first_name: "Tenth", grade: 10 }),
        makeStudent({ user_id: "u-g12", student_id: "stu-g12", apaar_id: null, first_name: "Twelfth", grade: 12 }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({ student_id: "stu-g10", apaar_id: "", user_id: "u-g10" }),
          makeV2Doc({ student_id: "stu-g12", apaar_id: "", user_id: "u-g12" }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.students).toHaveLength(1);
      expect(result!.students[0].student_name).toBe("Tenth Smith");
    });

    it("excludes dropout students even when they have a report doc", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ user_id: "u-active", student_id: "stu-active", apaar_id: null, first_name: "Active" }),
        makeStudent({ user_id: "u-drop", student_id: "stu-drop", apaar_id: null, first_name: "Gone", status: "dropout" }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({ student_id: "stu-active", apaar_id: "", user_id: "u-active" }),
          makeV2Doc({ student_id: "stu-drop", apaar_id: "", user_id: "u-drop" }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.students).toHaveLength(1);
      expect(result!.students[0].student_name).toBe("Active Smith");
    });

    it("applies program (attributed name) and stream (case-insensitive) filters", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ user_id: "u-1", student_id: "stu-1", apaar_id: null, first_name: "Match", program_name: "CoE", stream: "PCM" }),
        makeStudent({ user_id: "u-2", student_id: "stu-2", apaar_id: null, first_name: "OtherProgram", program_name: "NVS", stream: "PCM" }),
        makeStudent({ user_id: "u-3", student_id: "stu-3", apaar_id: null, first_name: "OtherStream", program_name: "CoE", stream: "PCB" }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({ student_id: "stu-1", apaar_id: "", user_id: "u-1" }),
          makeV2Doc({ student_id: "stu-2", apaar_id: "", user_id: "u-2" }),
          makeV2Doc({ student_id: "stu-3", apaar_id: "", user_id: "u-3" }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo(
        "school-1",
        "JNV Test",
        10,
        "sess-1",
        "CoE",
        "pcm"
      );

      expect(result).not.toBeNull();
      expect(result!.students).toHaveLength(1);
      expect(result!.students[0].student_name).toBe("Match Smith");
    });
  });

  describe("v2 DynamoDB read", () => {
    it("queries the school_session_index GSI first with school + session", async () => {
      mocks.mockQuery.mockResolvedValueOnce([makeStudent()]);
      // GSI returns the doc on first call → no fallback
      mocks.mockSend.mockResolvedValueOnce({ Items: [makeV2Doc()] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");

      const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: "student_quiz_reports_v2",
          IndexName: "school_session_index",
          KeyConditionExpression: "school = :school AND session_id = :sid",
          ExpressionAttributeValues: { ":school": "JNV Test", ":sid": "sess-1" },
        })
      );
      expect(mocks.mockSend).toHaveBeenCalledTimes(1);
    });

    it("falls back to the session partition scan when the GSI returns empty", async () => {
      const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
      const qcMock = QueryCommand as unknown as { mock: { calls: unknown[][] } };
      const callsBefore = qcMock.mock.calls.length;

      mocks.mockQuery.mockResolvedValueOnce([makeStudent()]);
      // GSI → empty; fallback partition scan → returns the matching doc
      mocks.mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [makeV2Doc()] });

      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      consoleWarn.mockRestore();

      expect(result).not.toBeNull();
      expect(mocks.mockSend).toHaveBeenCalledTimes(2);

      // The two QueryCommand calls this test triggered.
      const thisRunCalls = qcMock.mock.calls.slice(callsBefore);
      expect(thisRunCalls).toHaveLength(2);
      const [gsiCall, fallbackCall] = thisRunCalls.map(
        (c) => c[0] as { IndexName?: string; KeyConditionExpression: string }
      );
      expect(gsiCall.IndexName).toBe("school_session_index");
      expect(fallbackCall.IndexName).toBeUndefined();
      expect(fallbackCall.KeyConditionExpression).toBe("session_id = :sid");
    });

    it("paginates with LastEvaluatedKey on the GSI", async () => {
      mocks.mockQuery.mockResolvedValueOnce([makeStudent()]);
      mocks.mockSend
        .mockResolvedValueOnce({
          Items: [makeV2Doc()],
          LastEvaluatedKey: { school: "JNV Test", session_id: "sess-1", user_id: "x" },
        })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");

      expect(mocks.mockSend).toHaveBeenCalledTimes(2);
      expect(result).not.toBeNull();
    });

    it("returns null on DynamoDB error", async () => {
      mocks.mockQuery.mockResolvedValueOnce([makeStudent()]);
      // GSI throws → paginatedQuery swallows + returns []. Fallback then also
      // runs; throw there too so the overall result is null.
      mocks.mockSend
        .mockRejectedValueOnce(new Error("DynamoDB timeout"))
        .mockRejectedValueOnce(new Error("DynamoDB timeout"));

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      consoleError.mockRestore();
      consoleWarn.mockRestore();

      expect(result).toBeNull();
    });

    it("returns null when both GSI and fallback come back empty", async () => {
      mocks.mockQuery.mockResolvedValueOnce([makeStudent()]);
      mocks.mockSend
        .mockResolvedValueOnce({ Items: [] }) // gsi
        .mockResolvedValueOnce({ Items: [] }); // fallback

      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      consoleWarn.mockRestore();

      expect(result).toBeNull();
    });
  });

  describe("identifier matching", () => {
    it("matches by student_id", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ student_id: "stu-A", apaar_id: null, user_id: "u-A" }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [makeV2Doc({ student_id: "stu-A", apaar_id: "", user_id: "irrelevant" })],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      expect(result).not.toBeNull();
      expect(result!.students.length).toBe(1);
    });

    it("matches by apaar_id when student_id misses", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ student_id: "stu-A", apaar_id: "apaar-X", user_id: "u-A" }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({ student_id: "different", apaar_id: "apaar-X", user_id: "different" }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      expect(result).not.toBeNull();
      expect(result!.students.length).toBe(1);
    });

    it("ignores v2 docs whose identifiers are not in the roster", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ student_id: "stu-A", apaar_id: null, user_id: "u-A" }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({ student_id: "outsider", apaar_id: "", user_id: "ghost" }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      expect(result).toBeNull();
    });
  });

  describe("aggregations", () => {
    it("computes summary (avg, min, max, accuracy) across students", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ student_id: "s1", apaar_id: null, user_id: "u1", first_name: "Alice" }),
        makeStudent({ student_id: "s2", apaar_id: null, user_id: "u2", first_name: "Bob" }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({
            student_id: "s1",
            user_id: "u1",
            overall_performance: {
              marks_scored: 90, max_marks_possible: 100, percentage: 90, accuracy: 80,
              num_correct: 18, num_wrong: 0, num_skipped: 2, total_questions: 20,
            },
          }),
          makeV2Doc({
            student_id: "s2",
            user_id: "u2",
            overall_performance: {
              marks_scored: 70, max_marks_possible: 100, percentage: 70, accuracy: 60,
              num_correct: 14, num_wrong: 2, num_skipped: 4, total_questions: 20,
            },
          }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      expect(result).not.toBeNull();
      expect(result!.summary.students_appeared).toBe(2);
      expect(result!.summary.avg_score).toBe(80);
      expect(result!.summary.min_score).toBe(70);
      expect(result!.summary.max_score).toBe(90);
      expect(result!.summary.avg_accuracy).toBe(70);
      expect(result!.summary.test_name).toBe("Mid-Term Physics");
      expect(result!.summary.start_date).toBe("2026-01-15");
    });

    it("aggregates subjects across students", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ student_id: "s1", apaar_id: null, user_id: "u1" }),
        makeStudent({ student_id: "s2", apaar_id: null, user_id: "u2" }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({
            student_id: "s1", user_id: "u1",
            subject_performance: [
              { subject: "Physics", percentage: 70, accuracy: 65, total_questions: 10, num_skipped: 1 },
            ],
          }),
          makeV2Doc({
            student_id: "s2", user_id: "u2",
            subject_performance: [
              { subject: "Physics", percentage: 90, accuracy: 85, total_questions: 10, num_skipped: 0 },
            ],
          }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      expect(result).not.toBeNull();
      expect(result!.subjects).toHaveLength(1);
      expect(result!.subjects[0]).toMatchObject({
        subject: "Physics",
        avg_score: 80,
        avg_accuracy: 75,
      });
    });

    it("groups chapter aggregates by chapter_id and surfaces it on the result", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ student_id: "s1", apaar_id: null, user_id: "u1" }),
        makeStudent({ student_id: "s2", apaar_id: null, user_id: "u2" }),
      ]);
      // Same chapter_id across both docs, but different chapter_name strings
      // (this is exactly the v1 bug we're fixing: the rollup should still group).
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({
            student_id: "s1", user_id: "u1",
            chapter_performance: [
              {
                chapter_name: "11C3 - Periodic Table",
                chapter_id: "chap-pt",
                subject: "Chemistry",
                marks_scored: 4, max_marks_possible: 4, accuracy: 100, total_questions: 1,
              },
            ],
            subject_performance: [{ subject: "Chemistry", percentage: 100, accuracy: 100, total_questions: 1, num_skipped: 0 }],
          }),
          makeV2Doc({
            student_id: "s2", user_id: "u2",
            chapter_performance: [
              {
                chapter_name: "Periodic Table",
                chapter_id: "chap-pt",
                subject: "Chemistry",
                marks_scored: 0, max_marks_possible: 4, accuracy: 0, total_questions: 1,
              },
            ],
            subject_performance: [{ subject: "Chemistry", percentage: 0, accuracy: 0, total_questions: 1, num_skipped: 0 }],
          }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      expect(result).not.toBeNull();
      expect(result!.chapters).toHaveLength(1);
      expect(result!.chapters[0]).toMatchObject({
        chapter_id: "chap-pt",
        subject: "Chemistry",
      });
      // Mean of (4/4=100%) and (0/4=0%) → 50%
      expect(result!.chapters[0].avg_score).toBe(50);
    });

    it("computes chapter attempt_rate from chapter-level num_skipped (not subject's)", async () => {
      // Subject-level: 10 questions, 0 skipped → 100% attempt rate.
      // Chapter Mechanics: 5 questions, 4 skipped → 20% attempt rate.
      // Chapter Optics:    5 questions, 0 skipped → 100% attempt rate.
      // Before the fix both chapters would show 100% (subject proxy).
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ student_id: "s1", apaar_id: null, user_id: "u1" }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({
            student_id: "s1",
            user_id: "u1",
            subject_performance: [
              { subject: "Physics", percentage: 50, accuracy: 50, total_questions: 10, num_skipped: 0 },
            ],
            chapter_performance: [
              {
                chapter_name: "Mechanics",
                chapter_id: "chap-mech",
                subject: "Physics",
                marks_scored: 1, max_marks_possible: 5, accuracy: 100,
                total_questions: 5, num_skipped: 4, num_correct: 1, num_wrong: 0,
              },
              {
                chapter_name: "Optics",
                chapter_id: "chap-opt",
                subject: "Physics",
                marks_scored: 4, max_marks_possible: 5, accuracy: 80,
                total_questions: 5, num_skipped: 0, num_correct: 4, num_wrong: 1,
              },
            ],
          }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      expect(result).not.toBeNull();
      const mech = result!.chapters.find((c) => c.chapter_id === "chap-mech")!;
      const opt = result!.chapters.find((c) => c.chapter_id === "chap-opt")!;
      expect(mech.attempt_rate).toBe(20);
      expect(opt.attempt_rate).toBe(100);

      // And the per-student chapter rows reflect the same.
      const studentChapters = result!.students[0]!.subject_scores[0]!.chapters!;
      const sMech = studentChapters.find((c) => c.chapter_name === "Mechanics")!;
      const sOpt = studentChapters.find((c) => c.chapter_name === "Optics")!;
      expect(sMech.attempt_rate).toBe(20);
      expect(sOpt.attempt_rate).toBe(100);
    });

    it("falls back to subject+name grouping when chapter_id is missing", async () => {
      mocks.mockQuery.mockResolvedValueOnce([
        makeStudent({ student_id: "s1", apaar_id: null, user_id: "u1" }),
      ]);
      mocks.mockSend.mockResolvedValueOnce({
        Items: [
          makeV2Doc({
            student_id: "s1", user_id: "u1",
            chapter_performance: [
              {
                chapter_name: "Mystery Chapter",
                chapter_id: null,
                subject: "Physics",
                marks_scored: 2, max_marks_possible: 4, accuracy: 50, total_questions: 2,
              },
            ],
            subject_performance: [{ subject: "Physics", percentage: 50, accuracy: 50, total_questions: 2, num_skipped: 0 }],
          }),
        ],
      });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", "JNV Test", 10, "sess-1");
      expect(result!.chapters).toHaveLength(1);
      expect(result!.chapters[0]).toMatchObject({
        chapter_id: null,
        chapter_name: "Mystery Chapter",
      });
    });
  });
});
