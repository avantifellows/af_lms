import { describe, expect, it } from "vitest";
import {
  ALLOWED_TOP_LEVEL_KEYS,
  INDIVIDUAL_STUDENT_DISCUSSION_CONFIG,
  computeInlineStats,
  extractRemarks,
  getEntriesFromData,
  validateIndividualStudentDiscussionComplete,
  validateIndividualStudentDiscussionSave,
  type IndividualStudentDiscussionData,
  type IndividualStudentDiscussionEntry,
  type IndividualStudentRef,
} from "./individual-student-discussion";

function buildCompleteQuestions(answer = true) {
  return Object.fromEntries(
    INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.map((key) => [
      key,
      { answer },
    ])
  );
}

function buildEntry(
  id = "entry-1",
  students: IndividualStudentRef[] = [{ id: 1, name: "Alice" }]
): IndividualStudentDiscussionEntry {
  return {
    id,
    grade: 11,
    students,
    questions: buildCompleteQuestions(),
  };
}

describe("INDIVIDUAL_STUDENT_DISCUSSION_CONFIG", () => {
  it("has the expected one-section, two-question contract", () => {
    expect(INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.sections).toHaveLength(1);
    expect(INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.sections[0].title).toBe(
      "Operational Health"
    );
    expect(INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys).toEqual([
      "oh_teaching_concern",
      "oh_additional_support",
    ]);
    expect(new Set(INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys).size).toBe(2);
  });

  it("exports the entries-based data types", () => {
    const questions = buildCompleteQuestions();
    const student: IndividualStudentRef = { id: 1, name: "Alice" };
    const entry: IndividualStudentDiscussionEntry = {
      id: "entry-1",
      grade: 12,
      students: [student],
      questions,
    };
    const data: IndividualStudentDiscussionData = { entries: [entry] };

    expect(data.entries[0].students).toEqual([student]);
  });

  it("allows only entries as top-level key", () => {
    expect(ALLOWED_TOP_LEVEL_KEYS.has("entries")).toBe(true);
    expect(ALLOWED_TOP_LEVEL_KEYS.has("students")).toBe(false);
  });
});

