import { describe, it, expect } from "vitest";
import {
  INDIVIDUAL_STUDENT_DISCUSSION_CONFIG,
  validateIndividualStudentDiscussionSave,
  validateIndividualStudentDiscussionComplete,
  type IndividualStudentEntry,
} from "./individual-student-discussion";

// Helper: build a fully complete student entry (all 2 questions answered)
function buildCompleteStudent(
  id: number,
  name: string,
  grade: number = 11
): IndividualStudentEntry {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  for (const key of INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
    questions[key] = { answer: true };
  }
  return { id, name, grade, questions };
}

// Helper: build a complete payload with multiple students
function buildCompletePayload() {
  return {
    students: [
      buildCompleteStudent(1, "Alice", 11),
      buildCompleteStudent(2, "Bob", 12),
    ],
  };
}

describe("INDIVIDUAL_STUDENT_DISCUSSION_CONFIG", () => {
  it("has 1 section with title 'Operational Health'", () => {
    const titles = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.sections.map(
      (s) => s.title
    );
    expect(titles).toEqual(["Operational Health"]);
  });

  it("has 2 total questions with unique keys", () => {
    expect(INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys).toHaveLength(2);
    const unique = new Set(
      INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys
    );
    expect(unique.size).toBe(2);
  });

  it("allQuestionKeys matches flattened sections in order", () => {
    const flattened = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.sections.flatMap(
      (s) => s.questions.map((q) => q.key)
    );
    expect(INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys).toEqual(
      flattened
    );
  });

  it("has the expected question keys with oh_* prefix", () => {
    expect(INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys).toEqual([
      "oh_teaching_concern",
      "oh_additional_support",
    ]);
  });
});

