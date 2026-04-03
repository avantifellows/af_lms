import { describe, it, expect, vi, beforeEach } from "vitest";

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
});

// --- Helper factories ---

function makeStudent(overrides: Partial<{
  user_id: string;
  student_id: string | null;
  apaar_id: string | null;
  first_name: string;
  last_name: string | null;
  gender: string | null;
}> = {}) {
  return {
    user_id: "user-1",
    student_id: "stu-1",
    apaar_id: "apaar-1",
    first_name: "Alice",
    last_name: "Smith",
    gender: "female",
    ...overrides,
  };
}

function makeDynamoItem(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "sess-1",
    "user_id-section": "stu-1#Overall",
    user_id: "stu-1",
    section: "Overall",
    marks_scored: 80,
    max_marks_possible: 100,
    percentage: 80,
    accuracy: 75,
    total_questions: 20,
    num_correct: 15,
    num_wrong: 3,
    num_skipped: 2,
    test_name: "Mid-Term Physics",
    start_date: "2026-01-15",
    ...overrides,
  };
}

function makeSubjectItem(section: string, overrides: Record<string, unknown> = {}) {
  return makeDynamoItem({
    "user_id-section": `stu-1#${section}`,
    section,
    marks_scored: 30,
    max_marks_possible: 40,
    percentage: 75,
    accuracy: 70,
    total_questions: 10,
    num_correct: 7,
    num_wrong: 2,
    num_skipped: 1,
    ...overrides,
  });
}

// --- Tests ---

