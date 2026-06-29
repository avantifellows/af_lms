import { describe, expect, it } from "vitest";

import {
  CLASSROOM_OBSERVATION_RUBRIC,
  CURRENT_RUBRIC_VERSION,
  VALID_GRADES,
  computeInlineStats,
  computeTotalScore,
  extractRemarks,
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

function buildCurriculumContext() {
  return {
    curriculum_id: 1,
    curriculum_name: "JEE Mains",
    curriculum_code: "JMNS",
    chapter_id: 44,
    chapter_name: "Units and Measurement",
    chapter_code: "11P1",
    chapter_topic_count: 2,
    subject_id: 4,
    subject_name: "Physics",
    topic_id: 101,
    topic_name: "Physical Quantities",
    topic_code: "11P1.1",
  };
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

describe("classroom observation summary extractors", () => {
  it("extracts plural param remarks and observer summaries while computing score stats", () => {
    const data = {
      params: {
        teacher_on_time: { score: 1, remarks: "Started exactly on time" },
        recall_test: { score: 2, remark: "singular field ignored" },
        gender_sensitivity: { score: 3, remarks: "   " },
      },
      observer_summary_strengths: "Strong student engagement",
      observer_summary_improvements: "Needs tighter closure",
    };

    expect(extractRemarks(data)).toEqual([
      {
        label: "Teacher started the class on time",
        text: "Started exactly on time",
      },
      {
        label: "Observer Summary (Strengths)",
        text: "Strong student engagement",
      },
      {
        label: "Observer Summary (Points of Improvement)",
        text: "Needs tighter closure",
      },
    ]);
	    expect(computeInlineStats(data)).toEqual({
	      totalScore: 6,
	      maxScore: 45,
	      remarkCount: 1,
	      curriculumName: null,
	      chapterName: null,
	      subjectName: null,
	      topicName: null,
	    });
	  });

  it("handles missing params and null data gracefully", () => {
    expect(extractRemarks({
      observer_summary_strengths: "Legacy strength",
      observer_summary_improvements: "",
    })).toEqual([
      { label: "Observer Summary (Strengths)", text: "Legacy strength" },
    ]);
    expect(computeInlineStats({ observer_summary_strengths: "Legacy strength" })).toBeNull();
    expect(extractRemarks(null)).toEqual([]);
    expect(computeInlineStats(undefined)).toBeNull();
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
	        ...buildCurriculumContext(),
	        additional_notes: "Teacher requested chapter-level support",
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

  it("rejects non-string action-level additional notes", () => {
    const result = validateClassroomObservationSave({
      additional_notes: 42,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("additional_notes must be a string");
  });

  it("rejects invalid curriculum context field types", () => {
    const result = validateClassroomObservationSave({
      curriculum_id: "1",
      curriculum_name: 123,
      chapter_id: 0,
      chapter_topic_count: -1,
      subject_id: 4.5,
      topic_id: false,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "curriculum_id must be a positive integer",
        "curriculum_name must be a string",
        "chapter_id must be a positive integer",
        "chapter_topic_count must be a non-negative integer",
        "subject_id must be a positive integer",
        "topic_id must be a positive integer",
      ])
    );
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
      ...buildCurriculumContext(),
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

  it("requires curriculum and chapter context for grades 11 and 12", () => {
    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params: buildCompleteParams(),
      teacher_id: 1,
      teacher_name: "Teacher",
      grade: "12",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "curriculum_id is required",
        "curriculum_name is required",
        "chapter_id is required",
        "chapter_name is required",
        "chapter_topic_count is required",
        "subject_id is required",
        "subject_name is required",
      ])
    );
  });

  it("requires topic context when the selected chapter has active topics", () => {
    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params: buildCompleteParams(),
      teacher_id: 1,
      teacher_name: "Teacher",
      grade: "11",
      ...buildCurriculumContext(),
      topic_id: undefined,
      topic_name: undefined,
      topic_code: undefined,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(["topic_id is required", "topic_name is required"])
    );
  });

  it("allows topic context to be empty when the selected chapter has no active topics", () => {
    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params: buildCompleteParams(),
      teacher_id: 1,
      teacher_name: "Teacher",
      grade: "11",
      ...buildCurriculumContext(),
      chapter_topic_count: 0,
      topic_id: undefined,
      topic_name: undefined,
      topic_code: undefined,
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("does not require curriculum context for grade 10", () => {
    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params: buildCompleteParams(),
      teacher_id: 1,
      teacher_name: "Teacher",
      grade: "10",
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects empty teacher_name", () => {
    const result = validateClassroomObservationComplete({
      rubric_version: CURRENT_RUBRIC_VERSION,
      params: buildCompleteParams(),
      teacher_id: 1,
      teacher_name: "",
      grade: "10",
      ...buildCurriculumContext(),
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
