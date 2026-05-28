import type { RemarkEntry } from "./visit-summary";

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

export interface SchoolStaffInteractionConfig {
  sections: SectionConfig[];
  allQuestionKeys: string[];
}

export interface SchoolStaffInteractionData {
  questions: Record<string, { answer: boolean | null; remark?: string }>;
}

const sections: SectionConfig[] = [
  {
    title: "General Check",
    questions: [
      {
        key: "gc_staff_concern",
        label:
          "Did any school staff raise any concern related to the program?",
      },
      {
        key: "gc_pertaining_issue",
        label:
          "Is there a pertaining issue from any school staff that affects the program?",
      },
    ],
  },
];

export const SCHOOL_STAFF_INTERACTION_CONFIG: SchoolStaffInteractionConfig = {
  sections,
  allQuestionKeys: sections.flatMap((s) => s.questions.map((q) => q.key)),
};

const ALLOWED_TOP_LEVEL_KEYS = new Set(["questions"]);

const questionKeyToLabel = new Map<string, string>(
  SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys.map((key) => {
    const question = sections
      .flatMap((s) => s.questions)
      .find((q) => q.key === key)!;
    return [key, question.label];
  })
);

const knownQuestionKeys = new Set(SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateQuestions(questions: unknown, strict: boolean): string[] {
  const errors: string[] = [];

  if (questions === undefined) {
    if (strict) {
      errors.push("All questions must be answered");
    }
    return errors;
  }

  if (!isPlainObject(questions)) {
    errors.push("questions must be an object");
    return errors;
  }

  const questionsRecord = questions as Record<string, unknown>;

  for (const key of knownQuestionKeys) {
    const label = questionKeyToLabel.get(key)!;
    const value = questionsRecord[key];

    if (value === undefined) {
      if (strict) {
        errors.push(`${label}: answer is required`);
      }
      continue;
    }

    if (!isPlainObject(value)) {
      errors.push(`${label}: must be an object`);
      continue;
    }

    const entry = value as Record<string, unknown>;

    if ("answer" in entry) {
      const answer = entry.answer;
      if (answer !== null && typeof answer !== "boolean") {
        errors.push(`${label}: answer must be true, false, or null`);
      } else if (strict && answer === null) {
        errors.push(`${label}: answer is required`);
      }
    } else if (strict) {
      errors.push(`${label}: answer is required`);
    }

    if ("remark" in entry && entry.remark !== undefined && typeof entry.remark !== "string") {
      errors.push(`${label}: remark must be a string`);
    }
  }

  return errors;
}

export function validateSchoolStaffInteractionSave(data: unknown): ValidationResult {
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

  if ("questions" in payload) {
    errors.push(...validateQuestions(payload.questions, false));
  }

  return { valid: errors.length === 0, errors };
}

export function validateSchoolStaffInteractionComplete(data: unknown): ValidationResult {
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

  errors.push(...validateQuestions(payload.questions, true));

  return { valid: errors.length === 0, errors };
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function extractRemarks(data: unknown): RemarkEntry[] {
  if (!isPlainObject(data) || !isPlainObject(data.questions)) {
    return [];
  }

  const remarks: RemarkEntry[] = [];
  for (const section of SCHOOL_STAFF_INTERACTION_CONFIG.sections) {
    for (const question of section.questions) {
      const answer = data.questions[question.key];
      if (!isPlainObject(answer)) {
        continue;
      }
      const text = nonEmptyString(answer.remark);
      if (text) {
        remarks.push({ label: question.label, text });
      }
    }
  }
  return remarks;
}

export function computeInlineStats(data: unknown): {
  answeredCount: number;
  totalQuestions: number;
} | null {
  if (!isPlainObject(data) || !isPlainObject(data.questions)) {
    return null;
  }

  let answeredCount = 0;
  for (const key of SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys) {
    const answer = data.questions[key];
    if (isPlainObject(answer) && typeof answer.answer === "boolean") {
      answeredCount += 1;
    }
  }

  return {
    answeredCount,
    totalQuestions: SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys.length,
  };
}
