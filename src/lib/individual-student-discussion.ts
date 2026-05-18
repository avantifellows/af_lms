export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface QuestionConfig {
  key: string;
  label: string;
}

export interface SectionConfig {
  title: string;
  questions: QuestionConfig[];
}

export interface IndividualStudentDiscussionConfig {
  sections: SectionConfig[];
  allQuestionKeys: string[];
}

export const VALID_GRADES = [11, 12] as const;
export type ValidGrade = (typeof VALID_GRADES)[number];

export type IndividualStudentQuestionAnswer = {
  answer: boolean | null;
  remark?: string;
};

export interface IndividualStudentRef {
  id: number;
  name: string;
}

export interface IndividualStudentDiscussionEntry {
  id: string;
  grade: ValidGrade;
  students: IndividualStudentRef[];
  questions: Record<string, IndividualStudentQuestionAnswer>;
}

export interface IndividualStudentDiscussionData {
  entries: IndividualStudentDiscussionEntry[];
}

const sections: SectionConfig[] = [
  {
    title: "Operational Health",
    questions: [
      { key: "oh_teaching_concern", label: "Did any student raise a concern on teaching quality and classroom environment?" },
      { key: "oh_additional_support", label: "Did a student request for additional support?" },
    ],
  },
];

export const INDIVIDUAL_STUDENT_DISCUSSION_CONFIG: IndividualStudentDiscussionConfig = {
  sections,
  allQuestionKeys: sections.flatMap((s) => s.questions.map((q) => q.key)),
};

export const ALLOWED_TOP_LEVEL_KEYS = new Set(["entries", "students"]);

const questionKeyToLabel = new Map<string, string>(
  INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.map((key) => {
    const question = sections
      .flatMap((s) => s.questions)
      .find((q) => q.key === key)!;
    return [key, question.label];
  })
);

const knownQuestionKeys = new Set(INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createEntryId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== "function") {
    throw new Error("crypto.randomUUID is unavailable");
  }
  return randomUUID.call(globalThis.crypto);
}

function normalizeQuestions(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

export function isLegacyIndividualStudentDiscussionData(data: unknown): boolean {
  return isPlainObject(data) && "students" in data && !("entries" in data);
}

export function getEntriesFromData(data: unknown): IndividualStudentDiscussionEntry[] {
  if (!isPlainObject(data) || !Array.isArray(data.entries)) {
    return [];
  }

  return data.entries.filter((entry): entry is IndividualStudentDiscussionEntry => {
    if (!isPlainObject(entry) || typeof entry.id !== "string" || entry.id === "") {
      return false;
    }
    if (!isValidGrade(entry.grade) || !Array.isArray(entry.students)) {
      return false;
    }
    if (!isPlainObject(entry.questions)) {
      return false;
    }
    return entry.students.every(
      (student) =>
        isPlainObject(student) &&
        typeof student.id === "number" &&
        Number.isInteger(student.id) &&
        student.id > 0 &&
        typeof student.name === "string" &&
        student.name !== ""
    );
  });
}

export function canonicalizeIndividualStudentDiscussionData(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { entries: [] };
  }

  if ("students" in data && "entries" in data) {
    throw new Error("Payload cannot contain both students and entries");
  }

  if ("entries" in data) {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return {
      entries: entries
        .filter(isPlainObject)
        .map((entry) => ({
          ...entry,
          id: typeof entry.id === "string" && entry.id !== "" ? entry.id : createEntryId(),
        })),
    };
  }

  if (!Array.isArray(data.students)) {
    return { entries: [] };
  }

  const seenStudentIds = new Set<number>();
  const entries = data.students.flatMap((student) => {
    if (!isPlainObject(student)) {
      return [];
    }

    const id = student.id;
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id <= 0 ||
      seenStudentIds.has(id)
    ) {
      return [];
    }

    seenStudentIds.add(id);

    return [
      {
        id: createEntryId(),
        grade: student.grade,
        students: [
          {
            id,
            name: typeof student.name === "string" ? student.name : "",
          },
        ],
        questions: normalizeQuestions(student.questions),
      },
    ];
  });

  return { entries };
}

function isValidGrade(value: unknown): value is ValidGrade {
  return typeof value === "number" && Number.isInteger(value) && (VALID_GRADES as readonly number[]).includes(value);
}

