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

export interface IndividualStudentEntry {
  id: number;
  name: string;
  grade: number;
  questions: Record<string, { answer: boolean | null; remark?: string }>;
}

export interface IndividualStudentDiscussionData {
  students: IndividualStudentEntry[];
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

const ALLOWED_TOP_LEVEL_KEYS = new Set(["students"]);

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

function isValidGrade(value: unknown): value is ValidGrade {
  return typeof value === "number" && Number.isInteger(value) && (VALID_GRADES as readonly number[]).includes(value);
}

function validateStudentEntries(students: unknown, strict: boolean): string[] {
  const errors: string[] = [];

  if (!Array.isArray(students)) {
    errors.push("students must be an array");
    return errors;
  }

  const seenIds = new Set<number>();

  for (let i = 0; i < students.length; i++) {
    const entry = students[i];

    if (!isPlainObject(entry)) {
      errors.push(`Student entry ${i}: must be an object`);
      continue;
    }

    const record = entry as Record<string, unknown>;

    // Validate id
    const id = record.id;
    if (
      typeof id !== "number" ||
      !Number.isFinite(id) ||
      id <= 0 ||
      !Number.isInteger(id)
    ) {
      errors.push(`Student entry ${i}: id must be a positive integer`);
    } else {
      if (seenIds.has(id)) {
        errors.push(`Duplicate student id: ${id}`);
      }
      seenIds.add(id);
    }

    // Validate name
    const name = record.name;
    if (typeof name !== "string" || name === "") {
      if (strict || name !== undefined) {
        errors.push(`Student entry ${i}: name must be a non-empty string`);
      }
    }

    const studentName = typeof name === "string" && name !== "" ? name : `Entry ${i}`;

    // Validate grade
    const grade = record.grade;
    if (grade !== undefined) {
      if (!isValidGrade(grade)) {
        errors.push(`Student ${studentName}: grade must be 11 or 12`);
      }
    } else if (strict) {
      errors.push(`Student ${studentName}: grade is required`);
    }

    // Validate questions
    const questions = record.questions;
    if (questions !== undefined) {
      if (!isPlainObject(questions)) {
        errors.push(`Student entry ${i}: questions must be an object`);
      } else {
        const questionsRecord = questions as Record<string, unknown>;
        for (const key of knownQuestionKeys) {
          const label = questionKeyToLabel.get(key)!;
          const value = questionsRecord[key];

          if (value === undefined) {
            if (strict) {
              errors.push(`Student ${studentName}: ${label}: answer is required`);
            }
            continue;
          }

          if (!isPlainObject(value)) {
            errors.push(`Student ${studentName}: ${label}: must be an object`);
            continue;
          }

          const qEntry = value as Record<string, unknown>;

          if ("answer" in qEntry) {
            const answer = qEntry.answer;
            if (answer !== null && typeof answer !== "boolean") {
              errors.push(`Student ${studentName}: ${label}: answer must be true, false, or null`);
            } else if (strict && answer === null) {
              errors.push(`Student ${studentName}: ${label}: answer is required`);
            }
          } else if (strict) {
            errors.push(`Student ${studentName}: ${label}: answer is required`);
          }

          if ("remark" in qEntry && qEntry.remark !== undefined && typeof qEntry.remark !== "string") {
            errors.push(`Student ${studentName}: ${label}: remark must be a string`);
          }
        }

        // In strict mode, questions must exist for all keys
        if (strict) {
          for (const key of knownQuestionKeys) {
            if (!(key in questionsRecord)) {
              const label = questionKeyToLabel.get(key)!;
              const alreadyReported = errors.some(
                (e) => e.includes(label) && e.includes("answer is required")
              );
              if (!alreadyReported) {
                errors.push(`Student ${studentName}: ${label}: answer is required`);
              }
            }
          }
        }
      }
    } else if (strict) {
      errors.push(`Student ${studentName}: all questions must be answered`);
    }
  }

  return errors;
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

  if ("students" in payload) {
    errors.push(...validateStudentEntries(payload.students, false));
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

  if (!("students" in payload) || !Array.isArray(payload.students) || payload.students.length === 0) {
    errors.push("At least one student must be recorded");
  }

  if ("students" in payload) {
    errors.push(...validateStudentEntries(payload.students, true));
  }

  return { valid: errors.length === 0, errors };
}