describe("getTestDeepDiveFromDynamo", () => {
  async function importModule() {
    return import("./dynamodb");
  }

  describe("getSchoolStudentIdentifiers (via integration)", () => {
    it("calls query with correct SQL and params", async () => {
      mocks.mockQuery.mockResolvedValueOnce([]);

      const { getTestDeepDiveFromDynamo } = await importModule();
      await getTestDeepDiveFromDynamo("school-abc", 10, "sess-1");

      expect(mocks.mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mocks.mockQuery.mock.calls[0];
      expect(sql).toContain("SELECT DISTINCT");
      expect(sql).toContain("u.id as user_id");
      expect(sql).toContain("s.student_id");
      expect(sql).toContain("s.apaar_id");
      expect(sql).toContain("u.first_name");
      expect(sql).toContain("u.last_name");
      expect(sql).toContain("u.gender");
      expect(sql).toContain("g.type = 'school' AND g.child_id = $1");
      expect(sql).toContain("gr.number = $2");
      expect(params).toEqual(["school-abc", 10]);
    });

    it("excludes dropout students in SQL filter", async () => {
      mocks.mockQuery.mockResolvedValueOnce([]);

      const { getTestDeepDiveFromDynamo } = await importModule();
      await getTestDeepDiveFromDynamo("school-abc", 10, "sess-1");

      const [sql] = mocks.mockQuery.mock.calls[0];
      expect(sql).toContain("s.status IS NULL OR s.status != 'dropout'");
    });
  });

  describe("queryDynamoForStudent (via integration)", () => {
    it("returns empty array for empty identifier (dedup removes it)", async () => {
      // Student with only user_id (student_id=null, apaar_id=null)
      const student = makeStudent({ student_id: null, apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);
      // user_id query returns empty
      mocks.mockSend.mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).toBeNull();
    });

    it("queries DynamoDB with correct params", async () => {
      const student = makeStudent({ student_id: "stu-1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      // student_id query
      mocks.mockSend.mockResolvedValueOnce({ Items: [] });
      // user_id query
      mocks.mockSend.mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: "student_quiz_reports",
          KeyConditionExpression:
            "session_id = :sid AND begins_with(#sk, :prefix)",
          ExpressionAttributeNames: { "#sk": "user_id-section" },
          ExpressionAttributeValues: {
            ":sid": "sess-1",
            ":prefix": "stu-1#",
          },
        })
      );
    });

    it("returns empty array on DynamoDB error (graceful)", async () => {
      const student = makeStudent();
      mocks.mockQuery.mockResolvedValueOnce([student]);

      // All queries fail
      mocks.mockSend.mockRejectedValue(new Error("DynamoDB timeout"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getStudentReports (via integration)", () => {
    it("returns match from student_id without querying other identifiers unnecessarily", async () => {
      const student = makeStudent();
      mocks.mockQuery.mockResolvedValueOnce([student]);

      const overallItem = makeDynamoItem();
      // student_id returns results
      mocks.mockSend.mockResolvedValueOnce({ Items: [overallItem] });
      // apaar_id returns results too (but shouldn't matter, first wins)
      mocks.mockSend.mockResolvedValueOnce({ Items: [overallItem] });
      // user_id
      mocks.mockSend.mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      // Should succeed since student_id matched
      expect(result).not.toBeNull();
      expect(result!.students.length).toBe(1);
    });

    it("falls back to apaar_id when student_id returns empty", async () => {
      const student = makeStudent();
      mocks.mockQuery.mockResolvedValueOnce([student]);

      const overallItem = makeDynamoItem();
      // student_id -> empty
      mocks.mockSend.mockResolvedValueOnce({ Items: [] });
      // apaar_id -> match
      mocks.mockSend.mockResolvedValueOnce({ Items: [overallItem] });
      // user_id -> empty
      mocks.mockSend.mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.students.length).toBe(1);
    });

    it("deduplicates when student_id === user_id", async () => {
      const student = makeStudent({ student_id: "user-1", user_id: "user-1" });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      // Only 2 unique IDs: "user-1" and "apaar-1"
      // user-1 query
      mocks.mockSend.mockResolvedValueOnce({ Items: [] });
      // apaar-1 query
      mocks.mockSend.mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      // Should have called send only twice (2 unique IDs, not 3)
      expect(mocks.mockSend).toHaveBeenCalledTimes(2);
    });

    it("returns null when no identifier matches", async () => {
      const student = makeStudent();
      mocks.mockQuery.mockResolvedValueOnce([student]);

      // All return empty
      mocks.mockSend.mockResolvedValue({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).toBeNull();
    });
  });

  describe("main transformation", () => {
    it("returns null when no students found in Postgres", async () => {
      mocks.mockQuery.mockResolvedValueOnce([]);

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).toBeNull();
      expect(mocks.mockSend).not.toHaveBeenCalled();
    });

    it("returns null when no DynamoDB matches found", async () => {
      mocks.mockQuery.mockResolvedValueOnce([makeStudent()]);
      mocks.mockSend.mockResolvedValue({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).toBeNull();
    });

    it("computes summary correctly (avg, min, max percentage)", async () => {
      const student1 = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null, first_name: "Alice" });
      const student2 = makeStudent({ user_id: "u2", student_id: "s2", apaar_id: null, first_name: "Bob" });
      mocks.mockQuery.mockResolvedValueOnce([student1, student2]);

      // student1: s1 -> match, u1 -> skip
      mocks.mockSend
        .mockResolvedValueOnce({
          Items: [makeDynamoItem({ percentage: 90, accuracy: 80, total_questions: 20, num_skipped: 2 })],
        })
        .mockResolvedValueOnce({ Items: [] }) // u1
        // student2: s2 -> match, u2 -> skip
        .mockResolvedValueOnce({
          Items: [makeDynamoItem({ percentage: 70, accuracy: 60, total_questions: 20, num_skipped: 4 })],
        })
        .mockResolvedValueOnce({ Items: [] }); // u2

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.summary.students_appeared).toBe(2);
      expect(result!.summary.avg_score).toBe(80); // (90+70)/2
      expect(result!.summary.min_score).toBe(70);
      expect(result!.summary.max_score).toBe(90);
      expect(result!.summary.avg_accuracy).toBe(70); // (80+60)/2
      expect(result!.summary.test_name).toBe("Mid-Term Physics");
      expect(result!.summary.start_date).toBe("2026-01-15");
    });

    it("builds subject aggregation across students", async () => {
      const student1 = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      const student2 = makeStudent({ user_id: "u2", student_id: "s2", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student1, student2]);

      const overall1 = makeDynamoItem({ percentage: 80 });
      const physics1 = makeSubjectItem("Physics", { percentage: 70, accuracy: 65 });

      const overall2 = makeDynamoItem({ percentage: 60 });
      const physics2 = makeSubjectItem("Physics", { percentage: 90, accuracy: 85 });

      // s1 -> match
      mocks.mockSend
        .mockResolvedValueOnce({ Items: [overall1, physics1] })
        .mockResolvedValueOnce({ Items: [] }) // u1
        // s2 -> match
        .mockResolvedValueOnce({ Items: [overall2, physics2] })
        .mockResolvedValueOnce({ Items: [] }); // u2

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.subjects.length).toBe(1);
      expect(result!.subjects[0].subject).toBe("Physics");
      expect(result!.subjects[0].avg_score).toBe(80); // (70+90)/2
      expect(result!.subjects[0].avg_accuracy).toBe(75); // (65+85)/2
    });

    it("builds chapter aggregation from chapter_wise_data", async () => {
      const student = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      const overall = makeDynamoItem();
      const physicsItem = makeSubjectItem("Physics", {
        chapter_wise_data: [
          {
            chapter_name: "Mechanics",
            section: "Physics",
            marks_scored: 8,
            max_score: 10,
            accuracy: 80,
            attempt_percentage: 90,
            total_questions: 5,
          },
          {
            chapter_name: "Optics",
            section: "Physics",
            marks_scored: 6,
            max_score: 10,
            accuracy: 60,
            attempt_percentage: 80,
            total_questions: 5,
          },
        ],
      });

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [overall, physicsItem] })
        .mockResolvedValueOnce({ Items: [] }); // u1

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.chapters.length).toBe(2);

      // Sorted by subject then avg_score ascending
      const optics = result!.chapters.find((c) => c.chapter_name === "Optics");
      const mechanics = result!.chapters.find((c) => c.chapter_name === "Mechanics");

      expect(optics).toBeDefined();
      expect(optics!.avg_score).toBe(60); // 6/10 * 100
      expect(optics!.accuracy).toBe(60);
      expect(optics!.attempt_rate).toBe(80);
      expect(optics!.questions).toBe(5);
      expect(optics!.avg_time).toBeNull();

      expect(mechanics).toBeDefined();
      expect(mechanics!.avg_score).toBe(80); // 8/10 * 100
      expect(mechanics!.subject).toBe("Physics");
    });

    it("computes attempt_rate from num_skipped/total_questions", async () => {
      const student = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      const overall = makeDynamoItem({
        total_questions: 20,
        num_skipped: 5,
        percentage: 75,
      });
      const physics = makeSubjectItem("Physics", {
        total_questions: 10,
        num_skipped: 3,
      });

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [overall, physics] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();

      // Overall attempt_rate: (20-5)/20 * 100 = 75
      expect(result!.students[0].attempt_rate).toBe(75);

      // Subject attempt_rate: (10-3)/10 * 100 = 70
      expect(result!.students[0].subject_scores[0].attempt_rate).toBe(70);
    });

    it("skips students without overall section", async () => {
      const student1 = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null, first_name: "Alice" });
      const student2 = makeStudent({ user_id: "u2", student_id: "s2", apaar_id: null, first_name: "Bob" });
      mocks.mockQuery.mockResolvedValueOnce([student1, student2]);

      // student1: has overall
      mocks.mockSend
        .mockResolvedValueOnce({
          Items: [makeDynamoItem({ percentage: 80 })],
        })
        .mockResolvedValueOnce({ Items: [] }) // u1
        // student2: only has subject, no overall
        .mockResolvedValueOnce({
          Items: [makeSubjectItem("Physics")],
        })
        .mockResolvedValueOnce({ Items: [] }); // u2

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.students.length).toBe(1);
      expect(result!.students[0].student_name).toBe("Alice Smith");
    });

    it("returns null when all matched students lack overall section", async () => {
      const student = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      // Only subject items, no overall
      mocks.mockSend
        .mockResolvedValueOnce({ Items: [makeSubjectItem("Physics")] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).toBeNull();
    });

    it("sorts students by percentage descending", async () => {
      const student1 = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null, first_name: "Alice" });
      const student2 = makeStudent({ user_id: "u2", student_id: "s2", apaar_id: null, first_name: "Bob" });
      const student3 = makeStudent({ user_id: "u3", student_id: "s3", apaar_id: null, first_name: "Carol" });
      mocks.mockQuery.mockResolvedValueOnce([student1, student2, student3]);

      mocks.mockSend
        // s1: 60%
        .mockResolvedValueOnce({ Items: [makeDynamoItem({ percentage: 60 })] })
        .mockResolvedValueOnce({ Items: [] })
        // s2: 90%
        .mockResolvedValueOnce({ Items: [makeDynamoItem({ percentage: 90 })] })
        .mockResolvedValueOnce({ Items: [] })
        // s3: 75%
        .mockResolvedValueOnce({ Items: [makeDynamoItem({ percentage: 75 })] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.students.map((s) => s.student_name)).toEqual([
        "Bob Smith",
        "Carol Smith",
        "Alice Smith",
      ]);
      expect(result!.students.map((s) => s.percentage)).toEqual([90, 75, 60]);
    });

    it("builds student name from first_name + last_name", async () => {
      const student = makeStudent({ first_name: "Priya", last_name: "Sharma" });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [makeDynamoItem()] })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.students[0].student_name).toBe("Priya Sharma");
    });

    it("handles null last_name (first_name only)", async () => {
      const student = makeStudent({ first_name: "Priya", last_name: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [makeDynamoItem()] })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.students[0].student_name).toBe("Priya");
    });

    it("includes gender in student row", async () => {
      const student = makeStudent({ gender: "male" });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [makeDynamoItem()] })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.students[0].gender).toBe("male");
    });

    it("sorts subjects by avg_score ascending", async () => {
      const student = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      const overall = makeDynamoItem();
      const math = makeSubjectItem("Mathematics", { percentage: 90 });
      const physics = makeSubjectItem("Physics", { percentage: 60 });
      const chemistry = makeSubjectItem("Chemistry", { percentage: 75 });

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [overall, math, physics, chemistry] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.subjects.map((s) => s.subject)).toEqual([
        "Physics",
        "Chemistry",
        "Mathematics",
      ]);
    });

    it("sorts chapters by subject then avg_score ascending", async () => {
      const student = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      const overall = makeDynamoItem();
      const math = makeSubjectItem("Mathematics", {
        chapter_wise_data: [
          { chapter_name: "Algebra", section: "Mathematics", marks_scored: 9, max_score: 10, accuracy: 90, attempt_percentage: 100, total_questions: 5 },
          { chapter_name: "Calculus", section: "Mathematics", marks_scored: 5, max_score: 10, accuracy: 50, attempt_percentage: 80, total_questions: 5 },
        ],
      });
      const physics = makeSubjectItem("Physics", {
        chapter_wise_data: [
          { chapter_name: "Optics", section: "Physics", marks_scored: 7, max_score: 10, accuracy: 70, attempt_percentage: 90, total_questions: 5 },
        ],
      });

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [overall, math, physics] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      // Mathematics chapters sorted by score: Calculus(50) < Algebra(90)
      // Physics chapters: Optics(70)
      // Sorted by subject first: Mathematics before Physics
      expect(result!.chapters.map((c) => c.chapter_name)).toEqual([
        "Calculus",
        "Algebra",
        "Optics",
      ]);
    });

    it("handles zero total_questions gracefully (attempt_rate = 0)", async () => {
      const student = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      const overall = makeDynamoItem({ total_questions: 0, num_skipped: 0 });

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [overall] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(result!.students[0].attempt_rate).toBe(0);
    });

    it("filters null student_id and apaar_id from identifier list", async () => {
      const student = makeStudent({ student_id: null, apaar_id: null, user_id: "u1" });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      // Only user_id should be queried (1 unique ID)
      mocks.mockSend.mockResolvedValueOnce({ Items: [makeDynamoItem()] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      expect(mocks.mockSend).toHaveBeenCalledTimes(1);
    });

    it("populates student marks_scored and max_marks from overall item", async () => {
      const student = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      const overall = makeDynamoItem({
        marks_scored: 42,
        max_marks_possible: 50,
        percentage: 84,
        accuracy: 88,
      });

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [overall] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      const s = result!.students[0];
      expect(s.marks_scored).toBe(42);
      expect(s.max_marks).toBe(50);
      expect(s.percentage).toBe(84);
      expect(s.accuracy).toBe(88);
    });

    it("builds subject_scores on each student row", async () => {
      const student = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      const overall = makeDynamoItem();
      const physics = makeSubjectItem("Physics", {
        marks_scored: 25,
        max_marks_possible: 30,
        percentage: 83.3,
        accuracy: 78,
        total_questions: 10,
        num_skipped: 2,
      });

      mocks.mockSend
        .mockResolvedValueOnce({ Items: [overall, physics] })
        .mockResolvedValueOnce({ Items: [] });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      const scores = result!.students[0].subject_scores;
      expect(scores.length).toBe(1);
      expect(scores[0].subject).toBe("Physics");
      expect(scores[0].marks_scored).toBe(25);
      expect(scores[0].max_marks).toBe(30);
      expect(scores[0].percentage).toBe(83.3);
      expect(scores[0].accuracy).toBe(78);
      expect(scores[0].attempt_rate).toBe(80); // (10-2)/10 * 100
    });

    it("aggregates subjects case-insensitively", async () => {
      const student1 = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null, first_name: "Alice" });
      const student2 = makeStudent({ user_id: "u2", student_id: "s2", apaar_id: null, first_name: "Bob" });
      mocks.mockQuery.mockResolvedValueOnce([student1, student2]);

      // Student 1 has "Physics", student 2 has "physics" (different casing)
      mocks.mockSend
        .mockResolvedValueOnce({
          Items: [makeDynamoItem({ percentage: 80 }), makeSubjectItem("Physics", { percentage: 70 })],
        })
        .mockResolvedValueOnce({ Items: [] }) // u1
        .mockResolvedValueOnce({
          Items: [makeDynamoItem({ percentage: 60 }), makeSubjectItem("physics", { percentage: 50 })],
        })
        .mockResolvedValueOnce({ Items: [] }); // u2

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).not.toBeNull();
      // Should produce 1 subject entry, not 2
      expect(result!.subjects).toHaveLength(1);
      expect(result!.subjects[0].avg_score).toBe(60); // (70+50)/2
    });

    it("handles DynamoDB Items being undefined (treats as empty)", async () => {
      const student = makeStudent({ user_id: "u1", student_id: "s1", apaar_id: null });
      mocks.mockQuery.mockResolvedValueOnce([student]);

      // Items is undefined rather than []
      mocks.mockSend
        .mockResolvedValueOnce({ Items: undefined })
        .mockResolvedValueOnce({ Items: undefined });

      const { getTestDeepDiveFromDynamo } = await importModule();
      const result = await getTestDeepDiveFromDynamo("school-1", 10, "sess-1");

      expect(result).toBeNull();
    });
  });
});
