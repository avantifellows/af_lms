import { describe, expect, it } from "vitest";

import {
  CLASSROOM_OBSERVATION_RUBRIC,
  CURRENT_RUBRIC_VERSION,
  VALID_GRADES,
  computeTotalScore,
  validateClassroomObservationComplete,
  validateClassroomObservationSave,
} from "./classroom-observation-rubric";

function buildCompleteParams(): Record<string, { score: number }> {
  const params: Record<string, { score: number }> = {};
  for (const parameter of CLASSROOM_OBSERVATION_RUBRIC.parameters) {
    params[parameter.key] = { score: parameter.maxScore };
  }
  return params;
}

describe("classroom-observation-rubric config", () => {
  it("defines rubric v1 with 19 parameters and max score 45", () => {
    expect(CURRENT_RUBRIC_VERSION).toBe("1.0");
    expect(CLASSROOM_OBSERVATION_RUBRIC.parameters).toHaveLength(19);
    expect(CLASSROOM_OBSERVATION_RUBRIC.maxScore).toBe(45);
    expect(
      CLASSROOM_OBSERVATION_RUBRIC.parameters.reduce((sum, parameter) => sum + parameter.maxScore, 0)
    ).toBe(45);
  });

  it("has unique keys and each parameter includes an option with its max score", () => {
    const keys = CLASSROOM_OBSERVATION_RUBRIC.parameters.map((parameter) => parameter.key);
    expect(new Set(keys).size).toBe(19);

    for (const parameter of CLASSROOM_OBSERVATION_RUBRIC.parameters) {
      const optionScores = parameter.options.map((option) => option.score);
      expect(optionScores).toContain(parameter.maxScore);
    }
  });
});

describe("computeTotalScore", () => {
  it("returns 0 for empty params", () => {
    expect(computeTotalScore(undefined)).toBe(0);
    expect(computeTotalScore({})).toBe(0);
  });

  it("sums partial scores", () => {
    expect(
      computeTotalScore({
        teacher_on_time: { score: 1 },
        recall_test: { score: 2 },
        gender_sensitivity: { score: 3 },
      })
    ).toBe(6);
  });

  it("returns 45 for maxed scores", () => {
    expect(computeTotalScore(buildCompleteParams())).toBe(45);
  });
});