describe("validateIndividualStudentDiscussionSave (lenient)", () => {
  it("accepts empty object {}", () => {
    const result = validateIndividualStudentDiscussionSave({});
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts partial student entry with only 1 question", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [
        {
          id: 1,
          name: "Alice",
          grade: 11,
          questions: {
            oh_teaching_concern: { answer: true },
          },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts student with no questions (lenient)", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [{ id: 1, name: "Alice", grade: 11, questions: {} }],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts student without grade (lenient)", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [{ id: 1, name: "Alice", questions: {} }],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts student without name (lenient)", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [{ id: 1, grade: 11, questions: {} }],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts null answer values (unanswered)", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [
        {
          id: 1,
          name: "Alice",
          grade: 11,
          questions: { oh_teaching_concern: { answer: null } },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts questions with remarks", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [
        {
          id: 1,
          name: "Alice",
          grade: 11,
          questions: {
            oh_teaching_concern: { answer: true, remark: "Good student" },
          },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts fully valid payload", () => {
    const result = validateIndividualStudentDiscussionSave(buildCompletePayload());
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = validateIndividualStudentDiscussionSave({ foo: "bar" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: foo");
  });

  it("rejects grade as top-level key (not allowed)", () => {
    const result = validateIndividualStudentDiscussionSave({
      grade: 11,
      students: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: grade");
  });

  it("rejects non-boolean answer value", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [
        {
          id: 1,
          name: "Alice",
          grade: 11,
          questions: { oh_teaching_concern: { answer: "yes" } },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("answer must be true, false, or null");
  });

  it("rejects non-string remark value", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [
        {
          id: 1,
          name: "Alice",
          grade: 11,
          questions: { oh_teaching_concern: { answer: true, remark: 123 } },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("remark must be a string");
  });

  it("rejects non-array students", () => {
    const result = validateIndividualStudentDiscussionSave({ students: "Alice" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("students must be an array");
  });

  it("rejects student entry missing id", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [{ name: "Alice", grade: 11, questions: {} }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("id must be a positive integer");
  });

  it("rejects non-positive-integer student ID", () => {
    const r1 = validateIndividualStudentDiscussionSave({
      students: [{ id: -1, name: "A", grade: 11, questions: {} }],
    });
    expect(r1.valid).toBe(false);

    const r2 = validateIndividualStudentDiscussionSave({
      students: [{ id: 1.5, name: "A", grade: 11, questions: {} }],
    });
    expect(r2.valid).toBe(false);

    const r3 = validateIndividualStudentDiscussionSave({
      students: [{ id: 0, name: "A", grade: 11, questions: {} }],
    });
    expect(r3.valid).toBe(false);
  });

  it("rejects duplicate student IDs", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [
        { id: 1, name: "Alice", grade: 11, questions: {} },
        { id: 1, name: "Bob", grade: 12, questions: {} },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Duplicate student id: 1");
  });

  it("rejects invalid grade value in student entry", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [{ id: 1, name: "Alice", grade: 10, questions: {} }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("grade must be 11 or 12");
  });

  it("rejects string grade in student entry", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [{ id: 1, name: "Alice", grade: "eleven", questions: {} }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("grade must be 11 or 12");
  });

  it("rejects null data", () => {
    const result = validateIndividualStudentDiscussionSave(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects string data", () => {
    const result = validateIndividualStudentDiscussionSave("hello");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects array data", () => {
    const result = validateIndividualStudentDiscussionSave([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });
});

describe("validateIndividualStudentDiscussionComplete (strict)", () => {
  it("rejects empty object (missing students)", () => {
    const result = validateIndividualStudentDiscussionComplete({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one student must be recorded");
  });

  it("rejects empty students array", () => {
    const result = validateIndividualStudentDiscussionComplete({ students: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one student must be recorded");
  });

  it("rejects student missing all questions", () => {
    const result = validateIndividualStudentDiscussionComplete({
      students: [{ id: 1, name: "Alice", grade: 11, questions: {} }],
    });
    expect(result.valid).toBe(false);
    const missingErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(missingErrors.length).toBe(2);
  });

  it("rejects student with null answers", () => {
    const questions: Record<string, { answer: null }> = {};
    for (const key of INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: null };
    }
    const result = validateIndividualStudentDiscussionComplete({
      students: [{ id: 1, name: "Alice", grade: 11, questions }],
    });
    expect(result.valid).toBe(false);
    const nullErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(nullErrors.length).toBe(2);
  });

  it("rejects student missing grade (strict)", () => {
    const result = validateIndividualStudentDiscussionComplete({
      students: [
        {
          id: 1,
          name: "Alice",
          questions: {
            oh_teaching_concern: { answer: true },
            oh_additional_support: { answer: false },
          },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("grade is required"))).toBe(true);
  });

  it("rejects student missing name (strict)", () => {
    const result = validateIndividualStudentDiscussionComplete({
      students: [
        {
          id: 1,
          grade: 11,
          questions: {
            oh_teaching_concern: { answer: true },
            oh_additional_support: { answer: false },
          },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name must be a non-empty string"))).toBe(true);
  });

  it("rejects student with invalid grade (strict)", () => {
    const result = validateIndividualStudentDiscussionComplete({
      students: [
        {
          id: 1,
          name: "Alice",
          grade: 10,
          questions: {
            oh_teaching_concern: { answer: true },
            oh_additional_support: { answer: false },
          },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("grade must be 11 or 12"))).toBe(true);
  });

  it("accepts fully complete payload", () => {
    const result = validateIndividualStudentDiscussionComplete(buildCompletePayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts single student with grade 12 and all questions", () => {
    const result = validateIndividualStudentDiscussionComplete({
      students: [buildCompleteStudent(1, "Alice", 12)],
    });
    expect(result.valid).toBe(true);
  });

  it("reports student name and question labels in errors", () => {
    const result = validateIndividualStudentDiscussionComplete({
      students: [{ id: 1, name: "Alice", grade: 11, questions: {} }],
    });
    expect(result.valid).toBe(false);
    // Should contain student name
    expect(result.errors.some((e) => e.includes("Alice"))).toBe(true);
    // Should contain question labels (not keys)
    expect(
      result.errors.some((e) =>
        e.includes("Did any student raise a concern on teaching quality")
      )
    ).toBe(true);
    // Should NOT contain raw question keys
    expect(
      result.errors.every((e) => !e.includes("oh_teaching_concern"))
    ).toBe(true);
  });

  it("rejects duplicate student IDs in strict mode", () => {
    const result = validateIndividualStudentDiscussionComplete({
      students: [
        buildCompleteStudent(1, "Alice", 11),
        buildCompleteStudent(1, "Bob", 12),
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Duplicate student id: 1");
  });

  it("rejects unknown top-level keys even when students are complete", () => {
    const payload = { ...buildCompletePayload(), extra: "field" };
    const result = validateIndividualStudentDiscussionComplete(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: extra");
  });
});
