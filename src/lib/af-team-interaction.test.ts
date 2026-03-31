import { describe, it, expect } from "vitest";
import {
  AF_TEAM_INTERACTION_CONFIG,
  validateAFTeamInteractionSave,
  validateAFTeamInteractionComplete,
} from "./af-team-interaction";

// Helper: build a complete valid payload
function buildCompletePayload() {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
    questions[key] = { answer: true };
  }
  return {
    teachers: [{ id: 1, name: "Alice" }],
    questions,
  };
}

describe("AF_TEAM_INTERACTION_CONFIG", () => {
  it("has 4 sections with correct titles", () => {
    const titles = AF_TEAM_INTERACTION_CONFIG.sections.map((s) => s.title);
    expect(titles).toEqual([
      "Operational Health",
      "Student Performance on Monthly Tests",
      "Support Needed",
      "Monthly Planning",
    ]);
  });

  it("has 9 total questions with unique keys (3+2+3+1)", () => {
    const counts = AF_TEAM_INTERACTION_CONFIG.sections.map((s) => s.questions.length);
    expect(counts).toEqual([3, 2, 3, 1]);
    expect(AF_TEAM_INTERACTION_CONFIG.allQuestionKeys).toHaveLength(9);
    const unique = new Set(AF_TEAM_INTERACTION_CONFIG.allQuestionKeys);
    expect(unique.size).toBe(9);
  });

  it("allQuestionKeys matches flattened sections in order", () => {
    const flattened = AF_TEAM_INTERACTION_CONFIG.sections.flatMap((s) =>
      s.questions.map((q) => q.key)
    );
    expect(AF_TEAM_INTERACTION_CONFIG.allQuestionKeys).toEqual(flattened);
  });
});

describe("validateAFTeamInteractionSave (lenient)", () => {
  it("accepts empty object {}", () => {
    const result = validateAFTeamInteractionSave({});
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts partial questions (3 of 9 answered)", () => {
    const result = validateAFTeamInteractionSave({
      questions: {
        op_class_duration: { answer: true },
        sp_student_performance: { answer: false },
        mp_monthly_plan: { answer: null },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts valid teachers array", () => {
    const result = validateAFTeamInteractionSave({
      teachers: [{ id: 1, name: "Alice" }],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts fully valid payload", () => {
    const result = validateAFTeamInteractionSave(buildCompletePayload());
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = validateAFTeamInteractionSave({ foo: "bar" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: foo");
  });

  it("ignores unknown question keys (graceful config evolution)", () => {
    const result = validateAFTeamInteractionSave({
      questions: { unknown_key: { answer: true } },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects non-boolean answer value", () => {
    const result = validateAFTeamInteractionSave({
      questions: { op_class_duration: { answer: "yes" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("answer must be true, false, or null");
  });

  it("rejects non-string remark value", () => {
    const result = validateAFTeamInteractionSave({
      questions: { op_class_duration: { answer: true, remark: 123 } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("remark must be a string");
  });

  it("rejects non-array teachers", () => {
    const result = validateAFTeamInteractionSave({ teachers: "Alice" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("teachers must be an array");
  });

  it("rejects teacher entry missing id", () => {
    const result = validateAFTeamInteractionSave({
      teachers: [{ name: "Alice" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("id must be a positive integer");
  });

  it("rejects teacher entry missing name", () => {
    const result = validateAFTeamInteractionSave({
      teachers: [{ id: 1 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("name must be a non-empty string");
  });

  it("rejects non-positive-integer teacher ID", () => {
    const r1 = validateAFTeamInteractionSave({
      teachers: [{ id: -1, name: "A" }],
    });
    expect(r1.valid).toBe(false);

    const r2 = validateAFTeamInteractionSave({
      teachers: [{ id: 1.5, name: "A" }],
    });
    expect(r2.valid).toBe(false);
  });

  it("rejects duplicate teacher IDs", () => {
    const result = validateAFTeamInteractionSave({
      teachers: [
        { id: 1, name: "A" },
        { id: 1, name: "B" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Duplicate teacher id: 1");
  });

  it("rejects teacher with empty name", () => {
    const result = validateAFTeamInteractionSave({
      teachers: [{ id: 1, name: "" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("name must be a non-empty string");
  });

  it("rejects null data", () => {
    const result = validateAFTeamInteractionSave(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects string data", () => {
    const result = validateAFTeamInteractionSave("hello");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });

  it("rejects array data", () => {
    const result = validateAFTeamInteractionSave([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Data must be an object");
  });
});

describe("validateAFTeamInteractionComplete (strict)", () => {
  it("rejects empty object (missing teachers and questions)", () => {
    const result = validateAFTeamInteractionComplete({});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("teacher"))).toBe(true);
    expect(result.errors.some((e) => e.includes("questions") || e.includes("answer is required"))).toBe(true);
  });

  it("rejects empty teachers array", () => {
    const payload = buildCompletePayload();
    payload.teachers = [];
    const result = validateAFTeamInteractionComplete(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one teacher must be selected");
  });

  it("rejects when not all 9 answers present", () => {
    const result = validateAFTeamInteractionComplete({
      teachers: [{ id: 1, name: "A" }],
      questions: {
        op_class_duration: { answer: true },
      },
    });
    expect(result.valid).toBe(false);
    // Should list 8 missing question labels
    const missingErrors = result.errors.filter((e) => e.includes("answer is required"));
    expect(missingErrors.length).toBe(8);
  });

  it("rejects null answers (requires boolean, not null)", () => {
    const questions: Record<string, { answer: boolean | null }> = {};
    for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: null };
    }
    const result = validateAFTeamInteractionComplete({
      teachers: [{ id: 1, name: "A" }],
      questions,
    });
    expect(result.valid).toBe(false);
    const nullErrors = result.errors.filter((e) => e.includes("answer is required"));
    expect(nullErrors.length).toBe(9);
  });

  it("reports question labels (not keys) in error messages", () => {
    const result = validateAFTeamInteractionComplete({
      teachers: [{ id: 1, name: "A" }],
      questions: {},
    });
    expect(result.valid).toBe(false);
    // Should contain label text, not key text
    expect(result.errors.some((e) => e.includes("Does the teacher get"))).toBe(true);
    expect(result.errors.every((e) => !e.includes("op_class_duration"))).toBe(true);
  });

  it("accepts fully complete payload", () => {
    const result = validateAFTeamInteractionComplete(buildCompletePayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("ignores unknown question keys alongside requiring all known keys", () => {
    const payload = buildCompletePayload();
    (payload.questions as Record<string, { answer: boolean }>).some_future_key = { answer: true };
    const result = validateAFTeamInteractionComplete(payload);
    expect(result.valid).toBe(true);
  });
});
