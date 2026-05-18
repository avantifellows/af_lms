import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_TOP_LEVEL_KEYS,
  INDIVIDUAL_STUDENT_DISCUSSION_CONFIG,
  canonicalizeIndividualStudentDiscussionData,
  getEntriesFromData,
  isLegacyIndividualStudentDiscussionData,
  validateIndividualStudentDiscussionComplete,
  validateIndividualStudentDiscussionSave,
  type IndividualStudentDiscussionData,
  type IndividualStudentDiscussionEntry,
  type IndividualStudentRef,
} from "./individual-student-discussion";

function stubUuidSequence(...ids: string[]) {
  let index = 0;
  const randomUUID = vi.fn(() => ids[index++] ?? `generated-${index}`);
  vi.stubGlobal("crypto", { randomUUID });
  return randomUUID;
}

function buildCompleteQuestions(answer = true) {
  return Object.fromEntries(
    INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.map((key) => [
      key,
      { answer },
    ])
  );
}

function buildLegacyStudent(
  id: number,
  name = `Student ${id}`,
  grade = 11
): {
  id: number;
  name: string;
  grade: number;
  questions: Record<string, { answer: boolean }>;
} {
  return {
    id,
    name,
    grade,
    questions: buildCompleteQuestions(),
  };
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
    const questions = buildLegacyStudent(1, "Alice", 12).questions;
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

  it("allows both transition top-level keys", () => {
    expect(ALLOWED_TOP_LEVEL_KEYS.has("entries")).toBe(true);
    expect(ALLOWED_TOP_LEVEL_KEYS.has("students")).toBe(true);
  });
});

