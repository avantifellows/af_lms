import { describe, it, expect } from "vitest";
import {
  INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG,
  validateIndividualTeacherSave,
  validateIndividualTeacherComplete,
  type IndividualTeacherEntry,
} from "./individual-af-teacher-interaction";

// Helper: build a fully complete teacher entry (present, all 13 questions answered)
function buildCompleteTeacher(
  id: number,
  name: string,
  attendance: "present" | "on_leave" | "absent" = "present"
): IndividualTeacherEntry {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  if (attendance === "present") {
    for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: true };
    }
  }
  return { id, name, attendance, questions };
}

// Helper: build a complete payload with mixed attendance
function buildCompletePayload() {
  return {
    teachers: [
      buildCompleteTeacher(1, "Alice", "present"),
      buildCompleteTeacher(2, "Bob", "on_leave"),
      buildCompleteTeacher(3, "Carol", "absent"),
    ],
  };
}

describe("INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG", () => {
  it("has 5 sections with correct titles", () => {
    const titles = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.sections.map(
      (s) => s.title
    );
    expect(titles).toEqual([
      "Operational Health",
      "Syllabus Track",
      "Student Performance on Monthly Tests",
      "Support Needed",
      "Monthly Planning",
    ]);
  });

  it("has 13 total questions with unique keys (1+4+2+3+3)", () => {
    const counts = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.sections.map(
      (s) => s.questions.length
    );
    expect(counts).toEqual([1, 4, 2, 3, 3]);
    expect(INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys).toHaveLength(13);
    const unique = new Set(
      INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys
    );
    expect(unique.size).toBe(13);
  });

  it("allQuestionKeys matches flattened sections in order", () => {
    const flattened = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.sections.flatMap(
      (s) => s.questions.map((q) => q.key)
    );
    expect(INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys).toEqual(
      flattened
    );
  });
});

