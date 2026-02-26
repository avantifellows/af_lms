import { describe, it, expect, vi, beforeEach } from "vitest";
import { processStudents } from "./school-student-list-data-issues";

vi.mock("./db", () => ({
  query: vi.fn(),
}));

import { query } from "./db";
const mockQuery = vi.mocked(query);

interface TestStudentRow {
  group_user_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  grade: number | null;
}

function makeStudent(overrides: Partial<TestStudentRow> = {}): TestStudentRow {
  return {
    group_user_id: "gu-1",
    user_id: "u-1",
    first_name: "Amit",
    last_name: "Sharma",
    grade: 11,
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("processStudents", () => {
  it("returns empty results for empty input", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await processStudents([]);
    expect(result.students).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns single student with no issues", async () => {
    const student = makeStudent();
    // checkMultipleSchools query returns no multi-school rows
    mockQuery.mockResolvedValueOnce([]);

    const result = await processStudents([student]);
    expect(result.students).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it("deduplicates rows with same group_user_id and different grades", async () => {
    const s1 = makeStudent({ group_user_id: "gu-1", grade: 9 });
    const s2 = makeStudent({ group_user_id: "gu-1", grade: 11 });
    mockQuery.mockResolvedValueOnce([]);

    const result = await processStudents([s1, s2]);
    expect(result.students).toHaveLength(1);
    // Should keep the highest grade
    expect(result.students[0].grade).toBe(11);
    // Should report a duplicate_grade issue
    const dupIssue = result.issues.find((i) => i.type === "duplicate_grade");
    expect(dupIssue).toBeDefined();
    expect(dupIssue!.details).toContain("Grade 11");
    expect(dupIssue!.details).toContain("Grade 9");
  });

  it("deduplicates rows with same group_user_id and same grade", async () => {
    const s1 = makeStudent({ group_user_id: "gu-1", grade: 11 });
    const s2 = makeStudent({ group_user_id: "gu-1", grade: 11 });
    mockQuery.mockResolvedValueOnce([]);

    const result = await processStudents([s1, s2]);
    expect(result.students).toHaveLength(1);
    expect(result.issues.some((i) => i.type === "duplicate_grade")).toBe(true);
  });

  it("handles null grades gracefully during deduplication", async () => {
    const s1 = makeStudent({ group_user_id: "gu-1", grade: null });
    const s2 = makeStudent({ group_user_id: "gu-1", grade: 10 });
    mockQuery.mockResolvedValueOnce([]);

    const result = await processStudents([s1, s2]);
    expect(result.students).toHaveLength(1);
    // Highest grade (10) should be kept over null
    expect(result.students[0].grade).toBe(10);
  });

  it("detects multi-school enrollment", async () => {
    const student = makeStudent({ user_id: "u-1" });
    // checkMultipleSchools returns a result for this user
    mockQuery.mockResolvedValueOnce([
      { user_id: "u-1", school_names: ["JNV Bhavnagar", "JNV Ahmedabad"] },
    ]);

    const result = await processStudents([student]);
    const multiIssue = result.issues.find((i) => i.type === "multiple_schools");
    expect(multiIssue).toBeDefined();
    expect(multiIssue!.details).toContain("2 schools");
    expect(multiIssue!.details).toContain("JNV Bhavnagar");
  });

  it("combines duplicate and multi-school issues", async () => {
    const s1 = makeStudent({ group_user_id: "gu-1", user_id: "u-1", grade: 9 });
    const s2 = makeStudent({ group_user_id: "gu-1", user_id: "u-1", grade: 11 });
    mockQuery.mockResolvedValueOnce([
      { user_id: "u-1", school_names: ["School A", "School B"] },
    ]);

    const result = await processStudents([s1, s2]);
    expect(result.students).toHaveLength(1);
    expect(result.issues.some((i) => i.type === "duplicate_grade")).toBe(true);
    expect(result.issues.some((i) => i.type === "multiple_schools")).toBe(true);
  });

  it("does not duplicate students that belong to different groups", async () => {
    const s1 = makeStudent({ group_user_id: "gu-1", user_id: "u-1" });
    const s2 = makeStudent({ group_user_id: "gu-2", user_id: "u-2", first_name: "Priya" });
    mockQuery.mockResolvedValueOnce([]);

    const result = await processStudents([s1, s2]);
    expect(result.students).toHaveLength(2);
    expect(result.issues).toEqual([]);
  });
});

describe("student name formatting (via issue reports)", () => {
  it("formats name as 'First Last' when both present", async () => {
    const s1 = makeStudent({ group_user_id: "gu-1", first_name: "Amit", last_name: "Sharma", grade: 9 });
    const s2 = makeStudent({ group_user_id: "gu-1", first_name: "Amit", last_name: "Sharma", grade: 11 });
    mockQuery.mockResolvedValueOnce([]);

    const result = await processStudents([s1, s2]);
    expect(result.issues[0].studentName).toBe("Amit Sharma");
  });

  it("formats name as 'First' when only first name present", async () => {
    const s1 = makeStudent({ group_user_id: "gu-1", first_name: "Amit", last_name: null, grade: 9 });
    const s2 = makeStudent({ group_user_id: "gu-1", first_name: "Amit", last_name: null, grade: 11 });
    mockQuery.mockResolvedValueOnce([]);

    const result = await processStudents([s1, s2]);
    expect(result.issues[0].studentName).toBe("Amit");
  });

  it("formats name as 'Unknown' when neither name present", async () => {
    const s1 = makeStudent({ group_user_id: "gu-1", first_name: null, last_name: null, grade: 9 });
    const s2 = makeStudent({ group_user_id: "gu-1", first_name: null, last_name: null, grade: 11 });
    mockQuery.mockResolvedValueOnce([]);

    const result = await processStudents([s1, s2]);
    expect(result.issues[0].studentName).toBe("Unknown");
  });
});