describe("canonicalizeIndividualStudentDiscussionData", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("converts legacy students to solo entries with generated IDs and entry-level questions", () => {
    stubUuidSequence("entry-1");

    const result = canonicalizeIndividualStudentDiscussionData({
      students: [
        {
          id: 1,
          name: "Alice",
          grade: 11,
          questions: { oh_teaching_concern: { answer: true } },
        },
      ],
    });

    expect(result).toEqual({
      entries: [
        {
          id: "entry-1",
          grade: 11,
          students: [{ id: 1, name: "Alice" }],
          questions: { oh_teaching_concern: { answer: true } },
        },
      ],
    });
  });

  it("passes entries with existing IDs through without generating new IDs", () => {
    const randomUUID = stubUuidSequence("unused");
    const payload = { entries: [buildEntry("existing-entry")] };

    expect(canonicalizeIndividualStudentDiscussionData(payload)).toEqual(payload);
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it("is idempotent after legacy data has been converted", () => {
    const randomUUID = stubUuidSequence("entry-1", "entry-2");
    const legacy = { students: [buildLegacyStudent(1), buildLegacyStudent(2)] };

    const first = canonicalizeIndividualStudentDiscussionData(legacy);
    const second = canonicalizeIndividualStudentDiscussionData(first);

    expect(second).toEqual(first);
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it("keeps the first duplicate legacy student ID and drops later duplicates", () => {
    stubUuidSequence("entry-1", "entry-2");

    const result = canonicalizeIndividualStudentDiscussionData({
      students: [
        buildLegacyStudent(1, "Alice"),
        buildLegacyStudent(1, "Duplicate Alice"),
        buildLegacyStudent(2, "Bob"),
      ],
    });

    expect(result).toMatchObject({
      entries: [
        { id: "entry-1", students: [{ id: 1, name: "Alice" }] },
        { id: "entry-2", students: [{ id: 2, name: "Bob" }] },
      ],
    });
  });

  it("generates IDs for entries missing IDs", () => {
    stubUuidSequence("generated-entry");

    const result = canonicalizeIndividualStudentDiscussionData({
      entries: [{ grade: 11, students: [{ id: 1, name: "Alice" }], questions: {} }],
    });

    expect(result).toMatchObject({
      entries: [{ id: "generated-entry" }],
    });
  });

  it("throws for dual-key payloads", () => {
    expect(() =>
      canonicalizeIndividualStudentDiscussionData({
        students: [],
        entries: [],
      })
    ).toThrow("both students and entries");
  });

  it("returns empty entries for empty, null, and malformed payloads", () => {
    expect(canonicalizeIndividualStudentDiscussionData(null)).toEqual({ entries: [] });
    expect(canonicalizeIndividualStudentDiscussionData({})).toEqual({ entries: [] });
    expect(canonicalizeIndividualStudentDiscussionData({ students: "bad" })).toEqual({
      entries: [],
    });
  });

  it("filters non-object legacy students", () => {
    stubUuidSequence("entry-1");

    const result = canonicalizeIndividualStudentDiscussionData({
      students: [null, "bad", buildLegacyStudent(1, "Alice")],
    });

    expect(result).toMatchObject({
      entries: [{ id: "entry-1", students: [{ id: 1, name: "Alice" }] }],
    });
  });

  it("normalizes null and missing questions to empty objects", () => {
    stubUuidSequence("entry-1", "entry-2");

    const result = canonicalizeIndividualStudentDiscussionData({
      students: [
        { id: 1, name: "Alice", grade: 11, questions: null },
        { id: 2, name: "Bob", grade: 12 },
      ],
    });

    expect(result).toMatchObject({
      entries: [{ questions: {} }, { questions: {} }],
    });
  });

  it("preserves null legacy grades for migration review", () => {
    stubUuidSequence("entry-1");

    const result = canonicalizeIndividualStudentDiscussionData({
      students: [{ id: 1, name: "Alice", grade: null, questions: {} }],
    });

    expect(result).toEqual({
      entries: [
        {
          id: "entry-1",
          grade: null,
          students: [{ id: 1, name: "Alice" }],
          questions: {},
        },
      ],
    });
  });

  it("round-trips migrated fixture data without changing entry IDs", () => {
    const randomUUID = stubUuidSequence("entry-a", "entry-b");
    const migrated = canonicalizeIndividualStudentDiscussionData({
      students: [
        buildLegacyStudent(101, "Asha", 11),
        "malformed",
        buildLegacyStudent(102, "Kabir", 12),
        buildLegacyStudent(101, "Duplicate Asha", 11),
      ],
    });

    expect(validateIndividualStudentDiscussionComplete(migrated).valid).toBe(true);
    expect(canonicalizeIndividualStudentDiscussionData(migrated)).toEqual(migrated);
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });
});

describe("shape helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects legacy payloads without side effects", () => {
    expect(isLegacyIndividualStudentDiscussionData({ students: [] })).toBe(true);
    expect(isLegacyIndividualStudentDiscussionData({ entries: [] })).toBe(false);
    expect(isLegacyIndividualStudentDiscussionData({ students: [], entries: [] })).toBe(false);
    expect(isLegacyIndividualStudentDiscussionData(null)).toBe(false);
  });

  it("extracts valid entries without canonicalizing or generating IDs", () => {
    const randomUUID = stubUuidSequence("must-not-be-used");
    const entry = buildEntry("entry-1", [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);

    expect(getEntriesFromData({ entries: [entry, { grade: 11 }] })).toEqual([entry]);
    expect(getEntriesFromData({ students: [buildLegacyStudent(1)] })).toEqual([]);
    expect(getEntriesFromData(null)).toEqual([]);
    expect(randomUUID).not.toHaveBeenCalled();
  });
});

describe("validateIndividualStudentDiscussionSave (lenient)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("accepts legacy students during the transition window", () => {
    stubUuidSequence("entry-1");

    const result = validateIndividualStudentDiscussionSave({
      students: [{ id: 1, name: "Alice", grade: 11, questions: {} }],
    });

    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = validateIndividualStudentDiscussionSave({ foo: "bar" });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown field: foo");
  });

  it("rejects dual-key payloads", () => {
    const result = validateIndividualStudentDiscussionSave({
      students: [],
      entries: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Payload cannot contain both students and entries");
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("accepts complete legacy students during the transition window", () => {
    stubUuidSequence("entry-1", "entry-2");

    const result = validateIndividualStudentDiscussionComplete({
      students: [buildLegacyStudent(1), buildLegacyStudent(2, "Bob", 12)],
    });

    expect(result.valid).toBe(true);
  });

  it("rejects dual-key payloads", () => {
    const result = validateIndividualStudentDiscussionComplete({
      students: [buildLegacyStudent(1)],
      entries: [buildEntry()],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Payload cannot contain both students and entries");
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