describe("getEntriesFromData", () => {
  it("extracts valid entries and filters malformed ones", () => {
    const entry = buildEntry("entry-1", [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);

    expect(getEntriesFromData({ entries: [entry, { grade: 11 }] })).toEqual([entry]);
    expect(getEntriesFromData(null)).toEqual([]);
    expect(getEntriesFromData({})).toEqual([]);
  });
});

describe("validateIndividualStudentDiscussionSave (lenient)", () => {

  it("accepts empty object and empty entries", () => {
    expect(validateIndividualStudentDiscussionSave({})).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateIndividualStudentDiscussionSave({ entries: [] })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("accepts partial entries with missing question answers", () => {
    const result = validateIndividualStudentDiscussionSave({
      entries: [
        {
          id: "entry-1",
          grade: 11,
          students: [{ id: 1, name: "Alice" }],
          questions: { oh_teaching_concern: { answer: true } },
        },
      ],
    });

    expect(result.valid).toBe(true);
  });

  it("accepts missing, null, or undefined entry grades", () => {
    expect(
      validateIndividualStudentDiscussionSave({
        entries: [{ id: "entry-1", students: [{ id: 1, name: "Alice" }], questions: {} }],
      }).valid
    ).toBe(true);
    expect(
      validateIndividualStudentDiscussionSave({
        entries: [{ id: "entry-1", grade: null, students: [{ id: 1, name: "Alice" }], questions: {} }],
      }).valid
    ).toBe(true);
  });

  it("rejects legacy students key", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [{ id: 1, name: "Alice", grade: 11, questions: {} }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: students");
  });

  it("rejects unknown top-level keys", () => {
    const result = validateIndividualStudentDiscussionSave({ foo: "bar" });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: foo");
  });

  it("rejects non-array entries", () => {
    const result = validateIndividualStudentDiscussionSave({ entries: "bad" });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("entries must be an array");
  });

  it("rejects missing and duplicate entry IDs", () => {
    const missing = validateIndividualStudentDiscussionSave({
      entries: [{ grade: 11, students: [{ id: 1, name: "Alice" }], questions: {} }],
    });
    const duplicate = validateIndividualStudentDiscussionSave({
      entries: [
        { id: "entry-1", grade: 11, students: [{ id: 1, name: "Alice" }], questions: {} },
        { id: "entry-1", grade: 12, students: [{ id: 2, name: "Bob" }], questions: {} },
      ],
    });

    expect(missing.errors).toContain("Entry 0: id must be a non-empty string");
    expect(duplicate.errors).toContain("Duplicate entry id: entry-1");
  });

  it("rejects invalid present grades", () => {
    const result = validateIndividualStudentDiscussionSave({
      entries: [{ id: "entry-1", grade: 10, students: [{ id: 1, name: "Alice" }], questions: {} }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Entry 0: grade must be 11 or 12");
  });

  it("rejects entries with empty students", () => {
    const result = validateIndividualStudentDiscussionSave({
      entries: [{ id: "entry-1", grade: 11, students: [], questions: {} }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Entry 0: at least one student is required");
  });

  it("rejects duplicate students within the same entry and across entries", () => {
    const within = validateIndividualStudentDiscussionSave({
      entries: [
        {
          id: "entry-1",
          grade: 11,
          students: [
            { id: 1, name: "Alice" },
            { id: 1, name: "Alice Again" },
          ],
          questions: {},
        },
      ],
    });
    const across = validateIndividualStudentDiscussionSave({
      entries: [
        { id: "entry-1", grade: 11, students: [{ id: 1, name: "Alice" }], questions: {} },
        { id: "entry-2", grade: 11, students: [{ id: 1, name: "Alice" }], questions: {} },
      ],
    });

    expect(within.errors).toContain("Duplicate student id: 1");
    expect(across.errors).toContain("Duplicate student id: 1");
  });

  it("rejects invalid student refs, question objects, answers, and remarks", () => {
    const result = validateIndividualStudentDiscussionSave({
      entries: [
        {
          id: "entry-1",
          grade: 11,
          students: [{ id: 0, name: "" }],
          questions: {
            oh_teaching_concern: { answer: "yes", remark: 123 },
            oh_additional_support: "bad",
          },
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Entry 0 student 0: id must be a positive integer");
    expect(result.errors).toContain("Entry 0 student 0: name must be a non-empty string");
    expect(result.errors.some((error) => error.includes("answer must be true, false, or null"))).toBe(true);
    expect(result.errors.some((error) => error.includes("remark must be a string"))).toBe(true);
    expect(result.errors.some((error) => error.includes("must be an object"))).toBe(true);
  });

  it("rejects null, string, and array payloads", () => {
    expect(validateIndividualStudentDiscussionSave(null).errors).toContain("Data must be an object");
    expect(validateIndividualStudentDiscussionSave("hello").errors).toContain("Data must be an object");
    expect(validateIndividualStudentDiscussionSave([]).errors).toContain("Data must be an object");
  });
});

describe("validateIndividualStudentDiscussionComplete (strict)", () => {

  it("requires at least one entry", () => {
    expect(validateIndividualStudentDiscussionComplete({}).errors).toContain(
      "At least one entry must be recorded"
    );
    expect(validateIndividualStudentDiscussionComplete({ entries: [] }).errors).toContain(
      "At least one entry must be recorded"
    );
  });

  it("accepts complete entries payloads", () => {
    const result = validateIndividualStudentDiscussionComplete({
      entries: [buildEntry("entry-1"), buildEntry("entry-2", [{ id: 2, name: "Bob" }])],
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("requires entry id, grade, students, and questions", () => {
    const result = validateIndividualStudentDiscussionComplete({
      entries: [{ id: "", students: [], questions: {} }],
    });

    expect(result.errors).toContain("Entry 0: id must be a non-empty string");
    expect(result.errors).toContain("Entry 0: grade is required");
    expect(result.errors).toContain("Entry 0: at least one student is required");
    expect(result.errors.filter((error) => error.includes("answer is required"))).toHaveLength(2);
  });

  it("rejects null answers in strict mode", () => {
    const result = validateIndividualStudentDiscussionComplete({
      entries: [
        {
          id: "entry-1",
          grade: 11,
          students: [{ id: 1, name: "Alice" }],
          questions: {
            oh_teaching_concern: { answer: null },
            oh_additional_support: { answer: true },
          },
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Entry 0: Did any student raise a concern on teaching quality and classroom environment?: answer is required"
    );
  });

  it("rejects duplicate entry IDs and duplicate student IDs", () => {
    const result = validateIndividualStudentDiscussionComplete({
      entries: [
        buildEntry("entry-1", [{ id: 1, name: "Alice" }]),
        buildEntry("entry-1", [{ id: 1, name: "Alice" }]),
      ],
    });

    expect(result.errors).toContain("Duplicate entry id: entry-1");
    expect(result.errors).toContain("Duplicate student id: 1");
  });

  it("uses zero-based entry indexes in validation errors", () => {
    const result = validateIndividualStudentDiscussionComplete({
      entries: [{ id: "entry-1", grade: 10, students: [{ id: 1, name: "Alice" }], questions: {} }],
    });

    expect(result.errors).toContain("Entry 0: grade must be 11 or 12");
  });
});

describe("individual student discussion summary extractors", () => {
  it("labels remarks with student names and computes entry/student stats", () => {
    const data = {
      entries: [
        {
          id: "entry-1",
          grade: 11,
          students: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
          questions: {
            oh_teaching_concern: { answer: true, remark: "Students want slower pacing" },
            oh_additional_support: { answer: false },
          },
        },
        {
          id: "entry-2",
          grade: 12,
          students: [{ id: 3, name: "Carol" }],
          questions: {
            oh_teaching_concern: { answer: null, remark: "   " },
          },
        },
      ],
    };

    expect(extractRemarks(data)).toEqual([
      {
        label: "Alice, Bob: Did any student raise a concern on teaching quality and classroom environment?",
        text: "Students want slower pacing",
      },
    ]);
    expect(computeInlineStats(data)).toEqual({
      entryCount: 2,
      studentCount: 3,
      avgAnswered: 1,
      totalQuestions: 2,
    });
  });

  it("returns empty remarks and null stats for legacy students shape", () => {
    expect(extractRemarks({ students: [{ id: 1, name: "Alice" }] })).toEqual([]);
    expect(computeInlineStats({ students: [{ id: 1, name: "Alice" }] })).toBeNull();
    expect(extractRemarks(null)).toEqual([]);
    expect(computeInlineStats(undefined)).toBeNull();
  });
});
