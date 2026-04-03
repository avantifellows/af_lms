import { describe, it, expect } from "vitest";
import {
  SCHOOL_STAFF_INTERACTION_CONFIG,
  validateSchoolStaffInteractionSave,
  validateSchoolStaffInteractionComplete,
} from "./school-staff-interaction";

// Helper: build a complete valid payload (no teachers/students — just questions)
function buildCompletePayload() {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  for (const key of SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys) {
    questions[key] = { answer: true };
  }
  return { questions };
}

describe("SCHOOL_STAFF_INTERACTION_CONFIG", () => {
  it("has 1 section with correct title", () => {
    const titles = SCHOOL_STAFF_INTERACTION_CONFIG.sections.map((s) => s.title);
    expect(titles).toEqual(["General Check"]);
  });

  it("has 2 total questions with unique keys", () => {
    const counts = SCHOOL_STAFF_INTERACTION_CONFIG.sections.map(
      (s) => s.questions.length
    );
    expect(counts).toEqual([2]);
    expect(SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys).toHaveLength(2);
    const unique = new Set(SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys);
    expect(unique.size).toBe(2);
  });

  it("allQuestionKeys matches flattened sections in order", () => {
    const flattened = SCHOOL_STAFF_INTERACTION_CONFIG.sections.flatMap((s) =>
      s.questions.map((q) => q.key)
    );
    expect(SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys).toEqual(flattened);
  });

  it("has the expected question keys", () => {
    expect(SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys).toEqual([
      "gc_staff_concern",
      "gc_pertaining_issue",
    ]);
  });
});

describe("validateSchoolStaffInteractionSave (lenient)", () => {
  it("accepts empty object {}", () => {
    const result = validateSchoolStaffInteractionSave({});
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts partial questions (1 of 2 answered)", () => {
    const result = validateSchoolStaffInteractionSave({
      questions: {
        gc_staff_concern: { answer: true },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts null answer values (unanswered)", () => {
    const result = validateSchoolStaffInteractionSave({
      questions: {
        gc_staff_concern: { answer: null },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts questions with remarks", () => {
    const result = validateSchoolStaffInteractionSave({
      questions: {
        gc_staff_concern: { answer: true, remark: "Staff had concerns" },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts fully valid payload", () => {
    const result = validateSchoolStaffInteractionSave(buildCompletePayload());
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = validateSchoolStaffInteractionSave({ foo: "bar" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: foo");
  });

  it("rejects teachers top-level key (not allowed for school staff interaction)", () => {
    const result = validateSchoolStaffInteractionSave({
      teachers: [{ id: 1, name: "Alice" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: teachers");
  });

  it("ignores unknown question keys (graceful config evolution)", () => {
    const result = validateSchoolStaffInteractionSave({
      questions: { unknown_key: { answer: true } },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects non-boolean answer value", () => {
    const result = validateSchoolStaffInteractionSave({
      questions: { gc_staff_concern: { answer: "yes" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("answer must be true, false, or null");
  });

  it("rejects non-string remark value", () => {
    const result = validateSchoolStaffInteractionSave({
      questions: { gc_staff_concern: { answer: true, remark: 123 } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("remark must be a string");
  });

  it("rejects null data", () => {
    const result = validateSchoolStaffInteractionSave(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects string data", () => {
    const result = validateSchoolStaffInteractionSave("hello");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects array data", () => {
    const result = validateSchoolStaffInteractionSave([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });
});

describe("validateSchoolStaffInteractionComplete (strict)", () => {
  it("rejects empty object (missing questions)", () => {
    const result = validateSchoolStaffInteractionComplete({});
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("answer is required") || e.includes("All questions"))
    ).toBe(true);
  });

  it("rejects when not all 2 answers present", () => {
    const result = validateSchoolStaffInteractionComplete({
      questions: {
        gc_staff_concern: { answer: true },
      },
    });
    expect(result.valid).toBe(false);
    const missingErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(missingErrors.length).toBe(1);
  });

  it("rejects null answers (requires boolean, not null)", () => {
    const questions: Record<string, { answer: boolean | null }> = {};
    for (const key of SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: null };
    }
    const result = validateSchoolStaffInteractionComplete({ questions });
    expect(result.valid).toBe(false);
    const nullErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(nullErrors.length).toBe(2);
  });

  it("reports question labels (not keys) in error messages", () => {
    const result = validateSchoolStaffInteractionComplete({
      questions: {},
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Did any school staff raise any concern")
      )
    ).toBe(true);
    expect(
      result.errors.every((e) => !e.includes("gc_staff_concern"))
    ).toBe(true);
  });

  it("accepts fully complete payload", () => {
    const result = validateSchoolStaffInteractionComplete(buildCompletePayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("ignores unknown question keys alongside requiring all known keys", () => {
    const payload = buildCompletePayload();
    (payload.questions as Record<string, { answer: boolean }>).some_future_key =
      { answer: true };
    const result = validateSchoolStaffInteractionComplete(payload);
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys even when questions are complete", () => {
    const payload = { ...buildCompletePayload(), extra: "field" };
    const result = validateSchoolStaffInteractionComplete(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: extra");
  });
});