describe("validateIndividualTeacherSave (lenient)", () => {
  it("accepts empty object {}", () => {
    const result = validateIndividualTeacherSave({});
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts partial teachers with only 1 entry and partial questions", () => {
    const result = validateIndividualTeacherSave({
      teachers: [
        {
          id: 1,
          name: "Alice",
          attendance: "present",
          questions: {
            oh_class_duration: { answer: true },
          },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts teacher with on_leave attendance and no questions", () => {
    const result = validateIndividualTeacherSave({
      teachers: [
        { id: 1, name: "Alice", attendance: "on_leave", questions: {} },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts teacher with absent attendance and no questions", () => {
    const result = validateIndividualTeacherSave({
      teachers: [
        { id: 1, name: "Alice", attendance: "absent", questions: {} },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts present teacher with partial questions (lenient)", () => {
    const result = validateIndividualTeacherSave({
      teachers: [
        {
          id: 1,
          name: "Alice",
          attendance: "present",
          questions: {
            oh_class_duration: { answer: true },
            sp_student_performance: { answer: false },
            mp_monthly_plan: { answer: null },
          },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts fully valid mixed payload", () => {
    const result = validateIndividualTeacherSave(buildCompletePayload());
    expect(result.valid).toBe(true);
  });

  it("accepts teacher entry without attendance (lenient)", () => {
    const result = validateIndividualTeacherSave({
      teachers: [{ id: 1, name: "Alice", questions: {} }],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = validateIndividualTeacherSave({ foo: "bar" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: foo");
  });

  it("rejects non-boolean answer value", () => {
    const result = validateIndividualTeacherSave({
      teachers: [
        {
          id: 1,
          name: "Alice",
          attendance: "present",
          questions: { oh_class_duration: { answer: "yes" } },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("answer must be true, false, or null");
  });

  it("rejects non-string remark value", () => {
    const result = validateIndividualTeacherSave({
      teachers: [
        {
          id: 1,
          name: "Alice",
          attendance: "present",
          questions: { oh_class_duration: { answer: true, remark: 123 } },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("remark must be a string");
  });

  it("rejects non-array teachers", () => {
    const result = validateIndividualTeacherSave({ teachers: "Alice" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("teachers must be an array");
  });

  it("rejects teacher entry missing id", () => {
    const result = validateIndividualTeacherSave({
      teachers: [{ name: "Alice", attendance: "present", questions: {} }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("id must be a positive integer");
  });

  it("rejects non-positive-integer teacher ID", () => {
    const r1 = validateIndividualTeacherSave({
      teachers: [{ id: -1, name: "A", attendance: "present", questions: {} }],
    });
    expect(r1.valid).toBe(false);

    const r2 = validateIndividualTeacherSave({
      teachers: [{ id: 1.5, name: "A", attendance: "present", questions: {} }],
    });
    expect(r2.valid).toBe(false);

    const r3 = validateIndividualTeacherSave({
      teachers: [{ id: 0, name: "A", attendance: "present", questions: {} }],
    });
    expect(r3.valid).toBe(false);
  });

  it("rejects duplicate teacher IDs", () => {
    const result = validateIndividualTeacherSave({
      teachers: [
        { id: 1, name: "Alice", attendance: "present", questions: {} },
        { id: 1, name: "Bob", attendance: "absent", questions: {} },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Duplicate teacher id: 1");
  });

  it("rejects invalid attendance value", () => {
    const result = validateIndividualTeacherSave({
      teachers: [
        { id: 1, name: "Alice", attendance: "late", questions: {} },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain(
      "attendance must be present, on_leave, or absent"
    );
  });

  it("rejects null data", () => {
    const result = validateIndividualTeacherSave(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects string data", () => {
    const result = validateIndividualTeacherSave("hello");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects array data", () => {
    const result = validateIndividualTeacherSave([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });
});

describe("validateIndividualTeacherComplete (strict)", () => {
  it("rejects empty object (missing teachers)", () => {
    const result = validateIndividualTeacherComplete({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one teacher must be recorded");
  });

  it("rejects empty teachers array", () => {
    const result = validateIndividualTeacherComplete({ teachers: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one teacher must be recorded");
  });

  it("rejects present teacher missing all questions", () => {
    const result = validateIndividualTeacherComplete({
      teachers: [{ id: 1, name: "Alice", attendance: "present", questions: {} }],
    });
    expect(result.valid).toBe(false);
    const missingErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(missingErrors.length).toBe(13);
  });

  it("rejects present teacher with null answers", () => {
    const questions: Record<string, { answer: null }> = {};
    for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: null };
    }
    const result = validateIndividualTeacherComplete({
      teachers: [
        { id: 1, name: "Alice", attendance: "present", questions },
      ],
    });
    expect(result.valid).toBe(false);
    const nullErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(nullErrors.length).toBe(13);
  });

  it("accepts absent teacher without questions", () => {
    const result = validateIndividualTeacherComplete({
      teachers: [
        buildCompleteTeacher(1, "Alice", "present"),
        { id: 2, name: "Bob", attendance: "absent", questions: {} },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts on_leave teacher without questions", () => {
    const result = validateIndividualTeacherComplete({
      teachers: [
        buildCompleteTeacher(1, "Alice", "present"),
        { id: 2, name: "Bob", attendance: "on_leave", questions: {} },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts fully complete mixed payload", () => {
    const result = validateIndividualTeacherComplete(buildCompletePayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports teacher name and question labels in errors", () => {
    const result = validateIndividualTeacherComplete({
      teachers: [
        { id: 1, name: "Alice", attendance: "present", questions: {} },
      ],
    });
    expect(result.valid).toBe(false);
    // Should contain teacher name
    expect(result.errors.some((e) => e.includes("Alice"))).toBe(true);
    // Should contain question labels (not keys)
    expect(
      result.errors.some((e) =>
        e.includes("Does the teacher get the required duration")
      )
    ).toBe(true);
    // Should NOT contain raw question keys
    expect(
      result.errors.every((e) => !e.includes("oh_class_duration"))
    ).toBe(true);
  });
});
