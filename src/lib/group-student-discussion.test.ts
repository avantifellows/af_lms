import { describe, it, expect } from "vitest";
import {
  GROUP_STUDENT_DISCUSSION_CONFIG,
  validateGroupStudentDiscussionSave,
  validateGroupStudentDiscussionComplete,
} from "./group-student-discussion";

// Helper: build a complete valid payload (grade + all 4 questions answered)
function buildCompletePayload(grade: number = 11) {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
    questions[key] = { answer: true };
  }
  return { grade, questions };
}

describe("GROUP_STUDENT_DISCUSSION_CONFIG", () => {
  it("has 1 section with title 'General Check'", () => {
    const titles = GROUP_STUDENT_DISCUSSION_CONFIG.sections.map((s) => s.title);
    expect(titles).toEqual(["General Check"]);
  });

  it("has 4 total questions with unique keys", () => {
    expect(GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys).toHaveLength(4);
    const unique = new Set(GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys);
    expect(unique.size).toBe(4);
  });

  it("allQuestionKeys matches flattened sections in order", () => {
    const flattened = GROUP_STUDENT_DISCUSSION_CONFIG.sections.flatMap((s) =>
      s.questions.map((q) => q.key)
    );
    expect(GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys).toEqual(flattened);
  });

  it("has the expected question keys with gc_* prefix", () => {
    expect(GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys).toEqual([
      "gc_interacted",
      "gc_program_updates",
      "gc_direction",
      "gc_concerns",
    ]);
  });

  it("all question keys follow gc_* format", () => {
    for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      expect(key).toMatch(/^gc_/);
    }
  });
});

describe("validateGroupStudentDiscussionSave (lenient)", () => {
  it("accepts empty object {}", () => {
    const result = validateGroupStudentDiscussionSave({});
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts partial questions (2 of 4 answered)", () => {
    const result = validateGroupStudentDiscussionSave({
      questions: {
        gc_interacted: { answer: true },
        gc_concerns: { answer: false },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts valid grade 11", () => {
    const result = validateGroupStudentDiscussionSave({ grade: 11 });
    expect(result.valid).toBe(true);
  });

  it("accepts valid grade 12", () => {
    const result = validateGroupStudentDiscussionSave({ grade: 12 });
    expect(result.valid).toBe(true);
  });

  it("accepts null answer values (unanswered)", () => {
    const result = validateGroupStudentDiscussionSave({
      questions: {
        gc_interacted: { answer: null },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts questions with remarks", () => {
    const result = validateGroupStudentDiscussionSave({
      questions: {
        gc_interacted: { answer: true, remark: "Good discussion" },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts fully valid payload", () => {
    const result = validateGroupStudentDiscussionSave(buildCompletePayload());
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = validateGroupStudentDiscussionSave({ foo: "bar" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: foo");
  });

  it("rejects teachers top-level key (not allowed)", () => {
    const result = validateGroupStudentDiscussionSave({
      teachers: [{ id: 1, name: "Alice" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: teachers");
  });

  it("rejects invalid grade 10", () => {
    const result = validateGroupStudentDiscussionSave({ grade: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("grade must be 11 or 12");
  });

  it("rejects invalid grade 13", () => {
    const result = validateGroupStudentDiscussionSave({ grade: 13 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("grade must be 11 or 12");
  });

  it("rejects string grade 'eleven'", () => {
    const result = validateGroupStudentDiscussionSave({ grade: "eleven" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("grade must be 11 or 12");
  });

  it("rejects null grade", () => {
    const result = validateGroupStudentDiscussionSave({ grade: null });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("grade must be 11 or 12");
  });

  it("rejects float grade 11.5", () => {
    const result = validateGroupStudentDiscussionSave({ grade: 11.5 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("grade must be 11 or 12");
  });

  it("ignores unknown question keys (graceful config evolution)", () => {
    const result = validateGroupStudentDiscussionSave({
      questions: { unknown_key: { answer: true } },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects non-boolean answer value", () => {
    const result = validateGroupStudentDiscussionSave({
      questions: { gc_interacted: { answer: "yes" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("answer must be true, false, or null");
  });

  it("rejects non-string remark value", () => {
    const result = validateGroupStudentDiscussionSave({
      questions: { gc_interacted: { answer: true, remark: 123 } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("remark must be a string");
  });

  it("rejects null data", () => {
    const result = validateGroupStudentDiscussionSave(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects string data", () => {
    const result = validateGroupStudentDiscussionSave("hello");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects array data", () => {
    const result = validateGroupStudentDiscussionSave([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });
});

describe("validateGroupStudentDiscussionComplete (strict)", () => {
  it("rejects empty object (missing grade and questions)", () => {
    const result = validateGroupStudentDiscussionComplete({});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("grade is required"))).toBe(true);
  });

  it("rejects when grade is missing but questions are complete", () => {
    const questions: Record<string, { answer: boolean }> = {};
    for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: true };
    }
    const result = validateGroupStudentDiscussionComplete({ questions });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("grade is required and must be 11 or 12");
  });

  it("rejects when questions are missing but grade is valid", () => {
    const result = validateGroupStudentDiscussionComplete({ grade: 11 });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("answer is required") || e.includes("All questions"))
    ).toBe(true);
  });

  it("rejects when not all 4 answers present (2 of 4)", () => {
    const result = validateGroupStudentDiscussionComplete({
      grade: 11,
      questions: {
        gc_interacted: { answer: true },
        gc_concerns: { answer: false },
      },
    });
    expect(result.valid).toBe(false);
    const missingErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(missingErrors.length).toBe(2);
  });

  it("rejects null answers (requires boolean, not null)", () => {
    const questions: Record<string, { answer: boolean | null }> = {};
    for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: null };
    }
    const result = validateGroupStudentDiscussionComplete({ grade: 11, questions });
    expect(result.valid).toBe(false);
    const nullErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(nullErrors.length).toBe(4);
  });

  it("reports question labels (not keys) in error messages", () => {
    const result = validateGroupStudentDiscussionComplete({
      grade: 11,
      questions: {},
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Have you interacted with the students")
      )
    ).toBe(true);
    expect(
      result.errors.every((e) => !e.includes("gc_interacted"))
    ).toBe(true);
  });

  it("accepts fully complete payload with grade 11", () => {
    const result = validateGroupStudentDiscussionComplete(buildCompletePayload(11));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts fully complete payload with grade 12", () => {
    const result = validateGroupStudentDiscussionComplete(buildCompletePayload(12));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("ignores unknown question keys alongside requiring all known keys", () => {
    const payload = buildCompletePayload();
    (payload.questions as Record<string, { answer: boolean }>).some_future_key =
      { answer: true };
    const result = validateGroupStudentDiscussionComplete(payload);
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys even when grade and questions are complete", () => {
    const payload = { ...buildCompletePayload(), extra: "field" };
    const result = validateGroupStudentDiscussionComplete(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: extra");
  });

  it("rejects invalid grade even when questions are complete", () => {
    const payload = buildCompletePayload();
    (payload as Record<string, unknown>).grade = 10;
    const result = validateGroupStudentDiscussionComplete(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("grade is required and must be 11 or 12");
  });
});
