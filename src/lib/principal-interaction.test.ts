import { describe, it, expect } from "vitest";
import {
  PRINCIPAL_INTERACTION_CONFIG,
  validatePrincipalInteractionSave,
  validatePrincipalInteractionComplete,
} from "./principal-interaction";

// Helper: build a complete valid payload (no teachers — just questions)
function buildCompletePayload() {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
    questions[key] = { answer: true };
  }
  return { questions };
}

describe("PRINCIPAL_INTERACTION_CONFIG", () => {
  it("has 5 sections with correct titles", () => {
    const titles = PRINCIPAL_INTERACTION_CONFIG.sections.map((s) => s.title);
    expect(titles).toEqual([
      "Operational Health",
      "Implementation Progress",
      "Student Performance on Monthly Tests",
      "Support Needed",
      "Monthly Planning",
    ]);
  });

  it("has 7 total questions with unique keys (1+2+1+1+2)", () => {
    const counts = PRINCIPAL_INTERACTION_CONFIG.sections.map(
      (s) => s.questions.length
    );
    expect(counts).toEqual([1, 2, 1, 1, 2]);
    expect(PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys).toHaveLength(7);
    const unique = new Set(PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys);
    expect(unique.size).toBe(7);
  });

  it("allQuestionKeys matches flattened sections in order", () => {
    const flattened = PRINCIPAL_INTERACTION_CONFIG.sections.flatMap((s) =>
      s.questions.map((q) => q.key)
    );
    expect(PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys).toEqual(flattened);
  });

  it("has the expected question keys", () => {
    expect(PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys).toEqual([
      "oh_program_feedback",
      "ip_curriculum_progress",
      "ip_key_events",
      "sp_student_performance",
      "sn_concerns_raised",
      "mp_monthly_plan",
      "mp_permissions_obtained",
    ]);
  });
});

describe("validatePrincipalInteractionSave (lenient)", () => {
  it("accepts empty object {}", () => {
    const result = validatePrincipalInteractionSave({});
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts partial questions (2 of 7 answered)", () => {
    const result = validatePrincipalInteractionSave({
      questions: {
        oh_program_feedback: { answer: true },
        sp_student_performance: { answer: false },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts null answer values (unanswered)", () => {
    const result = validatePrincipalInteractionSave({
      questions: {
        oh_program_feedback: { answer: null },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts questions with remarks", () => {
    const result = validatePrincipalInteractionSave({
      questions: {
        oh_program_feedback: { answer: true, remark: "Good feedback" },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts fully valid payload", () => {
    const result = validatePrincipalInteractionSave(buildCompletePayload());
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = validatePrincipalInteractionSave({ foo: "bar" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: foo");
  });

  it("rejects teachers top-level key (not allowed for principal interaction)", () => {
    const result = validatePrincipalInteractionSave({
      teachers: [{ id: 1, name: "Alice" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: teachers");
  });

  it("ignores unknown question keys (graceful config evolution)", () => {
    const result = validatePrincipalInteractionSave({
      questions: { unknown_key: { answer: true } },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects non-boolean answer value", () => {
    const result = validatePrincipalInteractionSave({
      questions: { oh_program_feedback: { answer: "yes" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("answer must be true, false, or null");
  });

  it("rejects non-string remark value", () => {
    const result = validatePrincipalInteractionSave({
      questions: { oh_program_feedback: { answer: true, remark: 123 } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("remark must be a string");
  });

  it("rejects null data", () => {
    const result = validatePrincipalInteractionSave(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects string data", () => {
    const result = validatePrincipalInteractionSave("hello");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects array data", () => {
    const result = validatePrincipalInteractionSave([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });
});

describe("validatePrincipalInteractionComplete (strict)", () => {
  it("rejects empty object (missing questions)", () => {
    const result = validatePrincipalInteractionComplete({});
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("answer is required") || e.includes("All questions"))
    ).toBe(true);
  });

  it("rejects when not all 7 answers present", () => {
    const result = validatePrincipalInteractionComplete({
      questions: {
        oh_program_feedback: { answer: true },
      },
    });
    expect(result.valid).toBe(false);
    // Should list 6 missing question labels
    const missingErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(missingErrors.length).toBe(6);
  });

  it("rejects null answers (requires boolean, not null)", () => {
    const questions: Record<string, { answer: boolean | null }> = {};
    for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: null };
    }
    const result = validatePrincipalInteractionComplete({ questions });
    expect(result.valid).toBe(false);
    const nullErrors = result.errors.filter((e) =>
      e.includes("answer is required")
    );
    expect(nullErrors.length).toBe(7);
  });

  it("reports question labels (not keys) in error messages", () => {
    const result = validatePrincipalInteractionComplete({
      questions: {},
    });
    expect(result.valid).toBe(false);
    // Should contain label text, not key text
    expect(
      result.errors.some((e) =>
        e.includes("Does the Principal have any feedback")
      )
    ).toBe(true);
    expect(
      result.errors.every((e) => !e.includes("oh_program_feedback"))
    ).toBe(true);
  });

  it("accepts fully complete payload", () => {
    const result = validatePrincipalInteractionComplete(buildCompletePayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("ignores unknown question keys alongside requiring all known keys", () => {
    const payload = buildCompletePayload();
    (payload.questions as Record<string, { answer: boolean }>).some_future_key =
      { answer: true };
    const result = validatePrincipalInteractionComplete(payload);
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys even when questions are complete", () => {
    const payload = { ...buildCompletePayload(), extra: "field" };
    const result = validatePrincipalInteractionComplete(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: extra");
  });
});
