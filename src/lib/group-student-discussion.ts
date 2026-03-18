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

export interface GroupStudentDiscussionConfig {
  sections: SectionConfig[];
  allQuestionKeys: string[];
}

export interface GroupStudentDiscussionData {
  grade: number;
  questions: Record<string, { answer: boolean | null; remark?: string }>;
}

export const VALID_GRADES = [11, 12] as const;
export type ValidGrade = (typeof VALID_GRADES)[number];

const sections: SectionConfig[] = [
  {
    title: "General Check",
    questions: [
      {
        key: "gc_interacted",
        label: "Have you interacted with the students?",
      },
      {
        key: "gc_program_updates",
        label:
          "Check on the program updates for the previous month?",
      },
      {
        key: "gc_direction",
        label:
          "Were able to provide a direction for the next month?",
      },
      {
        key: "gc_concerns",
        label:
          "Did students convey any concerns that need to be addressed?",
      },
    ],
  },
];

export const GROUP_STUDENT_DISCUSSION_CONFIG: GroupStudentDiscussionConfig = {
  sections,
  allQuestionKeys: sections.flatMap((s) => s.questions.map((q) => q.key)),
};

const ALLOWED_TOP_LEVEL_KEYS = new Set(["grade", "questions"]);

const questionKeyToLabel = new Map<string, string>(
  GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.map((key) => {
    const question = sections
      .flatMap((s) => s.questions)
      .find((q) => q.key === key)!;
    return [key, question.label];
  })
);

const knownQuestionKeys = new Set(GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidGrade(value: unknown): value is ValidGrade {
  return typeof value === "number" && Number.isInteger(value) && (VALID_GRADES as readonly number[]).includes(value);
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

export function validateGroupStudentDiscussionSave(data: unknown): ValidationResult {
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

  if ("grade" in payload && payload.grade !== undefined) {
    if (!isValidGrade(payload.grade)) {
      errors.push("grade must be 11 or 12");
    }
  }

  if ("questions" in payload) {
    errors.push(...validateQuestions(payload.questions, false));
  }

  return { valid: errors.length === 0, errors };
}

export function validateGroupStudentDiscussionComplete(data: unknown): ValidationResult {
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

  if (!isValidGrade(payload.grade)) {
    errors.push("grade is required and must be 11 or 12");
  }

  errors.push(...validateQuestions(payload.questions, true));

  return { valid: errors.length === 0, errors };
}