describe("validateClassroomObservationSave", () => {
  it("accepts empty payload and partial payloads", () => {
    expect(validateClassroomObservationSave({})).toEqual({ valid: true, errors: [] });
    expect(
      validateClassroomObservationSave({
        params: {
          teacher_on_time: { score: 1 },
          recall_test: { score: 2, remarks: "interactive" },
        },
        observer_summary_strengths: "strong structure",
      })
    ).toEqual({ valid: true, errors: [] });
  });

  it("rejects invalid score values", () => {
    const outOfRange = validateClassroomObservationSave({
      params: { teacher_on_time: { score: 2 } },
    });
    expect(outOfRange.valid).toBe(false);
    expect(outOfRange.errors).toContain(
      "Invalid score for Teacher started the class on time. Allowed scores: 0, 1"
    );

    const nonNumber = validateClassroomObservationSave({
      params: { teacher_on_time: { score: "1" } },
    });
    expect(nonNumber.valid).toBe(false);
    expect(nonNumber.errors).toContain("score for Teacher started the class on time must be a number");
  });

  it("rejects unknown top-level keys", () => {
    const result = validateClassroomObservationSave({
      params: {},
      legacy_key: "old-value",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown top-level field: legacy_key");
  });

  it("rejects unknown rubric versions when provided", () => {
    const result = validateClassroomObservationSave({
      rubric_version: "2.0",
      params: {},
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unsupported classroom observation rubric_version: 2.0");
  });
});

describe("validateClassroomObservationComplete", () => {
  it("rejects missing params and reports missing labels", () => {
    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params: {
        teacher_on_time: { score: 1 },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing score for Teacher Grooming");
    expect(result.errors).toContain("Missing score for Gender Sensitivity Parameters");
  });

  it("rejects missing or unknown rubric_version", () => {
    const missingVersion = validateClassroomObservationComplete({
      params: buildCompleteParams(),
    });
    expect(missingVersion.valid).toBe(false);
    expect(missingVersion.errors).toContain("rubric_version is required");

    const unknownVersion = validateClassroomObservationComplete({
      rubric_version: "2.0",
      params: buildCompleteParams(),
    });
    expect(unknownVersion.valid).toBe(false);
    expect(unknownVersion.errors).toContain("Unsupported classroom observation rubric_version: 2.0");
  });

  it("accepts a fully complete payload with teacher and grade", () => {
    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params: buildCompleteParams(),
      teacher_id: 42,
      teacher_name: "Jane Doe",
      grade: "11",
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects missing teacher_id, teacher_name, and grade", () => {
    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params: buildCompleteParams(),
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("teacher_id is required");
    expect(result.errors).toContain("teacher_name is required");
    expect(result.errors).toContain("grade is required");
  });

  it("rejects empty teacher_name", () => {
    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params: buildCompleteParams(),
      teacher_id: 1,
      teacher_name: "",
      grade: "10",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("teacher_name is required");
  });

  it("rejects time_management score=0 because valid scores are 1, 2, 3", () => {
    const params = buildCompleteParams();
    params.time_management = { score: 0 };

    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params,
      teacher_id: 1,
      teacher_name: "Teacher",
      grade: "10",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Invalid score for Class structure - Time management. Allowed scores: 1, 2, 3"
    );
  });
});

describe("teacher_id, teacher_name, and grade validation", () => {
  it("VALID_GRADES contains 10, 11, 12", () => {
    expect(VALID_GRADES).toEqual(["10", "11", "12"]);
  });

  describe("lenient (save)", () => {
    it("accepts payload with valid teacher_id, teacher_name, and grade", () => {
      const result = validateClassroomObservationSave({
        teacher_id: 5,
        teacher_name: "Alice",
        grade: "12",
      });
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it("accepts payload without teacher_id, teacher_name, or grade (all optional)", () => {
      expect(validateClassroomObservationSave({})).toEqual({ valid: true, errors: [] });
    });

    it("rejects teacher_id that is not a positive integer", () => {
      for (const badValue of [0, -1, 1.5, "1", NaN, true]) {
        const result = validateClassroomObservationSave({ teacher_id: badValue });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("teacher_id must be a positive integer");
      }
    });

    it("rejects teacher_name that is not a string", () => {
      const result = validateClassroomObservationSave({ teacher_name: 123 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("teacher_name must be a string");
    });

    it("rejects invalid grade values", () => {
      for (const badGrade of ["9", "13", 10, "ten", ""]) {
        const result = validateClassroomObservationSave({ grade: badGrade });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("grade must be one of: 10, 11, 12");
      }
    });

    it("accepts each valid grade", () => {
      for (const grade of VALID_GRADES) {
        const result = validateClassroomObservationSave({ grade });
        expect(result).toEqual({ valid: true, errors: [] });
      }
    });
  });

  describe("strict (complete)", () => {
    it("requires teacher_id, teacher_name, and grade", () => {
      const result = validateClassroomObservationComplete({
        rubric_version: CURRENT_RUBRIC_VERSION,
        params: buildCompleteParams(),
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("teacher_id is required");
      expect(result.errors).toContain("teacher_name is required");
      expect(result.errors).toContain("grade is required");
    });

    it("rejects invalid teacher_id type even when present", () => {
      const result = validateClassroomObservationComplete({
        rubric_version: CURRENT_RUBRIC_VERSION,
        params: buildCompleteParams(),
        teacher_id: "abc",
        teacher_name: "Teacher",
        grade: "10",
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("teacher_id must be a positive integer");
    });

    it("rejects invalid grade in strict mode", () => {
      const result = validateClassroomObservationComplete({
        rubric_version: CURRENT_RUBRIC_VERSION,
        params: buildCompleteParams(),
        teacher_id: 1,
        teacher_name: "Teacher",
        grade: "9",
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("grade must be one of: 10, 11, 12");
    });
  });
});