function validateEntries(entries: unknown, strict: boolean): string[] {
  const errors: string[] = [];

  if (!Array.isArray(entries)) {
    errors.push("entries must be an array");
    return errors;
  }

  if (strict && entries.length === 0) {
    errors.push("At least one entry must be recorded");
  }

  const seenEntryIds = new Set<string>();
  const seenStudentIds = new Set<number>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (!isPlainObject(entry)) {
      errors.push(`Entry ${i}: must be an object`);
      continue;
    }

    const record = entry as Record<string, unknown>;

    const entryId = record.id;
    if (typeof entryId !== "string" || entryId === "") {
      errors.push(`Entry ${i}: id must be a non-empty string`);
    } else {
      if (seenEntryIds.has(entryId)) {
        errors.push(`Duplicate entry id: ${entryId}`);
      }
      seenEntryIds.add(entryId);
    }

    const grade = record.grade;
    if (grade === undefined || grade === null) {
      if (strict) {
        errors.push(`Entry ${i}: grade is required`);
      }
    } else if (!isValidGrade(grade)) {
      errors.push(`Entry ${i}: grade must be 11 or 12`);
    }

    const students = record.students;
    if (!Array.isArray(students)) {
      errors.push(`Entry ${i}: students must be an array`);
    } else {
      if (students.length === 0) {
        errors.push(`Entry ${i}: at least one student is required`);
      }

      for (let j = 0; j < students.length; j++) {
        const student = students[j];
        if (!isPlainObject(student)) {
          errors.push(`Entry ${i} student ${j}: must be an object`);
          continue;
        }

        const studentId = student.id;
        if (
          typeof studentId !== "number" ||
          !Number.isInteger(studentId) ||
          studentId <= 0
        ) {
          errors.push(`Entry ${i} student ${j}: id must be a positive integer`);
        } else {
          if (seenStudentIds.has(studentId)) {
            errors.push(`Duplicate student id: ${studentId}`);
          }
          seenStudentIds.add(studentId);
        }

        if (typeof student.name !== "string" || student.name === "") {
          errors.push(`Entry ${i} student ${j}: name must be a non-empty string`);
        }
      }
    }

    const questions = record.questions;
    if (questions === undefined) {
      if (strict) {
        for (const key of knownQuestionKeys) {
          const label = questionKeyToLabel.get(key)!;
          errors.push(`Entry ${i}: ${label}: answer is required`);
        }
      }
      continue;
    }

    if (!isPlainObject(questions)) {
      errors.push(`Entry ${i}: questions must be an object`);
      continue;
    }

    const questionsRecord = questions as Record<string, unknown>;
    for (const key of knownQuestionKeys) {
      const label = questionKeyToLabel.get(key)!;
      const value = questionsRecord[key];

      if (value === undefined) {
        if (strict) {
          errors.push(`Entry ${i}: ${label}: answer is required`);
        }
        continue;
      }

      if (!isPlainObject(value)) {
        errors.push(`Entry ${i}: ${label}: must be an object`);
        continue;
      }

      const qEntry = value as Record<string, unknown>;

      if ("answer" in qEntry) {
        const answer = qEntry.answer;
        if (answer !== null && typeof answer !== "boolean") {
          errors.push(`Entry ${i}: ${label}: answer must be true, false, or null`);
        } else if (strict && answer === null) {
          errors.push(`Entry ${i}: ${label}: answer is required`);
        }
      } else if (strict) {
        errors.push(`Entry ${i}: ${label}: answer is required`);
      }

      if ("remark" in qEntry && qEntry.remark !== undefined && typeof qEntry.remark !== "string") {
        errors.push(`Entry ${i}: ${label}: remark must be a string`);
      }
    }
  }

  return errors;
}

function getCanonicalEntriesForValidation(payload: Record<string, unknown>): {
  entries?: unknown;
  errors: string[];
} {
  if ("students" in payload && "entries" in payload) {
    return {
      errors: ["Payload cannot contain both students and entries"],
    };
  }

  if ("entries" in payload) {
    return { entries: payload.entries, errors: [] };
  }

  if ("students" in payload) {
    try {
      return {
        entries: canonicalizeIndividualStudentDiscussionData(payload).entries,
        errors: [],
      };
    } catch (error) {
      return {
        errors: [error instanceof Error ? error.message : "Invalid individual student discussion payload"],
      };
    }
  }

  return { entries: undefined, errors: [] };
}

export function validateIndividualStudentDiscussionSave(data: unknown): ValidationResult {
  if (!isPlainObject(data)) {
    return { valid: false, errors: ["Data must be an object"] };
  }

  const errors: string[] = [];
  const payload = data as Record<string, unknown>;

  const unknownKeys = Object.keys(payload)
    .filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key))
    .sort();
  for (const key of unknownKeys) {
    errors.push(`Unknown field: ${key}`);
  }

  const canonical = getCanonicalEntriesForValidation(payload);
  errors.push(...canonical.errors);

  if (canonical.entries !== undefined) {
    errors.push(...validateEntries(canonical.entries, false));
  }

  return { valid: errors.length === 0, errors };
}

export function validateIndividualStudentDiscussionComplete(data: unknown): ValidationResult {
  if (!isPlainObject(data)) {
    return { valid: false, errors: ["Data must be an object"] };
  }

  const errors: string[] = [];
  const payload = data as Record<string, unknown>;

  const unknownKeys = Object.keys(payload)
    .filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key))
    .sort();
  for (const key of unknownKeys) {
    errors.push(`Unknown field: ${key}`);
  }

  const canonical = getCanonicalEntriesForValidation(payload);
  errors.push(...canonical.errors);

  if (
    "students" in payload &&
    !("entries" in payload) &&
    Array.isArray(payload.students) &&
    payload.students.length === 0
  ) {
    errors.push("At least one student must be recorded");
  }

  if (canonical.entries === undefined) {
    errors.push("At least one entry must be recorded");
  } else {
    errors.push(...validateEntries(canonical.entries, true));
  }

  return { valid: errors.length === 0, errors };
}
